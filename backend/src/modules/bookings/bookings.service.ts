import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingStatus,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  percentOf,
  type BookingDetail,
  type BookingStatusResponse,
  type CancelBookingResponse,
  type CreateBookingResponse,
  type ListBookingsQuery,
  type ListBookingsResponse,
  type Refund,
} from '@autowra/shared-types';
import type {
  CancelBookingInput,
  CreateBookingInput,
  RescheduleBookingInput,
} from '@autowra/validation';
import { AppError } from '../../common/app-error';
import { generateBookingReference } from '../../common/identifiers';
import { paginate, resolvePagination } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../catalog/availability.service';
import { CouponsService } from '../coupons/coupons.service';
import { AddressesService, VehiclesService } from '../customers/customer-assets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService, toRefundDto } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import {
  CANCELLABLE_BOOKING_STATUSES,
  RESCHEDULABLE_BOOKING_STATUSES,
  bookingSummaryInclude,
  loadBookingDetailOrThrow,
  toBookingDetail,
  toBookingSummary,
  toRealtimeEvent,
  type BookingDetailRecord,
} from './booking-mapper';
import { assertTransition, nextExpectedStatuses, statusLabel, writeStatusHistory } from './booking-status';

/** How many times we generate a fresh reference when one collides with an existing booking. */
const REFERENCE_ATTEMPTS = 5;

/**
 * Booking lifecycle for the customer app.
 *
 * Creation is the only place a price, a coupon and a slot are decided at the same time, and
 * it happens inside one serialisable transaction: the slot is claimed with a database
 * compare-and-set, the coupon redemption is claimed the same way, and the money columns are
 * written from the pricing engine's output. Nothing the client sends is trusted except
 * identifiers and selections - never an amount.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly availability: AvailabilityService,
    private readonly coupons: CouponsService,
    private readonly vehicles: VehiclesService,
    private readonly addresses: AddressesService,
    private readonly payments: PaymentsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Create                                                              */
  /* ------------------------------------------------------------------ */

  async create(customerId: string, input: CreateBookingInput): Promise<CreateBookingResponse> {
    const scheduledStart = new Date(input.scheduledStart);
    if (Number.isNaN(scheduledStart.getTime())) {
      throw AppError.badRequest('VALIDATION_FAILED', 'Choose a valid start time for your booking.');
    }
    if (scheduledStart.getTime() <= Date.now()) {
      throw AppError.badRequest('VALIDATION_FAILED', 'Choose a start time in the future.');
    }

    // Checked before anything is written, so a booking whose payment could never be
    // collected is never persisted.
    this.payments.assertOnlinePaymentAvailable(input.paymentMethod);

    // Duplicate submission protection. The unique idempotency key is the guard: a retried
    // request returns the booking that already exists instead of creating a second one.
    const replay = await this.prisma.booking.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: bookingSummaryInclude,
    });
    if (replay) {
      if (replay.customerId !== customerId) {
        throw AppError.conflict('CONFLICT', 'That request identifier has already been used.');
      }
      return this.respond(await loadBookingDetailOrThrow(this.prisma, replay.id), input.paymentMethod);
    }

    const paidUpfront = input.paymentMethod !== PaymentMethod.CASH_AFTER_SERVICE;

    const bookingId = await this.createBookingWithUniqueReference(async (reference) =>
      this.prisma.runWithRetry(async (tx) => {
        const [vehicle, address] = await Promise.all([
          this.vehicles.getOrThrow(customerId, input.vehicleId, tx),
          this.addresses.getOrThrow(customerId, input.addressId, tx),
        ]);

        // The same transaction computes the price, so the total can never be derived from
        // data that changed between the quote the customer approved and the write.
        const computation = await this.pricing.computeBookingPrice(
          customerId,
          {
            serviceId: input.serviceId,
            vehicleId: input.vehicleId,
            addressId: input.addressId,
            addonIds: input.addonIds,
            couponCode: input.couponCode,
            subscriptionId: input.subscriptionId,
          },
          tx,
          { strictCoupon: true },
        );

        const areaId = await this.availability.resolveAreaId(
          { addressId: address.id, postalCode: address.postalCode, customerId },
          tx,
        );
        if (!areaId) {
          throw AppError.badRequest(
            'ADDRESS_NOT_SERVICEABLE',
            'We do not serve this address yet. Pick a different saved address or update this one.',
          );
        }

        const slot = await this.availability.findSlotForStart(areaId, scheduledStart, tx);
        if (!slot) {
          throw AppError.badRequest(
            'SLOT_UNAVAILABLE',
            'That start time is not offered for this address. Please choose another slot.',
          );
        }
        // Atomic: PostgreSQL evaluates `booked < capacity` while holding the row lock.
        await this.availability.claimSlot(tx, slot.id);

        if (computation.couponId) {
          await this.coupons.assertCustomerEligible(computation.couponId, customerId, tx);
        }

        const coveredByPlan = computation.quote.breakdown.totalMinor <= 0;
        const needsPayment = paidUpfront && !coveredByPlan;

        const booking = await tx.booking.create({
          data: {
            reference,
            customerId,
            addressId: address.id,
            vehicleId: vehicle.id,
            serviceAreaId: areaId,
            slotId: slot.id,
            // A booking that needs no payment is confirmed as soon as it is created.
            status: needsPayment ? BookingStatus.PENDING_PAYMENT : BookingStatus.CONFIRMED,
            scheduledStart,
            scheduledEnd: new Date(scheduledStart.getTime() + computation.durationMinutes * 60_000),
            baseAmountMinor: computation.quote.breakdown.baseAmountMinor,
            sizeAdjustmentMinor: computation.quote.breakdown.sizeAdjustmentMinor,
            addonsAmountMinor: computation.quote.breakdown.addonsAmountMinor,
            subtotalMinor: computation.quote.breakdown.subtotalMinor,
            discountMinor: computation.quote.breakdown.discountMinor,
            couponDiscountMinor: computation.couponDiscountMinor,
            subscriptionCoverageMinor: computation.subscriptionCoverageMinor,
            taxableAmountMinor: computation.quote.breakdown.taxableAmountMinor,
            taxPercent: computation.quote.breakdown.taxPercent,
            taxAmountMinor: computation.quote.breakdown.taxAmountMinor,
            platformFeeMinor: computation.quote.breakdown.platformFeeMinor,
            visitFeeMinor: computation.quote.breakdown.visitFeeMinor,
            totalMinor: computation.quote.breakdown.totalMinor,
            currency: computation.quote.breakdown.currency,
            couponId: computation.couponId,
            subscriptionId: computation.subscriptionId,
            notes: input.notes ?? null,
            idempotencyKey: input.idempotencyKey,
            createdByUserId: customerId,
          },
        });

        await tx.bookingItem.create({
          data: {
            bookingId: booking.id,
            serviceId: computation.serviceId,
            serviceName: computation.serviceName,
            serviceSlug: computation.serviceSlug,
            vehicleSize: computation.vehicleSize,
            quantity: 1,
            unitPriceMinor: computation.unitPriceMinor,
            totalMinor: computation.unitPriceMinor,
            durationMinutes: computation.durationMinutes,
            includedTasks: computation.includedTasks,
            // Snapshot of the add-ons the customer chose, so the invoice never changes when
            // the catalogue does.
            addons: computation.quote.addons as unknown as Prisma.InputJsonValue,
          },
        });

        if (computation.couponId) {
          // Compare-and-set on `usedCount < usageLimitTotal`; throws when the last
          // redemption was taken by a concurrent request.
          await this.coupons.consume(computation.couponId, tx);
          await tx.couponRedemption.create({
            data: {
              couponId: computation.couponId,
              customerId,
              bookingId: booking.id,
              discountMinor: computation.couponDiscountMinor,
            },
          });
        }

        if (computation.subscriptionId) {
          await tx.subscriptionUsage.create({
            data: { subscriptionId: computation.subscriptionId, bookingId: booking.id },
          });
          await tx.customerSubscription.update({
            where: { id: computation.subscriptionId },
            data: { visitsUsed: { increment: 1 } },
          });
        }

        await writeStatusHistory(tx, {
          bookingId: booking.id,
          status: booking.status as BookingStatus,
          actorRole: 'CUSTOMER',
          actorUserId: customerId,
          note: needsPayment
            ? 'Booking created. Waiting for payment.'
            : coveredByPlan
              ? 'Booking confirmed. Your plan covered this visit.'
              : 'Booking confirmed. Payment is due after the service.',
        });

        return booking.id;
      }),
    );

    const detail = await loadBookingDetailOrThrow(this.prisma, bookingId);

    // Exactly one payment intent per booking and amount; the helper is idempotent, so a
    // retried request cannot open a second intent.
    if (detail.status === BookingStatus.PENDING_PAYMENT && detail.totalMinor > 0) {
      await this.payments.createPaymentRecord({
        customerId,
        bookingId: detail.id,
        method: input.paymentMethod,
        amountMinor: detail.totalMinor,
        currency: detail.currency,
      });
    }

    await this.notifications.notify({
      userId: customerId,
      type: NotificationType.BOOKING_CREATED,
      title: 'Booking created',
      body: `We have your ${detail.items.map((item) => item.serviceName).join(', ')} booking. Reference ${detail.reference}.`,
      data: { bookingId: detail.id, reference: detail.reference },
    });
    this.realtime.emitBookingUpdate(toRealtimeEvent(detail), [customerId]);
    await this.audit.record({
      actorUserId: customerId,
      actorRole: 'CUSTOMER',
      action: 'CREATE',
      entity: 'Booking',
      entityId: detail.id,
      summary: `Booking ${detail.reference} created for ${detail.totalMinor} ${detail.currency}.`,
    });

    return this.respond(detail, input.paymentMethod);
  }

  /**
   * Builds the create response. An online booking gets its gateway order here; a cash or
   * plan-covered booking has nothing to collect, so `payment` is null.
   */
  private async respond(
    booking: BookingDetailRecord,
    method: PaymentMethod,
  ): Promise<CreateBookingResponse> {
    const settings = await this.settings.get();
    const detail = toBookingDetail(booking, settings);

    if (method === PaymentMethod.CASH_AFTER_SERVICE || booking.status !== BookingStatus.PENDING_PAYMENT) {
      return { booking: detail, payment: null };
    }

    // Persist the customer's chosen method as the open intent first; `openOrderForBooking`
    // then reuses that intent instead of opening a second order for the same booking.
    await this.payments.createPaymentRecord({
      customerId: booking.customerId,
      bookingId: booking.id,
      method,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
    });

    return { booking: detail, payment: await this.payments.openOrderForBooking(booking.customerId, booking) };
  }

  /* ------------------------------------------------------------------ */
  /* Read                                                                */
  /* ------------------------------------------------------------------ */

  async list(customerId: string, query: ListBookingsQuery): Promise<ListBookingsResponse> {
    const paging = resolvePagination(query);
    const where: Prisma.BookingWhereInput = { customerId };

    if (query.upcomingOnly) {
      where.status = {
        in: [
          BookingStatus.PENDING_PAYMENT,
          BookingStatus.CONFIRMED,
          BookingStatus.ASSIGNED,
          BookingStatus.PARTNER_ACCEPTED,
          BookingStatus.TRAVELLING,
          BookingStatus.ARRIVED,
          BookingStatus.IN_PROGRESS,
        ],
      };
      where.scheduledStart = { gte: new Date() };
    } else if (query.status) {
      where.status = query.status;
    }

    const [rows, total, settings] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy: { scheduledStart: 'desc' },
        skip: paging.skip,
        take: paging.take,
        include: bookingSummaryInclude,
      }),
      this.prisma.booking.count({ where }),
      this.settings.get(),
    ]);

    return paginate(
      rows.map((row) => toBookingSummary(row, settings)),
      total,
      paging,
    );
  }

  /** Object-level authorisation: another customer's booking is indistinguishable from a missing one. */
  async getDetail(customerId: string, bookingId: string): Promise<BookingDetail> {
    const booking = await loadBookingDetailOrThrow(this.prisma, bookingId);
    if (booking.customerId !== customerId) throw AppError.notFound('That booking was not found.');
    return toBookingDetail(booking, await this.settings.get());
  }

  async getStatus(customerId: string, bookingId: string): Promise<BookingStatusResponse> {
    const booking = await loadBookingDetailOrThrow(this.prisma, bookingId);
    if (booking.customerId !== customerId) throw AppError.notFound('That booking was not found.');
    const detail = toBookingDetail(booking, await this.settings.get());

    return {
      bookingId: detail.id,
      reference: detail.reference,
      status: detail.status,
      partner: detail.partner,
      updatedAt: detail.updatedAt,
      nextExpectedStatuses: nextExpectedStatuses(detail.status),
    };
  }

  /** Printable invoice for the customer app; ownership is enforced inside the payment service. */
  renderInvoice(customerId: string, bookingId: string, role: 'CUSTOMER' | 'ADMIN'): Promise<string> {
    return this.payments.renderInvoice({ bookingId, requesterId: customerId, requesterRole: role });
  }

  /* ------------------------------------------------------------------ */
  /* Cancel                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Cancellation policy comes from `BusinessSettings`: inside the configured window the
   * cancellation fee applies, outside it cancelling is free. The slot is always released and
   * any captured money is refunded through the payment service.
   */
  async cancel(customerId: string, bookingId: string, input: CancelBookingInput): Promise<CancelBookingResponse> {
    const booking = await loadBookingDetailOrThrow(this.prisma, bookingId);
    if (booking.customerId !== customerId) throw AppError.notFound('That booking was not found.');

    const settings = await this.settings.get();

    if (booking.status === BookingStatus.CANCELLED) {
      return {
        booking: toBookingDetail(booking, settings),
        refund: await this.findRefund(bookingId),
        cancellationFeeMinor: 0,
        message: 'This booking was already cancelled.',
      };
    }

    if (!CANCELLABLE_BOOKING_STATUSES.includes(booking.status as BookingStatus)) {
      throw AppError.conflict(
        'CONFLICT',
        `A booking that is "${statusLabel(booking.status as BookingStatus)}" can no longer be cancelled.`,
      );
    }
    if (booking.scheduledStart.getTime() <= Date.now()) {
      throw AppError.conflict('CONFLICT', 'This booking has already started and can no longer be cancelled.');
    }

    const hoursUntilStart = (booking.scheduledStart.getTime() - Date.now()) / 3_600_000;
    const cancellationFeeMinor =
      hoursUntilStart <= settings.cancellationWindowHours
        ? Math.min(percentOf(booking.totalMinor, settings.cancellationFeePercent), booking.totalMinor)
        : 0;

    await this.prisma.runWithRetry(async (tx) => {
      const current = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!current) throw AppError.notFound('That booking was not found.');
      // Another request won the race; leave its cancellation intact.
      if (current.status === BookingStatus.CANCELLED) return;
      assertTransition(current.status as BookingStatus, BookingStatus.CANCELLED);

      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: input.reason,
          cancelledAt: new Date(),
          cancelledByUserId: customerId,
        },
      });

      // Hand the capacity back so the slot can be booked by someone else.
      if (current.slotId) await this.availability.releaseSlot(tx, current.slotId);

      // A plan visit is the customer's paid entitlement, so cancelling returns it. A coupon
      // redemption stays consumed, which stops a code being farmed across cancellations.
      if (current.subscriptionId) {
        await this.releaseSubscriptionVisit(tx, current.subscriptionId, bookingId);
      }

      await writeStatusHistory(tx, {
        bookingId,
        status: BookingStatus.CANCELLED,
        actorRole: 'CUSTOMER',
        actorUserId: customerId,
        note: input.reason,
      });
    });

    const paid = booking.payments.find((payment) => payment.status === PaymentStatus.PAID);
    const refundableMinor = Math.max(0, (paid?.amountMinor ?? 0) - cancellationFeeMinor);

    // Also retires a pending intent, so a customer is never charged for a cancelled booking.
    const refund = await this.payments.refundForCancellation({
      bookingId,
      amountMinor: refundableMinor,
      reason: input.reason,
      requestedByUserId: customerId,
      requestedByRole: 'CUSTOMER',
    });

    const updated = await loadBookingDetailOrThrow(this.prisma, bookingId);

    await this.notifications.notify({
      userId: customerId,
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Booking cancelled',
      body: refund
        ? `Booking ${updated.reference} is cancelled and your refund is being processed.`
        : `Booking ${updated.reference} has been cancelled.`,
      data: { bookingId: updated.id, reference: updated.reference },
    });
    this.realtime.emitBookingUpdate(toRealtimeEvent(updated), [customerId]);
    await this.audit.record({
      actorUserId: customerId,
      actorRole: 'CUSTOMER',
      action: 'STATUS_CHANGE',
      entity: 'Booking',
      entityId: updated.id,
      summary: `Booking ${updated.reference} cancelled by the customer.`,
    });

    return {
      booking: toBookingDetail(updated, settings),
      refund,
      cancellationFeeMinor,
      message: refund
        ? 'Your booking has been cancelled and a refund is on its way.'
        : 'Your booking has been cancelled.',
    };
  }

  /* ------------------------------------------------------------------ */
  /* Reschedule                                                          */
  /* ------------------------------------------------------------------ */

  async reschedule(
    customerId: string,
    bookingId: string,
    input: RescheduleBookingInput,
  ): Promise<BookingDetail> {
    const scheduledStart = new Date(input.scheduledStart);
    if (Number.isNaN(scheduledStart.getTime()) || scheduledStart.getTime() <= Date.now()) {
      throw AppError.badRequest('VALIDATION_FAILED', 'Choose a start time in the future.');
    }

    const booking = await loadBookingDetailOrThrow(this.prisma, bookingId);
    if (booking.customerId !== customerId) throw AppError.notFound('That booking was not found.');

    const settings = await this.settings.get();

    if (!RESCHEDULABLE_BOOKING_STATUSES.includes(booking.status as BookingStatus)) {
      throw AppError.conflict(
        'CONFLICT',
        `A booking that is "${statusLabel(booking.status as BookingStatus)}" cannot be rescheduled.`,
      );
    }
    if (booking.rescheduleCount >= settings.maxReschedulesPerBooking) {
      throw AppError.conflict(
        'CONFLICT',
        'This booking has been rescheduled the maximum number of times. Please cancel and book again.',
      );
    }
    const hoursUntilStart = (booking.scheduledStart.getTime() - Date.now()) / 3_600_000;
    if (hoursUntilStart < settings.rescheduleWindowHours) {
      throw AppError.conflict(
        'CONFLICT',
        `Bookings can only be moved at least ${settings.rescheduleWindowHours} hour(s) before the start time.`,
      );
    }

    await this.prisma.runWithRetry(async (tx) => {
      const current = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!current) throw AppError.notFound('That booking was not found.');
      if (!RESCHEDULABLE_BOOKING_STATUSES.includes(current.status as BookingStatus)) {
        throw AppError.conflict('CONFLICT', 'This booking can no longer be rescheduled.');
      }

      const areaId = await this.availability.resolveAreaId(
        { addressId: current.addressId, customerId },
        tx,
      );
      if (!areaId) {
        throw AppError.badRequest(
          'ADDRESS_NOT_SERVICEABLE',
          'We do not serve this address yet, so this booking cannot be moved.',
        );
      }

      const slot = await this.availability.findSlotForStart(areaId, scheduledStart, tx);
      if (!slot) {
        throw AppError.badRequest('SLOT_UNAVAILABLE', 'That start time is not offered. Please choose another slot.');
      }

      // Claim first, release second: moving to a later slot in the same slot row nets out,
      // and a failed claim leaves the original reservation untouched.
      if (slot.id !== current.slotId) {
        await this.availability.claimSlot(tx, slot.id);
        if (current.slotId) await this.availability.releaseSlot(tx, current.slotId);
      }

      const durationMinutes = Math.max(
        1,
        Math.round((current.scheduledEnd.getTime() - current.scheduledStart.getTime()) / 60_000),
      );

      await tx.booking.update({
        where: { id: bookingId },
        data: {
          scheduledStart,
          scheduledEnd: new Date(scheduledStart.getTime() + durationMinutes * 60_000),
          slotId: slot.id,
          serviceAreaId: areaId,
          rescheduledFrom: current.scheduledStart,
          rescheduleCount: { increment: 1 },
        },
      });

      await writeStatusHistory(tx, {
        bookingId,
        status: current.status as BookingStatus,
        actorRole: 'CUSTOMER',
        actorUserId: customerId,
        note: input.reason ?? `Rescheduled to ${scheduledStart.toISOString()}.`,
      });
    });

    const updated = await loadBookingDetailOrThrow(this.prisma, bookingId);

    await this.notifications.notify({
      userId: customerId,
      type: NotificationType.BOOKING_RESCHEDULED,
      title: 'Booking rescheduled',
      body: `Booking ${updated.reference} now starts at ${scheduledStart.toISOString()}.`,
      data: { bookingId: updated.id, reference: updated.reference },
    });
    this.realtime.emitBookingUpdate(toRealtimeEvent(updated), [customerId]);
    await this.audit.record({
      actorUserId: customerId,
      actorRole: 'CUSTOMER',
      action: 'STATUS_CHANGE',
      entity: 'Booking',
      entityId: updated.id,
      summary: `Booking ${updated.reference} rescheduled by the customer.`,
    });

    return toBookingDetail(updated, settings);
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Booking references are short and human readable, so a collision is possible in theory.
   * PostgreSQL aborts a transaction after a failed statement, so the retry has to wrap the
   * whole transaction rather than re-issue the insert.
   */
  private async createBookingWithUniqueReference<T>(work: (reference: string) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        return await work(generateBookingReference());
      } catch (error) {
        if (!isReferenceCollision(error) || attempt === REFERENCE_ATTEMPTS) throw error;
        this.logger.warn('Booking reference collision; generating a new one');
      }
    }
    throw AppError.internal('We could not create your booking. Please try again.');
  }

  private async releaseSubscriptionVisit(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    bookingId: string,
  ): Promise<void> {
    const usage = await tx.subscriptionUsage.findUnique({ where: { bookingId } });
    if (!usage) return;
    await tx.subscriptionUsage.delete({ where: { bookingId } });
    await tx.customerSubscription.updateMany({
      where: { id: subscriptionId, visitsUsed: { gt: 0 } },
      data: { visitsUsed: { decrement: 1 } },
    });
  }

  private async findRefund(bookingId: string): Promise<Refund | null> {
    const refund = await this.prisma.refund.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
    return refund ? toRefundDto(refund) : null;
  }
}

function isReferenceCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.['target'];
  if (Array.isArray(target)) return target.includes('reference');
  return typeof target === 'string' ? target.includes('reference') : true;
}
