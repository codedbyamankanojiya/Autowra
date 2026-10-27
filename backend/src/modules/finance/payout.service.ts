import { Injectable } from '@nestjs/common';
import { LedgerEntryType, NotificationType, PayoutStatus, type PartnerPayout, type PartnerPayoutsResponse } from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import { paginationMeta, resolvePagination } from '../../common/pagination';
import { AppConfigService } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toPartnerPayout } from './finance.mapper';

export interface CreatePayoutInput {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly note?: string | null;
  readonly actorUserId?: string | null;
}

/**
 * Settlement of partner earnings.
 *
 * A payout claims the unsettled ledger entries for a period by stamping `payoutId` on them.
 * The claim is a compare-and-set, so two operators settling the same partner at the same
 * time cannot both end up paying the same earnings.
 */
@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async listForPartner(
    partnerId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<PartnerPayoutsResponse> {
    const paging = resolvePagination(query);
    const [rows, total] = await Promise.all([
      this.prisma.payout.findMany({
        where: { partnerId },
        orderBy: { createdAt: 'desc' },
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.payout.count({ where: { partnerId } }),
    ]);
    return { payouts: rows.map(toPartnerPayout), pagination: paginationMeta(paging, total) };
  }

  async createForPartner(partnerId: string, input: CreatePayoutInput): Promise<PartnerPayout> {
    if (input.periodEnd.getTime() < input.periodStart.getTime()) {
      throw AppError.badRequest('VALIDATION_FAILED', 'The payout period ends before it starts.');
    }

    const payoutId = await this.prisma.runWithRetry(async (tx) => {
      const entries = await tx.partnerLedgerEntry.findMany({
        where: {
          partnerId,
          payoutId: null,
          type: { not: LedgerEntryType.PAYOUT },
          createdAt: { gte: input.periodStart, lte: input.periodEnd },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, amountMinor: true },
      });

      const amountMinor = entries.reduce((total, entry) => total + entry.amountMinor, 0);
      if (entries.length === 0 || amountMinor <= 0) {
        throw AppError.conflict('CONFLICT', 'There are no unsettled earnings for this partner in that period.');
      }

      const payout = await tx.payout.create({
        data: {
          partnerId,
          status: PayoutStatus.PENDING,
          amountMinor,
          currency: this.config.business.currency,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          entryCount: entries.length,
          note: input.note ?? null,
          createdByUserId: input.actorUserId ?? null,
        },
      });

      const claimed = await tx.partnerLedgerEntry.updateMany({
        where: { id: { in: entries.map((entry) => entry.id) }, payoutId: null },
        data: { payoutId: payout.id },
      });
      if (claimed.count !== entries.length) {
        throw AppError.conflict('CONFLICT', 'Some of those earnings were settled elsewhere. Refresh and try again.');
      }

      // Recorded as a negative entry so the ledger balance matches the money actually sent.
      const current = await tx.partnerLedgerEntry.aggregate({
        _sum: { amountMinor: true },
        where: { partnerId },
      });
      await tx.partnerLedgerEntry.create({
        data: {
          partnerId,
          payoutId: payout.id,
          type: LedgerEntryType.PAYOUT,
          amountMinor: -amountMinor,
          currency: payout.currency,
          description: `Payout of ${entries.length} ledger entries`,
          balanceAfterMinor: (current._sum.amountMinor ?? 0) - amountMinor,
        },
      });

      return payout.id;
    });

    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    await this.audit.record({
      actorUserId: input.actorUserId ?? null,
      actorRole: 'ADMIN',
      action: 'PAYOUT',
      entity: 'Payout',
      entityId: payout.id,
      summary: `Payout of ${payout.amountMinor} ${payout.currency} created for partner ${partnerId}.`,
    });
    return toPartnerPayout(payout);
  }

  /** Marks a payout as sent. Only a pending or in-flight payout can be completed. */
  async markPaid(
    payoutId: string,
    input: { reference?: string | null; note?: string | null; actorUserId?: string | null },
  ): Promise<PartnerPayout> {
    const existing = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { partner: { select: { userId: true, fullName: true } } },
    });
    if (!existing) throw AppError.notFound('That payout was not found.');
    if (existing.status === PayoutStatus.PAID) {
      throw AppError.conflict('CONFLICT', 'That payout has already been marked as paid.');
    }
    if (existing.status === PayoutStatus.FAILED) {
      throw AppError.conflict('CONFLICT', 'A failed payout cannot be marked as paid.');
    }

    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.PAID,
        paidAt: new Date(),
        reference: input.reference ?? existing.reference,
        note: input.note ?? existing.note,
      },
    });

    await this.notifications.notify({
      userId: existing.partner.userId,
      type: NotificationType.PAYOUT_UPDATE,
      title: 'Payout completed',
      body: `${updated.amountMinor / 100} ${updated.currency} has been sent to your account.`,
      data: { payoutId: updated.id },
    });
    await this.audit.record({
      actorUserId: input.actorUserId ?? null,
      actorRole: 'ADMIN',
      action: 'PAYOUT',
      entity: 'Payout',
      entityId: updated.id,
      summary: `Payout ${updated.id} marked as paid (${updated.amountMinor} ${updated.currency}).`,
    });

    return toPartnerPayout(updated);
  }
}
