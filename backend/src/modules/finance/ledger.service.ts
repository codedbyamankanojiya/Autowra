import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LedgerEntryType,
  percentOf,
  type LedgerEntry,
  type Paginated,
  type PartnerEarningsSummary,
} from '@autowra/shared-types';
import { istStartOfDay, istStartOfMonth, istStartOfWeek } from '../../common/dates';
import { paginate, resolvePagination } from '../../common/pagination';
import type { Db } from '../../common/types';
import { AppConfigService } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { CommissionService } from './commission.service';
import { ledgerEntryInclude, toLedgerEntry } from './finance.mapper';

export interface JobSettlementInput {
  readonly partnerId: string;
  readonly bookingId: string;
  readonly bookingReference: string;
  readonly currency: string;
  /** What the customer was charged before tax: the partner's earning base. */
  readonly grossMinor: number;
  readonly commissionPercent: number;
  readonly commissionFlatMinor?: number;
  /** Frozen commission decided when the job was offered, when one exists. */
  readonly commissionMinorOverride?: number;
  readonly incentiveMinor?: number;
}

export interface JobSettlement {
  readonly grossMinor: number;
  readonly commissionMinor: number;
  readonly incentiveMinor: number;
  readonly netMinor: number;
  readonly commissionPercent: number;
  /** `false` when the job had already been settled and this call was a replay. */
  readonly created: boolean;
}

/**
 * Partner money.
 *
 * Every amount a partner sees or is paid comes from append-only `PartnerLedgerEntry` rows
 * written on the server. Nothing on the partner app can influence a credit, and each entry
 * carries the running balance so a statement can be rebuilt without replaying history.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commission: CommissionService,
    private readonly config: AppConfigService,
  ) {}

  /** Signed total balance: earnings and adjustments minus commission and payouts. */
  async balanceFor(partnerId: string, db: Db = this.prisma): Promise<number> {
    const result = await db.partnerLedgerEntry.aggregate({
      _sum: { amountMinor: true },
      where: { partnerId },
    });
    return result._sum.amountMinor ?? 0;
  }

  /**
   * Writes the three entries a completed job produces. Replaying a completion returns the
   * original figures instead of crediting the partner twice - the `JOB_EARNING` row for a
   * booking acts as the settlement marker.
   */
  async settleCompletedJob(db: Db, input: JobSettlementInput): Promise<JobSettlement> {
    const grossMinor = Math.max(0, Math.round(input.grossMinor));
    // A job that already froze its commission keeps that figure: the rate may have changed
    // between the offer the partner accepted and the completion.
    const commissionMinor =
      input.commissionMinorOverride === undefined
        ? Math.min(
            grossMinor,
            Math.max(0, Math.round(input.commissionFlatMinor ?? 0)) + percentOf(grossMinor, input.commissionPercent),
          )
        : Math.min(grossMinor, Math.max(0, Math.round(input.commissionMinorOverride)));
    const incentiveMinor = Math.max(0, Math.round(input.incentiveMinor ?? 0));
    const netMinor = grossMinor - commissionMinor + incentiveMinor;

    const alreadySettled = await db.partnerLedgerEntry.findFirst({
      where: { bookingId: input.bookingId, type: LedgerEntryType.JOB_EARNING },
      select: { amountMinor: true },
    });
    if (alreadySettled) {
      return {
        grossMinor: alreadySettled.amountMinor,
        commissionMinor,
        incentiveMinor,
        netMinor,
        commissionPercent: input.commissionPercent,
        created: false,
      };
    }

    let balance = await this.balanceFor(input.partnerId, db);
    balance = await this.write(db, input.partnerId, balance, {
      type: LedgerEntryType.JOB_EARNING,
      amountMinor: grossMinor,
      currency: input.currency,
      bookingId: input.bookingId,
      description: `Job earnings for booking ${input.bookingReference}`,
    });

    if (commissionMinor > 0) {
      balance = await this.write(db, input.partnerId, balance, {
        type: LedgerEntryType.COMMISSION,
        amountMinor: -commissionMinor,
        currency: input.currency,
        bookingId: input.bookingId,
        description: `Platform commission (${input.commissionPercent}%) for booking ${input.bookingReference}`,
      });
    }

    if (incentiveMinor > 0) {
      balance = await this.write(db, input.partnerId, balance, {
        type: LedgerEntryType.INCENTIVE,
        amountMinor: incentiveMinor,
        currency: input.currency,
        bookingId: input.bookingId,
        description: `Incentive for booking ${input.bookingReference}`,
      });
    }

    return {
      grossMinor,
      commissionMinor,
      incentiveMinor,
      netMinor,
      commissionPercent: input.commissionPercent,
      created: true,
    };
  }

  /**
   * Negates the money already credited for a booking. Used when a completed job is later
   * cancelled or refunded. Only the net effect is reversed, so a statement stays readable.
   */
  async reverseForBooking(db: Db, input: { bookingId: string; reason: string }): Promise<number> {
    const [entries, existingReversal] = await Promise.all([
      db.partnerLedgerEntry.findMany({
        where: {
          bookingId: input.bookingId,
          type: { in: [LedgerEntryType.JOB_EARNING, LedgerEntryType.COMMISSION, LedgerEntryType.INCENTIVE] },
        },
      }),
      db.partnerLedgerEntry.findFirst({
        where: { bookingId: input.bookingId, type: LedgerEntryType.REVERSAL },
        select: { id: true },
      }),
    ]);

    if (entries.length === 0) return 0;
    if (existingReversal) return 0;

    const netMinor = entries.reduce((total, entry) => total + entry.amountMinor, 0);
    if (netMinor === 0) return 0;

    const { partnerId, currency } = entries[0]!;
    const balance = await this.balanceFor(partnerId, db);
    await this.write(db, partnerId, balance, {
      type: LedgerEntryType.REVERSAL,
      amountMinor: -netMinor,
      currency,
      bookingId: input.bookingId,
      description: input.reason,
    });
    return -netMinor;
  }

  /** Figures for the partner earnings screen. All of it is derived, never stored as a total. */
  async summaryFor(partnerId: string, now: Date = new Date()): Promise<PartnerEarningsSummary> {
    const dayStart = istStartOfDay(now);
    const weekStart = istStartOfWeek(now);
    const monthStart = istStartOfMonth(now);

    const [today, week, month, lifetime, unsettled, paidOut, monthIncentives, jobsToday, jobsWeek, resolution] =
      await Promise.all([
        this.earnedSince(partnerId, dayStart),
        this.earnedSince(partnerId, weekStart),
        this.earnedSince(partnerId, monthStart),
        this.earnedSince(partnerId, null),
        this.prisma.partnerLedgerEntry.aggregate({
          _sum: { amountMinor: true },
          where: { partnerId, payoutId: null },
        }),
        this.prisma.partnerLedgerEntry.aggregate({
          _sum: { amountMinor: true },
          where: { partnerId, type: LedgerEntryType.PAYOUT },
        }),
        this.prisma.partnerLedgerEntry.aggregate({
          _sum: { amountMinor: true },
          where: { partnerId, type: LedgerEntryType.INCENTIVE, createdAt: { gte: monthStart } },
        }),
        this.prisma.partnerAssignment.count({
          where: { partnerId, status: 'COMPLETED', completedAt: { gte: dayStart } },
        }),
        this.prisma.partnerAssignment.count({
          where: { partnerId, status: 'COMPLETED', completedAt: { gte: weekStart } },
        }),
        this.commission.resolve({ partnerId }),
      ]);

    return {
      currency: this.config.business.currency,
      todayMinor: today,
      weekMinor: week,
      monthMinor: month,
      lifetimeMinor: lifetime,
      pendingSettlementMinor: unsettled._sum.amountMinor ?? 0,
      // Payout entries are written as negative amounts; the dashboard shows money received.
      paidSettlementMinor: Math.abs(paidOut._sum.amountMinor ?? 0),
      commissionPercent: resolution.percent,
      jobsCompletedToday: jobsToday,
      jobsCompletedWeek: jobsWeek,
      incentiveMinor: monthIncentives._sum.amountMinor ?? 0,
    };
  }

  async listEntries(
    partnerId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Paginated<LedgerEntry>> {
    const paging = resolvePagination(query);
    const where: Prisma.PartnerLedgerEntryWhereInput = { partnerId };
    const [rows, total] = await Promise.all([
      this.prisma.partnerLedgerEntry.findMany({
        where,
        include: ledgerEntryInclude,
        orderBy: { createdAt: 'desc' },
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.partnerLedgerEntry.count({ where }),
    ]);
    return paginate(rows.map(toLedgerEntry), total, paging);
  }

  /** Net earnings in a window. Payouts are excluded: they move money out, they are not income. */
  private async earnedSince(partnerId: string, from: Date | null): Promise<number> {
    const result = await this.prisma.partnerLedgerEntry.aggregate({
      _sum: { amountMinor: true },
      where: {
        partnerId,
        type: { not: LedgerEntryType.PAYOUT },
        ...(from ? { createdAt: { gte: from } } : {}),
      },
    });
    return result._sum.amountMinor ?? 0;
  }

  private async write(
    db: Db,
    partnerId: string,
    balanceBeforeMinor: number,
    entry: {
      type: LedgerEntryType;
      amountMinor: number;
      currency: string;
      bookingId?: string | null;
      payoutId?: string | null;
      description: string;
    },
  ): Promise<number> {
    const balanceAfterMinor = balanceBeforeMinor + entry.amountMinor;
    await db.partnerLedgerEntry.create({
      data: {
        partnerId,
        type: entry.type,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        bookingId: entry.bookingId ?? null,
        payoutId: entry.payoutId ?? null,
        description: entry.description,
        balanceAfterMinor,
      },
    });
    return balanceAfterMinor;
  }
}
