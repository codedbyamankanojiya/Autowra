import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ACTIVE_PARTNER_BOOKING_STATUSES,
  AssignmentStatus,
  BookingStatus,
  NotificationType,
  PARTNER_JOB_OFFER_TTL_SECONDS,
  type PartnerJobSummary,
} from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import { AppConfigService } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { writeStatusHistory } from '../bookings/booking-status';
import { CommissionService } from '../finance/commission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import { partnerJobInclude, toPartnerJobSummary, type PartnerJobRecord } from './partner.mapper';

/** The booking slice candidate ranking and offers need. */
const assignmentBookingInclude = {
  items: { select: { serviceId: true, serviceName: true, serviceSlug: true }, orderBy: { createdAt: 'asc' } },
  address: { select: { latitude: true, longitude: true, city: true } },
} as const;

export interface OfferOptions {
  readonly actorUserId?: string | null;
  readonly distanceKm?: number | null;
  readonly note?: string | null;
}

interface RankedCandidate {
  readonly partnerId: string;
  readonly distanceKm: number | null;
  readonly activeJobs: number;
  readonly score: number;
}

/**
 * Partner assignment.
 *
 * A job is offered to one partner at a time. Candidates come from the approved, currently
 * online partners who cover the booking's service area and are below the concurrent job cap;
 * they are then ranked on distance, workload, rating and skill overlap. Every write is a
 * compare-and-set so a partner that accepts a second after their offer expired cannot take
 * the job, and offers always expire (`assignmentOfferTtlSeconds`).
 *
 * Nothing here is client driven: the app can only accept or reject an offer it already has.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly commission: CommissionService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Offers                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Offers a specific booking to a specific partner. Used by the ranking engine and by the
   * admin dashboard when operations assign a job by hand.
   */
  async offerTo(bookingId: string, partnerId: string, options: OfferOptions = {}): Promise<PartnerJobSummary> {
    const settings = await this.settings.get();
    const ttlSeconds = settings.assignmentOfferTtlSeconds || PARTNER_JOB_OFFER_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const commissionPercent = await this.prisma.runWithRetry(async (tx) => {
      const [booking, partner] = await Promise.all([
        tx.booking.findUnique({ where: { id: bookingId }, include: assignmentBookingInclude }),
        tx.partnerProfile.findUnique({ where: { id: partnerId } }),
      ]);
      if (!booking) throw AppError.notFound('That booking was not found.');
      if (!partner) throw AppError.notFound('That partner was not found.');
      if (partner.status !== 'APPROVED') {
        throw AppError.conflict('ACCOUNT_NOT_APPROVED', 'That partner is not approved to take jobs yet.');
      }
      if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.ASSIGNED) {
        throw AppError.conflict('INVALID_STATUS_TRANSITION', 'That booking is no longer open for assignment.');
      }

      const pricing = await this.commission.resolve({
        serviceId: booking.items[0]?.serviceId ?? null,
        serviceAreaId: booking.serviceAreaId,
        partnerId,
      });

      const grossMinor = Math.max(0, booking.taxableAmountMinor);
      const commissionMinor = Math.round((grossMinor * pricing.percent) / 100);
      const netMinor = Math.max(0, grossMinor - commissionMinor);

      // Any earlier live offer for this booking is retired: a partner must never see two
      // open offers for the same job.
      await tx.partnerAssignment.updateMany({
        where: { bookingId, status: AssignmentStatus.OFFERED, partnerId: { not: partnerId } },
        data: {
          status: AssignmentStatus.CANCELLED,
          respondedAt: new Date(),
          rejectionReason: options.note ?? 'Reassigned to another partner.',
        },
      });

      const existing = await tx.partnerAssignment.findUnique({
        where: { bookingId_partnerId: { bookingId, partnerId } },
      });

      const assignmentData = {
        status: AssignmentStatus.OFFERED,
        offeredAt: new Date(),
        expiresAt,
        respondedAt: null,
        rejectionReason: null,
        distanceKm: options.distanceKm ?? existing?.distanceKm ?? null,
        payoutGrossMinor: grossMinor,
        payoutCommissionMinor: commissionMinor,
        payoutIncentiveMinor: 0,
        payoutNetMinor: netMinor,
        commissionPercent: pricing.percent,
      };

      if (existing) {
        await tx.partnerAssignment.update({ where: { id: existing.id }, data: assignmentData });
      } else {
        await tx.partnerAssignment.create({ data: { bookingId, partnerId, ...assignmentData } });
      }

      if (booking.status === BookingStatus.CONFIRMED) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.ASSIGNED, assignmentAttempts: { increment: 1 } },
        });
        await writeStatusHistory(tx, {
          bookingId: booking.id,
          status: BookingStatus.ASSIGNED,
          actorRole: 'SYSTEM',
          actorUserId: options.actorUserId ?? null,
          note: 'A partner has been offered this job.',
        });
      } else {
        await tx.booking.update({
          where: { id: booking.id },
          data: { assignmentAttempts: { increment: 1 } },
        });
      }

      return pricing.percent;
    });

    const record = await this.loadAssignmentOrThrow(bookingId, partnerId);
    const summary = toPartnerJobSummary(record, commissionPercent);

    await this.notifyOffer(record, summary);
    await this.audit.record({
      actorUserId: options.actorUserId ?? null,
      actorRole: options.actorUserId ? 'ADMIN' : 'SYSTEM',
      action: 'ASSIGN',
      entity: 'PartnerAssignment',
      entityId: record.id,
      summary: `Booking ${summary.reference} offered to partner ${record.partner.fullName} (payout ${summary.payoutMinor} ${this.config.business.currency}).`,
      metadata: { distanceKm: summary.distanceKm, partnerId: record.partnerId },
    });

    return summary;
  }

  /**
   * Picks the best available partner. Returns `null` when nobody is eligible, in which case
   * the booking stays in `ASSIGNED` waiting for a manual assignment rather than being
   * pushed into a dead end - operations can always assign it by hand.
   */
  async autoAssign(
    bookingId: string,
    options: { excludePartnerIds?: string[]; actorUserId?: string | null } = {},
  ): Promise<PartnerJobSummary | null> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: assignmentBookingInclude,
    });
    if (!booking) throw AppError.notFound('That booking was not found.');

    const ranked = await this.rankCandidates(booking, options.excludePartnerIds ?? []);
    const best = ranked[0];
    if (!best) {
      this.logger.warn(`No eligible partner for booking ${booking.reference}`);
      await this.audit.record({
        actorUserId: options.actorUserId ?? null,
        actorRole: 'SYSTEM',
        action: 'ASSIGN',
        entity: 'Booking',
        entityId: booking.id,
        summary: `No eligible partner found for booking ${booking.reference}.`,
      });
      return null;
    }

    return this.offerTo(bookingId, best.partnerId, {
      actorUserId: options.actorUserId ?? null,
      distanceKm: best.distanceKm,
    });
  }

  /** Called after a partner rejects an offer so the job moves on to the next candidate. */
  async reassignAfterRejection(bookingId: string, rejectedPartnerId: string): Promise<PartnerJobSummary | null> {
    return this.autoAssign(bookingId, { excludePartnerIds: [rejectedPartnerId] });
  }

  /* ------------------------------------------------------------------ */
  /* Offer expiry                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Retires offers nobody answered and hands the job to the next candidate. Runs frequently
   * because the offer window is measured in minutes.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async expireOffers(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const expired = await this.prisma.partnerAssignment.findMany({
        where: { status: AssignmentStatus.OFFERED, expiresAt: { lte: new Date() } },
        select: { id: true, bookingId: true, partnerId: true, booking: { select: { reference: true } } },
        take: 50,
      });

      let expiredCount = 0;
      for (const assignment of expired) {
        const claimed = await this.prisma.partnerAssignment.updateMany({
          where: { id: assignment.id, status: AssignmentStatus.OFFERED },
          data: {
            status: AssignmentStatus.TIMED_OUT,
            respondedAt: new Date(),
            rejectionReason: 'The offer expired before it was accepted.',
          },
        });
        if (claimed.count === 0) continue;
        expiredCount += 1;

        await this.realtime.emitToUser(assignment.partnerId, 'job:expired', {
          assignmentId: assignment.id,
          bookingId: assignment.bookingId,
        });

        const booking = await this.prisma.booking.findUnique({
          where: { id: assignment.bookingId },
          select: { id: true, status: true, reference: true },
        });
        if (!booking || booking.status !== BookingStatus.ASSIGNED) continue;

        const next = await this.reassignAfterRejection(booking.id, assignment.partnerId);
        if (!next) {
          this.logger.warn(
            `Booking ${booking.reference} is unassigned after ${assignment.partnerId} timed out; waiting for a manual assignment.`,
          );
        }
      }

      return expiredCount;
    } finally {
      this.sweeping = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Ranking                                                             */
  /* ------------------------------------------------------------------ */

  private async rankCandidates(
    booking: {
      serviceAreaId: string | null;
      address: { latitude: number; longitude: number };
      items: Array<{ serviceName: string; serviceSlug: string }>;
    },
    excludePartnerIds: string[],
  ): Promise<RankedCandidate[]> {
    const settings = await this.settings.get();
    const maxConcurrentJobs = Math.max(1, settings.maxConcurrentPartnerJobs);

    const candidates = await this.prisma.partnerProfile.findMany({
      where: {
        status: 'APPROVED',
        isOnline: true,
        ...(booking.serviceAreaId
          ? { serviceAreas: { some: { serviceAreaId: booking.serviceAreaId } } }
          : {}),
        ...(excludePartnerIds.length > 0 ? { id: { notIn: excludePartnerIds } } : {}),
      },
      include: {
        assignments: {
          where: {
            status: AssignmentStatus.ACCEPTED,
            booking: { status: { in: [...ACTIVE_PARTNER_BOOKING_STATUSES] } },
          },
          select: { id: true },
        },
      },
    });

    const serviceText = booking.items
      .map((item) => `${item.serviceName} ${item.serviceSlug}`)
      .join(' ')
      .toLowerCase();

    const ranked: RankedCandidate[] = [];
    for (const candidate of candidates) {
      const activeJobs = candidate.assignments.length;
      if (activeJobs >= maxConcurrentJobs) continue;

      const distanceKm =
        candidate.lastLatitude !== null && candidate.lastLongitude !== null
          ? Math.round(
              haversineKm(
                candidate.lastLatitude,
                candidate.lastLongitude,
                booking.address.latitude,
                booking.address.longitude,
              ) * 10,
            ) / 10
          : null;

      let score = 100;
      // Distance dominates: a closer partner finishes sooner and costs less to send.
      if (distanceKm !== null) score -= Math.min(60, distanceKm * 3);
      score -= activeJobs * 12;
      score += Math.min(15, matchingSkillCount(candidate.skills, serviceText) * 5);
      score += Math.min(10, candidate.rating * 2);
      score += Math.min(10, candidate.experienceYears);

      ranked.push({ partnerId: candidate.id, distanceKm, activeJobs, score });
    }

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER);
    });
    return ranked;
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  private async loadAssignmentOrThrow(bookingId: string, partnerId: string): Promise<PartnerJobRecord> {
    const record = await this.prisma.partnerAssignment.findUnique({
      where: { bookingId_partnerId: { bookingId, partnerId } },
      include: partnerJobInclude,
    });
    if (!record) throw AppError.notFound('That job offer was not found.');
    return record;
  }

  private async notifyOffer(record: PartnerJobRecord, summary: PartnerJobSummary): Promise<void> {
    const partnerUserId = await this.partnerUserId(record.partnerId);
    if (!partnerUserId) return;

    const window = record.expiresAt
      ? ` Accept within ${Math.max(1, Math.round((record.expiresAt.getTime() - Date.now()) / 1000 / 60))} minute(s).`
      : '';
    await this.notifications.notify({
      userId: partnerUserId,
      type: NotificationType.JOB_OFFER,
      title: 'New job offer',
      body: `${summary.serviceNames.join(', ') || 'A new job'} at ${summary.areaName}.${window}`,
      data: { assignmentId: record.id, bookingId: summary.bookingId, reference: summary.reference },
    });
    this.realtime.emitToUser(partnerUserId, 'job:offer', summary);
  }

  private async partnerUserId(partnerId: string): Promise<string | null> {
    const partner = await this.prisma.partnerProfile.findUnique({
      where: { id: partnerId },
      select: { userId: true },
    });
    return partner?.userId ?? null;
  }
}

function matchingSkillCount(skills: string[], serviceText: string): number {
  let matches = 0;
  for (const skill of skills) {
    const tokens = skill
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2);
    if (tokens.length === 0) continue;
    // Services do not declare required skills yet, so a skill is treated as relevant when
    // every one of its words appears in the service name or slug.
    if (tokens.every((token) => serviceText.includes(token))) matches += 1;
  }
  return matches;
}

/** Great-circle distance in kilometres. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}
