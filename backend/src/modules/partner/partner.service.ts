import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AssignmentStatus,
  BookingStatus,
  DocumentStatus,
  NotificationType,
  PartnerStatus,
  SupportTicketCategory,
  SupportTicketStatus,
  type PartnerEarningsResponse,
  type PartnerJobDetail,
  type PartnerJobSummary,
  type PartnerJobsResponse,
  type PartnerPayoutsResponse,
  type PartnerProfile,
} from '@autowra/shared-types';
import type {
  ListPartnerJobsQueryInput,
  PartnerDocumentUploadInput,
  PartnerDutyStatusInput,
  PartnerEarningsQueryInput,
  PartnerIssueInput,
  PartnerJobActionInput,
  PartnerJobStatusInput,
  PartnerLocationInput,
  PartnerPhotoUploadInput,
  PartnerProfileUpdateInput,
  PartnerRegisterInput,
} from '@autowra/validation';
import { AppError } from '../../common/app-error';
import { encryptSecret } from '../../common/crypto';
import { istEndOfDay, istStartOfDay } from '../../common/dates';
import { generateTicketReference, maskAccountNumber, randomCode } from '../../common/identifiers';
import { paginationMeta, resolvePagination } from '../../common/pagination';
import { AppConfigService } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { loadBookingDetailOrThrow, toRealtimeEvent } from '../bookings/booking-mapper';
import { assertTransition, statusLabel, writeStatusHistory } from '../bookings/booking-status';
import { CommissionService } from '../finance/commission.service';
import { LedgerService } from '../finance/ledger.service';
import { PayoutService } from '../finance/payout.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../storage/storage.service';
import { AssignmentService } from './assignment.service';
import {
  partnerJobInclude,
  partnerProfileInclude,
  toPartnerJobDetail,
  toPartnerJobSummary,
  toPartnerProfile,
  toTrainingChecklist,
  type PartnerJobRecord,
  type PartnerProfileRecord,
} from './partner.mapper';

/** Documents an application cannot be submitted without. */
const REQUIRED_DOCUMENT_TYPES: readonly string[] = ['AADHAAR', 'PAN', 'DRIVING_LICENSE'];

const ISSUE_LABELS: Record<string, string> = {
  CUSTOMER_UNAVAILABLE: 'Customer was unavailable at the address',
  VEHICLE_NOT_ACCESSIBLE: 'The vehicle was not accessible',
  ADDRESS_NOT_FOUND: 'The address could not be found',
  UNSAFE_CONDITION: 'Unsafe working conditions',
  OTHER: 'Another issue came up',
};

/**
 * The partner app's server surface.
 *
 * Onboarding is a draft-then-submit flow: a partner fills in their profile, uploads private
 * KYC documents and only then submits for verification. Jobs are read from
 * `PartnerAssignment` rows, and the customer's name, phone and exact address are withheld
 * until the partner has accepted the offer. Status changes go through the shared booking
 * transition map, and money is only ever written by the finance module.
 */
@Injectable()
export class PartnerService {
  private readonly logger = new Logger(PartnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly commission: CommissionService,
    private readonly ledger: LedgerService,
    private readonly payoutService: PayoutService,
    private readonly assignments: AssignmentService,
    private readonly config: AppConfigService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Profile                                                             */
  /* ------------------------------------------------------------------ */

  async getProfile(userId: string): Promise<PartnerProfile> {
    const record = await this.prisma.partnerProfile.findUnique({
      where: { userId },
      include: partnerProfileInclude,
    });
    if (!record) {
      throw AppError.notFound('Start your Autowra partner registration to continue.');
    }
    return toPartnerProfile(record);
  }

  /** Creates or completes the draft profile. Submitted applications are locked. */
  async register(userId: string, input: PartnerRegisterInput): Promise<PartnerProfile> {
    const existing = await this.prisma.partnerProfile.findUnique({ where: { userId } });
    this.assertEditable(existing?.status);

    const bank = this.bankFields(input.bankAccountNumber, input.bankIfsc);

    await this.prisma.runWithRetry(async (tx) => {
      const profile = existing
        ? await tx.partnerProfile.update({
            where: { id: existing.id },
            data: {
              fullName: input.fullName,
              email: input.email ?? null,
              experienceYears: input.experienceYears,
              skills: input.skills,
              vehicleLabel: input.vehicleLabel ?? null,
              upiId: input.upiId ?? null,
              ...bank,
              // A rejected application returns to draft so the partner can fix it and resubmit.
              ...(existing.status === PartnerStatus.REJECTED
                ? { status: PartnerStatus.DRAFT, rejectionReason: null }
                : {}),
            },
          })
        : await tx.partnerProfile.create({
            data: {
              userId,
              fullName: input.fullName,
              email: input.email ?? null,
              experienceYears: input.experienceYears,
              skills: input.skills,
              vehicleLabel: input.vehicleLabel ?? null,
              upiId: input.upiId ?? null,
              status: PartnerStatus.DRAFT,
              ...bank,
            },
          });

      await this.replaceServiceAreas(tx, profile.id, input.serviceAreaIds);
    });

    await this.audit.record({
      actorUserId: userId,
      actorRole: 'PARTNER',
      action: 'UPDATE',
      entity: 'PartnerProfile',
      entityId: userId,
      summary: existing ? 'Partner registration updated.' : 'Partner registration started.',
    });

    return this.getProfile(userId);
  }

  async updateProfile(userId: string, input: PartnerProfileUpdateInput): Promise<PartnerProfile> {
    const record = await this.requireProfile(userId);
    this.assertEditable(record.status);

    const bank = this.bankFields(
      'bankAccountNumber' in input ? input.bankAccountNumber : undefined,
      'bankIfsc' in input ? input.bankIfsc : undefined,
    );

    await this.prisma.runWithRetry(async (tx) => {
      await tx.partnerProfile.update({
        where: { id: record.id },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
          ...(input.skills !== undefined ? { skills: input.skills } : {}),
          ...(input.vehicleLabel !== undefined ? { vehicleLabel: input.vehicleLabel } : {}),
          ...(input.upiId !== undefined ? { upiId: input.upiId } : {}),
          ...bank,
          ...(input.trainingChecklist
            ? { trainingChecklist: mergeTrainingChecklist(record.trainingChecklist, input.trainingChecklist) }
            : {}),
        },
      });

      if (input.serviceAreaIds) {
        await this.replaceServiceAreas(tx, record.id, input.serviceAreaIds);
      }
    });

    return this.getProfile(userId);
  }

  async uploadDocument(userId: string, input: PartnerDocumentUploadInput): Promise<PartnerProfile> {
    const record = await this.requireProfile(userId);
    if (record.status === PartnerStatus.APPROVED || record.status === PartnerStatus.SUSPENDED) {
      throw AppError.conflict('CONFLICT', 'Your documents can no longer be changed. Contact support instead.');
    }

    const body = this.storage.decodeUpload(input.contentBase64);
    const key = `partner-documents/${record.id}/${input.type.toLowerCase()}-${randomCode(8)}`;
    const stored = await this.storage.put(key, body, input.contentType);

    // One row per document type: a re-upload replaces the previous file and resets review.
    const existing = await this.prisma.partnerDocument.findFirst({
      where: { partnerId: record.id, type: input.type },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await this.prisma.partnerDocument.update({
        where: { id: existing.id },
        data: {
          fileName: input.fileName,
          storageKey: stored.key,
          contentType: stored.contentType,
          sizeBytes: stored.sizeBytes,
          status: DocumentStatus.PENDING,
          reviewNote: null,
          reviewedAt: null,
          reviewedByUserId: null,
        },
      });
    } else {
      await this.prisma.partnerDocument.create({
        data: {
          partnerId: record.id,
          type: input.type,
          fileName: input.fileName,
          storageKey: stored.key,
          contentType: stored.contentType,
          sizeBytes: stored.sizeBytes,
        },
      });
    }

    await this.audit.record({
      actorUserId: userId,
      actorRole: 'PARTNER',
      action: 'CREATE',
      entity: 'PartnerDocument',
      entityId: record.id,
      summary: `Partner uploaded a ${input.type} document.`,
    });

    return this.getProfile(userId);
  }

  /** Reads a private document back for its owner. Admin access is a separate route. */
  async readDocument(
    userId: string,
    documentId: string,
  ): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    const record = await this.requireProfile(userId);
    const document = await this.prisma.partnerDocument.findFirst({
      where: { id: documentId, partnerId: record.id },
    });
    if (!document) throw AppError.notFound('That document was not found.');

    return {
      body: await this.storage.read(document.storageKey),
      contentType: document.contentType,
      fileName: document.fileName,
    };
  }

  async submitApplication(userId: string): Promise<PartnerProfile> {
    const record = await this.requireProfile(userId);
    if (record.status === PartnerStatus.PENDING_VERIFICATION) {
      throw AppError.conflict('CONFLICT', 'Your application is already being reviewed.');
    }
    if (record.status === PartnerStatus.APPROVED) {
      throw AppError.conflict('CONFLICT', 'Your partner account is already approved.');
    }
    if (record.status === PartnerStatus.SUSPENDED) {
      throw AppError.conflict('ACCOUNT_SUSPENDED', 'Your partner account is suspended. Contact support.');
    }

    const missing: string[] = [];
    if (record.serviceAreas.length === 0) missing.push('service areas');
    if (record.skills.length === 0) missing.push('skills');
    if (!record.upiId && !(record.bankAccountEncrypted && record.bankIfsc)) missing.push('payout details');

    const uploaded = new Set(
      record.documents.filter((doc) => doc.status !== DocumentStatus.REJECTED).map((doc) => doc.type as string),
    );
    for (const type of REQUIRED_DOCUMENT_TYPES) {
      if (!uploaded.has(type)) missing.push(type.toLowerCase().replace('_', ' '));
    }
    if (missing.length > 0) {
      throw AppError.badRequest(
        'VALIDATION_FAILED',
        `Complete these before submitting: ${missing.join(', ')}.`,
        missing.map((path) => ({ path, message: 'Required' })),
      );
    }

    await this.prisma.partnerProfile.update({
      where: { id: record.id },
      data: {
        status: PartnerStatus.PENDING_VERIFICATION,
        submittedAt: new Date(),
        rejectionReason: null,
      },
    });

    await this.notifications.notify({
      userId,
      type: NotificationType.SYSTEM,
      title: 'Application submitted',
      body: 'Our team will verify your documents. You can go online once you are approved.',
      sendPush: true,
    });
    await this.audit.record({
      actorUserId: userId,
      actorRole: 'PARTNER',
      action: 'STATUS_CHANGE',
      entity: 'PartnerProfile',
      entityId: record.id,
      summary: 'Partner application submitted for verification.',
    });

    return this.getProfile(userId);
  }

  /** Online/offline switch. Only an approved partner can receive offers. */
  async setDutyStatus(userId: string, input: PartnerDutyStatusInput): Promise<PartnerProfile> {
    const record = await this.requireProfile(userId);
    if (record.status !== PartnerStatus.APPROVED) {
      throw AppError.conflict(
        'ACCOUNT_NOT_APPROVED',
        'Your partner account must be approved before you can go online.',
      );
    }

    await this.prisma.partnerProfile.update({
      where: { id: record.id },
      data: {
        isOnline: input.isOnline,
        ...(input.location
          ? {
              lastLatitude: input.location.latitude,
              lastLongitude: input.location.longitude,
              lastLocationAt: new Date(),
            }
          : {}),
      },
    });

    return this.getProfile(userId);
  }

  /** Periodic position ping from the partner app while a job is in progress. */
  async pushLocation(userId: string, input: PartnerLocationInput): Promise<{ success: boolean }> {
    const record = await this.requireProfile(userId);
    await this.prisma.partnerProfile.update({
      where: { id: record.id },
      data: {
        lastLatitude: input.latitude,
        lastLongitude: input.longitude,
        lastLocationAt: new Date(),
      },
    });
    return { success: true };
  }

  /* ------------------------------------------------------------------ */
  /* Jobs                                                                */
  /* ------------------------------------------------------------------ */

  async listJobs(userId: string, query: ListPartnerJobsQueryInput): Promise<PartnerJobsResponse> {
    const profile = await this.requireProfile(userId);
    const paging = resolvePagination(query);
    const scope = query.scope ?? 'all';
    const now = new Date();
    const dayStart = istStartOfDay(now);
    const dayEnd = istEndOfDay(now);

    const base = { partnerId: profile.id };
    const whereByScope: Record<ListPartnerJobsQueryInput['scope'] & string, Prisma.PartnerAssignmentWhereInput> = {
      offers: {
        ...base,
        status: AssignmentStatus.OFFERED,
        booking: { status: BookingStatus.ASSIGNED },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      today: {
        ...base,
        status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED] },
        booking: { scheduledStart: { gte: dayStart, lte: dayEnd } },
      },
      upcoming: {
        ...base,
        status: AssignmentStatus.ACCEPTED,
        booking: { scheduledStart: { gt: now } },
      },
      completed: { ...base, status: AssignmentStatus.COMPLETED },
      all: base,
    };

    const where = whereByScope[scope];
    const orderBy =
      scope === 'offers'
        ? { offeredAt: 'desc' as const }
        : scope === 'all' || scope === 'completed'
          ? { booking: { scheduledStart: 'desc' as const } }
          : { booking: { scheduledStart: 'asc' as const } };

    const [rows, total, offers, today, upcoming, completed] = await Promise.all([
      this.prisma.partnerAssignment.findMany({
        where,
        include: partnerJobInclude,
        orderBy,
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.partnerAssignment.count({ where }),
      this.prisma.partnerAssignment.count({ where: whereByScope.offers }),
      this.prisma.partnerAssignment.count({ where: whereByScope.today }),
      this.prisma.partnerAssignment.count({ where: whereByScope.upcoming }),
      this.prisma.partnerAssignment.count({ where: whereByScope.completed }),
    ]);

    // One lookup covers the whole page: the frozen per-job rate wins when it exists.
    const defaultPercent = await this.commission.percentFor({ partnerId: profile.id });
    const jobs: PartnerJobSummary[] = rows.map((row) =>
      toPartnerJobSummary(row, row.commissionPercent ?? defaultPercent),
    );

    return {
      jobs,
      counts: { offers, today, upcoming, completed },
      pagination: paginationMeta(paging, total),
    };
  }

  async getJob(userId: string, jobId: string): Promise<PartnerJobDetail> {
    const profile = await this.requireProfile(userId);
    const record = await this.findJobOrThrow(profile.id, jobId);
    return this.toDetail(record);
  }

  async acceptJob(userId: string, jobId: string, input: PartnerJobActionInput): Promise<PartnerJobDetail> {
    const profile = await this.requireProfile(userId);
    const record = await this.findJobOrThrow(profile.id, jobId);

    if (record.status === AssignmentStatus.ACCEPTED || record.status === AssignmentStatus.COMPLETED) {
      // Replay from a retried request or a second device: the job is already theirs.
      return this.toDetail(record);
    }
    if (record.status !== AssignmentStatus.OFFERED) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'That offer is no longer open.');
    }
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      await this.expireOffer(record.id);
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'That offer has expired.');
    }
    if (record.booking.status !== BookingStatus.ASSIGNED) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'That job is no longer available.');
    }

    const bookingId = record.bookingId;
    await this.prisma.runWithRetry(async (tx) => {
      const claimed = await tx.partnerAssignment.updateMany({
        where: { id: record.id, status: AssignmentStatus.OFFERED },
        data: { status: AssignmentStatus.ACCEPTED, respondedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw AppError.conflict('INVALID_STATUS_TRANSITION', 'This offer was already answered.');
      }

      const moved = await tx.booking.updateMany({
        where: { id: bookingId, status: BookingStatus.ASSIGNED },
        data: { status: BookingStatus.PARTNER_ACCEPTED },
      });
      if (moved.count === 0) {
        throw AppError.conflict('INVALID_STATUS_TRANSITION', 'That job is no longer available.');
      }

      // Whoever accepts first wins; every other live offer for this job is retired here.
      await tx.partnerAssignment.updateMany({
        where: { bookingId, status: AssignmentStatus.OFFERED, id: { not: record.id } },
        data: {
          status: AssignmentStatus.CANCELLED,
          respondedAt: new Date(),
          rejectionReason: 'Another partner accepted this job.',
        },
      });

      await writeStatusHistory(tx, {
        bookingId,
        status: BookingStatus.PARTNER_ACCEPTED,
        actorRole: 'PARTNER',
        actorUserId: userId,
        note: input.note ?? `${profile.fullName} accepted this job.`,
      });
    });

    await this.notifications.notify({
      userId: record.booking.customerId,
      type: NotificationType.PARTNER_ASSIGNED,
      title: 'Your partner is confirmed',
      body: `${profile.fullName} will take care of ${record.booking.items.map((item) => item.serviceName).join(', ')}.`,
      data: { bookingId, reference: record.booking.reference },
    });
    await this.emitBookingUpdate(bookingId, [record.booking.customerId]);
    await this.audit.record({
      actorUserId: userId,
      actorRole: 'PARTNER',
      action: 'UPDATE',
      entity: 'PartnerAssignment',
      entityId: record.id,
      summary: `Booking ${record.booking.reference} accepted by ${profile.fullName}.`,
    });

    return this.toDetail(await this.findJobOrThrow(profile.id, record.id));
  }

  async rejectJob(userId: string, jobId: string, input: PartnerJobActionInput): Promise<{ success: boolean }> {
    const profile = await this.requireProfile(userId);
    const record = await this.findJobOrThrow(profile.id, jobId);

    if (record.status === AssignmentStatus.REJECTED || record.status === AssignmentStatus.TIMED_OUT) {
      return { success: true };
    }
    if (record.status !== AssignmentStatus.OFFERED) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'That offer is no longer open.');
    }

    const rejected = await this.prisma.partnerAssignment.updateMany({
      where: { id: record.id, status: AssignmentStatus.OFFERED },
      data: {
        status: AssignmentStatus.REJECTED,
        respondedAt: new Date(),
        rejectionReason: input.note ?? 'Rejected by the partner.',
      },
    });
    if (rejected.count === 0) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'This offer was already answered.');
    }

    await this.audit.record({
      actorUserId: userId,
      actorRole: 'PARTNER',
      action: 'REJECT',
      entity: 'PartnerAssignment',
      entityId: record.id,
      summary: `Booking ${record.booking.reference} rejected by ${profile.fullName}.`,
    });

    // Hand the job to the next best partner; if nobody is free it stays queued for operations.
    try {
      await this.assignments.reassignAfterRejection(record.bookingId, profile.id);
    } catch (error) {
      this.logger.error(`Reassignment after rejection failed for booking ${record.bookingId}`, error as Error);
    }

    return { success: true };
  }

  async updateJobStatus(userId: string, jobId: string, input: PartnerJobStatusInput): Promise<PartnerJobDetail> {
    const profile = await this.requireProfile(userId);
    const record = await this.findJobOrThrow(profile.id, jobId);
    const bookingId = record.bookingId;
    const nextStatus = input.status as BookingStatus;

    if (nextStatus === BookingStatus.COMPLETED && record.status === AssignmentStatus.COMPLETED) {
      return this.toDetail(record);
    }
    if (record.status !== AssignmentStatus.ACCEPTED) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'Accept the job before updating its status.');
    }

    const currentStatus = record.booking.status as BookingStatus;
    assertTransition(currentStatus, nextStatus);

    // The commission was frozen when the job was offered, so the partner is paid exactly the
    // figure they accepted even if the platform rate changes in between.
    const frozenPercent =
      record.commissionPercent ??
      (await this.commission.percentFor({
        serviceId: record.booking.items[0]?.serviceId ?? null,
        serviceAreaId: record.booking.serviceAreaId,
        partnerId: profile.id,
      }));

    await this.prisma.runWithRetry(async (tx) => {
      const moved = await tx.booking.updateMany({
        where: { id: bookingId, status: currentStatus },
        data: {
          status: nextStatus,
          ...(nextStatus === BookingStatus.COMPLETED ? { completedAt: new Date() } : {}),
        },
      });
      if (moved.count === 0) {
        throw AppError.conflict('INVALID_STATUS_TRANSITION', 'That job has already moved on.');
      }

      await writeStatusHistory(tx, {
        bookingId,
        status: nextStatus,
        actorRole: 'PARTNER',
        actorUserId: userId,
        note: input.note ?? `${statusLabel(nextStatus)} by ${profile.fullName}.`,
      });

      if (nextStatus !== BookingStatus.COMPLETED) return;

      await tx.partnerAssignment.update({
        where: { id: record.id },
        data: { status: AssignmentStatus.COMPLETED, completedAt: new Date() },
      });
      await tx.partnerProfile.update({
        where: { id: profile.id },
        data: { completedJobs: { increment: 1 } },
      });

      const settlement = await this.ledger.settleCompletedJob(tx, {
        partnerId: profile.id,
        bookingId,
        bookingReference: record.booking.reference,
        currency: this.config.business.currency,
        grossMinor: record.payoutGrossMinor ?? record.booking.taxableAmountMinor,
        commissionPercent: frozenPercent,
        commissionMinorOverride: record.payoutCommissionMinor ?? undefined,
        incentiveMinor: record.payoutIncentiveMinor ?? 0,
      });

      // Freeze the final figures on the assignment so the partner statement matches.
      await tx.partnerAssignment.update({
        where: { id: record.id },
        data: {
          payoutGrossMinor: settlement.grossMinor,
          payoutCommissionMinor: settlement.commissionMinor,
          payoutIncentiveMinor: settlement.incentiveMinor,
          payoutNetMinor: settlement.netMinor,
          commissionPercent: settlement.commissionPercent,
        },
      });
    });

    if (nextStatus === BookingStatus.COMPLETED) {
      await this.notifications.notify({
        userId: record.booking.customerId,
        type: NotificationType.SERVICE_COMPLETED,
        title: 'Service completed',
        body: `Booking ${record.booking.reference} is complete. We would love your feedback.`,
        data: { bookingId, reference: record.booking.reference },
      });
    } else {
      await this.notifications.notify({
        userId: record.booking.customerId,
        type: notificationTypeForStatus(nextStatus),
        title: statusLabel(nextStatus),
        body: statusBodyFor(nextStatus, profile.fullName, record.booking.reference),
        data: { bookingId, reference: record.booking.reference },
      });
    }

    await this.emitBookingUpdate(bookingId, [record.booking.customerId]);
    await this.audit.record({
      actorUserId: userId,
      actorRole: 'PARTNER',
      action: 'STATUS_CHANGE',
      entity: 'Booking',
      entityId: bookingId,
      summary: `Booking ${record.booking.reference} moved to ${nextStatus} by ${profile.fullName}.`,
    });

    return this.toDetail(await this.findJobOrThrow(profile.id, record.id));
  }

  async reportIssue(userId: string, jobId: string, input: PartnerIssueInput): Promise<PartnerJobDetail> {
    const profile = await this.requireProfile(userId);
    const record = await this.findJobOrThrow(profile.id, jobId);

    if (record.status === AssignmentStatus.REJECTED || record.status === AssignmentStatus.TIMED_OUT) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'You no longer hold this job.');
    }

    const label = ISSUE_LABELS[input.reason] ?? 'Partner reported an issue';
    const ticket = await this.prisma.supportTicket.create({
      data: {
        reference: generateTicketReference(),
        category: SupportTicketCategory.BOOKING,
        status: SupportTicketStatus.OPEN,
        subject: `${label} - ${record.booking.reference}`,
        description: input.note?.trim() || label,
        bookingId: record.bookingId,
        createdByUserId: userId,
        createdByRole: 'PARTNER',
        messages: {
          create: {
            authorUserId: userId,
            authorRole: 'PARTNER',
            body: input.note?.trim() || label,
          },
        },
      },
    });

    await this.notifications.notify({
      userId: record.booking.customerId,
      type: NotificationType.SUPPORT_TICKET_UPDATE,
      title: 'Your partner reported an issue',
      body: `We are looking into "${label}" for booking ${record.booking.reference}.`,
      data: { bookingId: record.bookingId, reference: record.booking.reference, ticketReference: ticket.reference },
    });
    await this.audit.record({
      actorUserId: userId,
      actorRole: 'PARTNER',
      action: 'CREATE',
      entity: 'SupportTicket',
      entityId: ticket.id,
      summary: `Partner reported "${input.reason}" on booking ${record.booking.reference}.`,
    });

    return this.toDetail(record);
  }

  async uploadJobPhoto(userId: string, jobId: string, input: PartnerPhotoUploadInput): Promise<PartnerJobDetail> {
    const profile = await this.requireProfile(userId);
    const record = await this.findJobOrThrow(profile.id, jobId);

    if (record.status === AssignmentStatus.REJECTED || record.status === AssignmentStatus.TIMED_OUT) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'You no longer hold this job.');
    }

    const body = this.storage.decodeUpload(input.contentBase64);
    const extension = extensionFor(input.contentType);
    const key = `partner-jobs/${record.bookingId}/${input.kind.toLowerCase()}-${randomCode(10)}${extension}`;
    const stored = await this.storage.put(key, body, input.contentType);

    await this.prisma.completionPhoto.create({
      data: {
        bookingId: record.bookingId,
        kind: input.kind,
        storageKey: stored.key,
        url: stored.url,
        contentType: stored.contentType,
        uploadedByUserId: userId,
      },
    });

    return this.toDetail(await this.findJobOrThrow(profile.id, record.id));
  }

  /* ------------------------------------------------------------------ */
  /* Money                                                               */
  /* ------------------------------------------------------------------ */

  async earnings(userId: string, query: PartnerEarningsQueryInput): Promise<PartnerEarningsResponse> {
    const profile = await this.requireProfile(userId);
    const [summary, entries] = await Promise.all([
      this.ledger.summaryFor(profile.id),
      this.ledger.listEntries(profile.id, { page: query.page, pageSize: query.pageSize }),
    ]);

    return {
      summary,
      entries: entries.items,
      pagination: {
        page: entries.page,
        pageSize: entries.pageSize,
        total: entries.total,
        totalPages: entries.totalPages,
      },
    };
  }

  async payouts(userId: string, query: { page?: number; pageSize?: number }): Promise<PartnerPayoutsResponse> {
    const profile = await this.requireProfile(userId);
    return this.payoutService.listForPartner(profile.id, query);
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  private async requireProfile(userId: string): Promise<PartnerProfileRecord> {
    const record = await this.prisma.partnerProfile.findUnique({
      where: { userId },
      include: partnerProfileInclude,
    });
    if (!record) throw AppError.notFound('Start your Autowra partner registration to continue.');
    return record;
  }

  private assertEditable(status: PartnerStatus | undefined): void {
    if (status === PartnerStatus.APPROVED) {
      throw AppError.conflict('CONFLICT', 'Your profile is approved. Contact support to change these details.');
    }
    if (status === PartnerStatus.SUSPENDED) {
      throw AppError.conflict('ACCOUNT_SUSPENDED', 'Your partner account is suspended. Contact support.');
    }
    if (status === PartnerStatus.PENDING_VERIFICATION) {
      throw AppError.conflict('CONFLICT', 'Your application is under review and can no longer be edited.');
    }
  }

  private bankFields(
    accountNumber: string | null | undefined,
    ifsc: string | null | undefined,
  ): { bankAccountMasked?: string | null; bankAccountEncrypted?: string | null; bankIfsc?: string | null } {
    if (accountNumber === undefined && ifsc === undefined) return {};
    return {
      bankAccountMasked: accountNumber ? maskAccountNumber(accountNumber) : null,
      // The full number is only kept encrypted, for payouts.
      bankAccountEncrypted: accountNumber
        ? encryptSecret(accountNumber, this.config.security.dataEncryptionKey)
        : null,
      bankIfsc: ifsc ?? null,
    };
  }

  private async replaceServiceAreas(
    tx: Prisma.TransactionClient,
    partnerId: string,
    serviceAreaIds: readonly string[],
  ): Promise<void> {
    const areas = await this.prisma.serviceArea.findMany({
      where: { id: { in: [...serviceAreaIds] }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (areas.length !== serviceAreaIds.length) {
      const known = new Set(areas.map((area) => area.id));
      const invalid = serviceAreaIds.filter((id) => !known.has(id));
      throw AppError.badRequest('VALIDATION_FAILED', 'One or more selected service areas are not available.', [
        { path: 'serviceAreaIds', message: `Unknown or inactive areas: ${invalid.join(', ')}` },
      ]);
    }

    await tx.partnerServiceArea.deleteMany({ where: { partnerId } });
    if (areas.length > 0) {
      await tx.partnerServiceArea.createMany({
        data: areas.map((area) => ({ partnerId, serviceAreaId: area.id })),
      });
    }
  }

  private async findJobOrThrow(partnerId: string, jobId: string): Promise<PartnerJobRecord> {
    const record = await this.prisma.partnerAssignment.findFirst({
      // The app may address a job by either its assignment id or its booking id.
      where: { partnerId, OR: [{ id: jobId }, { bookingId: jobId }] },
      include: partnerJobInclude,
    });
    if (!record) throw AppError.notFound('That job was not found.');
    return record;
  }

  private async toDetail(record: PartnerJobRecord): Promise<PartnerJobDetail> {
    const commissionPercent =
      record.commissionPercent ??
      (await this.commission.percentFor({
        serviceId: record.booking.items[0]?.serviceId ?? null,
        serviceAreaId: record.booking.serviceAreaId,
        partnerId: record.partnerId,
      }));

    // `SupportTicket.bookingId` has no relation field, so the latest partner-raised ticket
    // is read separately rather than joined.
    const issue = await this.prisma.supportTicket.findFirst({
      where: { bookingId: record.bookingId, createdByUserId: record.partner.userId },
      orderBy: { createdAt: 'desc' },
      select: { subject: true, createdAt: true },
    });

    return toPartnerJobDetail(
      record,
      commissionPercent,
      issue ? { reason: issue.subject, reportedAt: issue.createdAt.toISOString() } : null,
    );
  }

  private async expireOffer(assignmentId: string): Promise<void> {
    await this.prisma.partnerAssignment.updateMany({
      where: { id: assignmentId, status: AssignmentStatus.OFFERED },
      data: {
        status: AssignmentStatus.TIMED_OUT,
        respondedAt: new Date(),
        rejectionReason: 'The offer expired before it was accepted.',
      },
    });
  }

  private async emitBookingUpdate(bookingId: string, participantUserIds: string[]): Promise<void> {
    const detail = await loadBookingDetailOrThrow(this.prisma, bookingId);
    this.realtime.emitBookingUpdate(toRealtimeEvent(detail), participantUserIds);
  }
}

function notificationTypeForStatus(status: BookingStatus): NotificationType {
  switch (status) {
    case BookingStatus.TRAVELLING:
      return NotificationType.PARTNER_TRAVELLING;
    case BookingStatus.ARRIVED:
      return NotificationType.PARTNER_ARRIVED;
    case BookingStatus.IN_PROGRESS:
      return NotificationType.SERVICE_STARTED;
    default:
      return NotificationType.SYSTEM;
  }
}

function statusBodyFor(status: BookingStatus, partnerName: string, reference: string): string {
  switch (status) {
    case BookingStatus.TRAVELLING:
      return `${partnerName} is on the way for booking ${reference}.`;
    case BookingStatus.ARRIVED:
      return `${partnerName} has arrived for booking ${reference}.`;
    case BookingStatus.IN_PROGRESS:
      return `${partnerName} has started the service for booking ${reference}.`;
    default:
      return `Booking ${reference} was updated.`;
  }
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('heic')) return '.heic';
  return '.jpg';
}

/** Applies the client's checklist ticks on top of the stored labels and requirements. */
function mergeTrainingChecklist(
  stored: unknown,
  updates: readonly { key: string; completed: boolean }[],
): Array<{ key: string; label: string; completed: boolean; required: boolean }> {
  const existing = toTrainingChecklist(stored as never);
  const byKey = new Map(existing.map((item) => [item.key, item]));
  const merged = existing.map((item) => {
    const update = updates.find((entry) => entry.key === item.key);
    return update ? { ...item, completed: update.completed } : item;
  });
  for (const update of updates) {
    if (byKey.has(update.key)) continue;
    merged.push({ key: update.key, label: update.key, completed: update.completed, required: false });
  }
  return merged;
}
