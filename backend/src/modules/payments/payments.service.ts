import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Invoice as PrismaInvoice, type Payment as PrismaPayment } from '@prisma/client';
import {
  BookingStatus,
  NotificationType,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
  SubscriptionStatus,
  type BookingDetail,
  type CreatePaymentOrderResult,
  type CustomerSubscription,
  type Paginated,
  type Refund,
  type UserRole,
  type VerifyPaymentRequest,
  type VerifyPaymentResult,
} from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import { generateInvoiceNumber } from '../../common/identifiers';
import { paginate, resolvePagination } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import {
  bookingDetailInclude,
  loadBookingDetailOrThrow,
  toBookingDetail,
  toRealtimeEvent,
  type BookingDetailRecord,
} from '../bookings/booking-mapper';
import { assertTransition, writeStatusHistory } from '../bookings/booking-status';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import {
  subscriptionInclude,
  toCustomerSubscription,
  type SubscriptionRecord,
} from '../subscriptions/subscription.mapper';
import {
  PAYMENT_PROVIDER_TOKEN,
  type ParsedWebhook,
  type PaymentProviderAdapter,
  type WebhookHeaders,
} from './payment-provider';

/** Shown inside the gateway checkout sheet. */
const BUSINESS_DISPLAY_NAME = 'Autowra';

/** How many times we re-derive an invoice sequence number when two requests collide. */
const INVOICE_NUMBER_ATTEMPTS = 5;

export interface WebhookResult {
  readonly received: boolean;
  readonly duplicate: boolean;
  readonly outcome: ParsedWebhook['outcome'];
}

export interface PaymentRow {
  readonly id: string;
  readonly bookingId: string;
  readonly amountMinor: number;
  readonly status: string;
  readonly createdAt: string;
}

/**
 * Payments.
 *
 * The server owns every amount: a payment is always created for the total the pricing engine
 * already wrote onto the booking, and a booking only reaches CONFIRMED once the gateway - or
 * the clearly labelled development mock - has confirmed the charge. Webhook events are
 * deduplicated on `(provider, eventId)` so a gateway retry can never double-apply.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly provider: PaymentProviderAdapter,
  ) {}

  get isSimulated(): boolean {
    return this.provider.isSimulated;
  }

  get activeProvider(): PaymentProvider {
    return this.provider.name;
  }

  /**
   * Checked before a booking is written so we never persist a booking whose payment could
   * never be collected. Cash after service needs no gateway.
   */
  assertOnlinePaymentAvailable(method: PaymentMethod): void {
    if (method === PaymentMethod.CASH_AFTER_SERVICE) return;
    if (this.provider.name !== PaymentProvider.RAZORPAY) return;
    const { keyId, keySecret } = this.config.payments.razorpay;
    if (!keyId || !keySecret) {
      throw AppError.badRequest(
        'PAYMENT_NOT_CONFIGURED',
        'Online payments are not configured on this server. Please contact support or choose cash after service.',
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Order creation                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Opens the gateway order for a booking id. Used by `POST /payments/create-order`, where
   * the caller only holds the identifier; booking creation calls `openOrderForBooking`
   * directly because it already has the loaded record.
   */
  async openOrder(customerId: string, bookingId: string): Promise<CreatePaymentOrderResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingDetailInclude,
    });
    if (!booking) throw AppError.notFound('That booking was not found.');
    return this.openOrderForBooking(customerId, booking);
  }

  /**
   * Opens (or re-opens) the gateway order for a booking that is waiting for payment.
   *
   * A pending payment for the same amount is reused rather than replaced, so a client that
   * retries after a dropped connection never leaves a trail of orphaned gateway orders.
   */
  async openOrderForBooking(customerId: string, booking: BookingDetailRecord): Promise<CreatePaymentOrderResult> {
    if (booking.customerId !== customerId) throw AppError.notFound('That booking was not found.');
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw AppError.conflict('CONFLICT', 'This booking is not waiting for an online payment.');
    }
    if (booking.totalMinor <= 0) {
      throw AppError.conflict('CONFLICT', 'This booking has nothing left to pay.');
    }

    const pending = booking.payments.find(
      (payment) => payment.status === PaymentStatus.PENDING && payment.amountMinor === booking.totalMinor,
    );

    const reusable = pending && pending.provider === this.provider.name ? pending : null;

    if (pending && !reusable) {
      // Left over from a different gateway (or a previous configuration): retire it rather
      // than leaving two open intents for the same booking.
      await this.prisma.payment.update({
        where: { id: pending.id },
        data: { status: PaymentStatus.CANCELLED, failureReason: 'Superseded by a new payment attempt.' },
      });
    }

    const payment =
      reusable ??
      (await this.createPaymentRecord({
        customerId,
        bookingId: booking.id,
        method: pending?.method ?? PaymentMethod.UPI,
        amountMinor: booking.totalMinor,
        currency: booking.currency,
      }));

    return this.openGatewayOrder(payment, {
      description: describeBooking(booking),
      reference: booking.reference,
    });
  }

  /**
   * Opens (or re-opens) the gateway order for a subscription purchase. A subscription is paid
   * for once, up front, so it reuses the same order machinery as a booking but has no booking
   * to confirm - the payment service activates the plan when the charge settles.
   */
  async openSubscriptionOrder(input: {
    customerId: string;
    subscriptionId: string;
    method: PaymentMethod;
    amountMinor: number;
    currency: string;
    description: string;
    reference: string;
  }): Promise<CreatePaymentOrderResult> {
    if (input.amountMinor <= 0) {
      throw AppError.conflict('CONFLICT', 'This plan has nothing to pay.');
    }

    const pending = await this.prisma.payment.findFirst({
      where: {
        subscriptionId: input.subscriptionId,
        status: PaymentStatus.PENDING,
        amountMinor: input.amountMinor,
      },
      orderBy: { createdAt: 'desc' },
    });

    const reusable = pending && pending.provider === this.provider.name ? pending : null;
    if (pending && !reusable) {
      await this.prisma.payment.update({
        where: { id: pending.id },
        data: { status: PaymentStatus.CANCELLED, failureReason: 'Superseded by a new payment attempt.' },
      });
    }

    const payment =
      reusable ??
      (await this.prisma.payment.create({
        data: {
          customerId: input.customerId,
          subscriptionId: input.subscriptionId,
          method: input.method,
          provider: this.provider.name,
          status: PaymentStatus.PENDING,
          amountMinor: input.amountMinor,
          currency: input.currency,
          isSimulated: this.provider.isSimulated,
        },
      }));

    return this.openGatewayOrder(payment, {
      description: input.description,
      reference: input.reference,
    });
  }

  /**
   * Opens the gateway order for an already persisted intent, reusing the gateway order id
   * when one exists. Shared by booking and subscription purchases so there is exactly one
   * place that talks to a gateway.
   */
  private async openGatewayOrder(
    payment: PrismaPayment,
    context: { description: string; reference: string },
  ): Promise<CreatePaymentOrderResult> {
    const customer = await this.prisma.user.findUnique({
      where: { id: payment.customerId },
      select: { phone: true, email: true },
    });

    if (payment.providerOrderId) {
      return this.toOrderResult(payment, {
        description: context.description,
        customerPhone: customer?.phone ?? null,
        customerEmail: customer?.email ?? null,
        bookingReference: context.reference,
      });
    }

    const order = await this.provider.createOrder({
      paymentId: payment.id,
      bookingReference: context.reference,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      description: context.description,
      customerPhone: customer?.phone ?? '',
      customerEmail: customer?.email ?? null,
    });

    const saved = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        provider: this.provider.name,
        providerOrderId: order.providerOrderId,
        isSimulated: order.isSimulated,
      },
    });

    return {
      paymentId: saved.id,
      provider: this.provider.name,
      amountMinor: saved.amountMinor,
      currency: saved.currency,
      providerOrderId: order.providerOrderId,
      isSimulated: order.isSimulated,
      checkout: order.checkout,
      mockCheckoutUrl: order.isSimulated ? this.simulatedCheckoutUrl(saved.id) : null,
    };
  }

  /**
   * Creates the payment intent for a booking. Called from booking creation so the booking
   * always has exactly one intent to pay, even before a gateway order exists.
   *
   * Idempotent for the same booking and amount: a retried booking request reuses the open
   * intent instead of opening a second one, which also preserves the customer's chosen
   * method.
   */
  async createPaymentRecord(input: {
    customerId: string;
    bookingId: string;
    subscriptionId?: string | null;
    method: PaymentMethod;
    amountMinor: number;
    currency: string;
  }): Promise<PrismaPayment> {
    const pending = await this.prisma.payment.findFirst({
      where: { bookingId: input.bookingId, status: PaymentStatus.PENDING, amountMinor: input.amountMinor },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) return pending;

    const isCash = input.method === PaymentMethod.CASH_AFTER_SERVICE;
    return this.prisma.payment.create({
      data: {
        customerId: input.customerId,
        bookingId: input.bookingId,
        subscriptionId: input.subscriptionId ?? null,
        method: input.method,
        provider: isCash ? PaymentProvider.CASH : this.provider.name,
        status: PaymentStatus.PENDING,
        amountMinor: input.amountMinor,
        currency: input.currency,
        isSimulated: isCash ? false : this.provider.isSimulated,
      },
    });
  }

  private toOrderResult(
    payment: PrismaPayment,
    context: {
      description: string;
      customerPhone: string | null;
      customerEmail: string | null;
      bookingReference: string;
    },
  ): CreatePaymentOrderResult {
    return {
      paymentId: payment.id,
      provider: payment.provider as PaymentProvider,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      providerOrderId: payment.providerOrderId,
      isSimulated: payment.isSimulated,
      checkout: {
        keyId: payment.provider === PaymentProvider.RAZORPAY ? (this.config.payments.razorpay.keyId ?? null) : null,
        orderId: payment.providerOrderId,
        name: BUSINESS_DISPLAY_NAME,
        description: context.description,
        prefillPhone: context.customerPhone,
        prefillEmail: context.customerEmail,
        notes: {
          bookingReference: context.bookingReference,
          ...(payment.isSimulated ? { simulated: 'true' } : {}),
        },
      },
      mockCheckoutUrl: payment.isSimulated ? this.simulatedCheckoutUrl(payment.id) : null,
    };
  }

  /** Browser-openable stand-in for a hosted checkout page; development only. */
  private simulatedCheckoutUrl(paymentId: string): string | null {
    if (!this.config.app.isDevelopment) return null;
    return `${this.config.app.publicUrl}/api/v1/payments/dev/simulate?paymentId=${encodeURIComponent(paymentId)}`;
  }

  /* ------------------------------------------------------------------ */
  /* Verification                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Confirms a payment with the gateway and, when it succeeds, moves the booking to
   * CONFIRMED. The customer id is part of the lookup, so one customer can never confirm
   * another customer's payment.
   */
  async verify(customerId: string, input: VerifyPaymentRequest): Promise<VerifyPaymentResult> {
    const payment = await this.prisma.payment.findFirst({ where: { id: input.paymentId, customerId } });
    if (!payment) throw AppError.notFound('That payment was not found.');
    this.assertPaymentTarget(payment, input);

    if (payment.status === PaymentStatus.PAID) {
      return this.resultFor(payment, { verified: true, message: 'This payment was already confirmed.' });
    }
    if (payment.status !== PaymentStatus.PENDING) {
      throw AppError.conflict(
        'CONFLICT',
        `This payment is already ${payment.status.toLowerCase().replace(/_/g, ' ')} and cannot be confirmed again.`,
      );
    }

    const result = await this.provider.verifyPayment({
      providerOrderId: input.providerOrderId ?? payment.providerOrderId,
      providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
      signature: input.providerSignature,
      amountMinor: payment.amountMinor,
    });

    if (!result.verified) {
      await this.markFailed(payment.id, result.message);
      return this.resultFor(await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }), {
        verified: false,
        message: result.message,
      });
    }

    return this.applySuccess(payment.id, {
      providerOrderId: input.providerOrderId ?? payment.providerOrderId,
      providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
      signature: input.providerSignature,
      message: result.message,
      isSimulated: payment.isSimulated || this.provider.isSimulated,
    });
  }

  /**
   * A payment belongs to exactly one target - the booking or the subscription it was opened
   * for. The client cannot retarget an intent at somebody else's booking or plan.
   */
  private assertPaymentTarget(
    payment: PrismaPayment,
    input: { bookingId?: string | null; subscriptionId?: string | null },
  ): void {
    if (payment.bookingId) {
      if (!input.bookingId || payment.bookingId !== input.bookingId) {
        throw AppError.badRequest('VALIDATION_FAILED', 'That payment does not belong to this booking.');
      }
      return;
    }
    if (payment.subscriptionId) {
      if (!input.subscriptionId || payment.subscriptionId !== input.subscriptionId) {
        throw AppError.badRequest('VALIDATION_FAILED', 'That payment does not belong to this subscription.');
      }
      return;
    }
    throw AppError.badRequest('VALIDATION_FAILED', 'That payment is not linked to a booking or a subscription.');
  }

  /** The response for whichever target the payment settled: a booking, a plan, or neither. */
  private async resultFor(
    payment: PrismaPayment,
    outcome: { verified: boolean; message: string },
  ): Promise<VerifyPaymentResult> {
    return {
      booking: payment.bookingId ? await this.loadBookingDetail(payment.bookingId) : null,
      subscription: payment.subscriptionId ? await this.loadSubscription(payment.subscriptionId) : null,
      verified: outcome.verified,
      message: outcome.message,
    };
  }

  /**
   * Development-only shortcut that stands in for the gateway checkout. It runs the exact
   * confirmation path a real verification uses, so the lifecycle under test is the
   * production one.
   *
   * `customerId` is omitted only by the development checkout page, which has no session.
   */
  async simulate(
    paymentId: string,
    outcome: 'success' | 'failure',
    customerId?: string,
  ): Promise<VerifyPaymentResult> {
    if (!this.config.app.isDevelopment || !this.provider.isSimulated) {
      throw AppError.notFound('The simulated payment flow is not available on this server.');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, ...(customerId ? { customerId } : {}) },
    });
    if (!payment) throw AppError.notFound('That payment was not found.');

    if (outcome === 'failure') {
      if (payment.status === PaymentStatus.PENDING) {
        await this.markFailed(payment.id, 'Simulated payment declined.');
      }
      return this.resultFor(await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }), {
        verified: false,
        message: 'Simulated payment declined. No real money moved.',
      });
    }

    if (payment.status === PaymentStatus.PAID) {
      return this.resultFor(payment, { verified: true, message: 'Simulated payment was already confirmed.' });
    }

    const slug = payment.id.replace(/-/g, '').slice(0, 18);
    return this.applySuccess(payment.id, {
      providerOrderId: payment.providerOrderId ?? `mock_order_${slug}`,
      providerPaymentId: `mock_pay_${slug}`,
      signature: null,
      message: 'Simulated payment confirmed. No real money was charged.',
      isSimulated: true,
    });
  }

  private async applySuccess(
    paymentId: string,
    context: {
      providerOrderId: string | null;
      providerPaymentId: string | null;
      signature: string | null;
      message: string;
      isSimulated: boolean;
    },
  ): Promise<VerifyPaymentResult> {
    // Compare-and-set: only the request that actually moved the row out of PENDING may
    // confirm the booking, so a webhook racing a client callback is harmless.
    const claimed = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.PAID,
        paidAt: new Date(),
        failureReason: null,
        isSimulated: context.isSimulated,
        ...(context.providerOrderId ? { providerOrderId: context.providerOrderId } : {}),
        ...(context.providerPaymentId ? { providerPaymentId: context.providerPaymentId } : {}),
        ...(context.signature ? { providerSignature: context.signature } : {}),
      },
    });

    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    if (claimed.count > 0) {
      if (payment.bookingId) {
        await this.confirmBookingAfterPayment(payment.bookingId, payment.id);
      } else if (payment.subscriptionId) {
        await this.activateSubscriptionAfterPayment(payment.subscriptionId, payment.id);
      }
      await this.audit.record({
        actorUserId: payment.customerId,
        actorRole: 'CUSTOMER',
        action: 'UPDATE',
        entity: 'Payment',
        entityId: payment.id,
        summary: `Payment captured${context.isSimulated ? ' (simulated)' : ''} for ${payment.amountMinor} ${payment.currency}.`,
      });
    }

    return this.resultFor(payment, { verified: true, message: context.message });
  }

  /**
   * Activates the plan a settled payment bought. The validity window is computed here, on
   * the server, from the plan's own `validityDays` - and only for a subscription that is
   * still waiting for payment, so a duplicate confirmation cannot extend a plan.
   */
  private async activateSubscriptionAfterPayment(subscriptionId: string, paymentId: string): Promise<void> {
    const subscription = await this.prisma.customerSubscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription || subscription.status !== SubscriptionStatus.PENDING_PAYMENT) return;

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: subscription.planId } });
    if (!plan) throw AppError.internal('That subscription plan is no longer available.');

    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + plan.validityDays * 86_400_000);

    const activated = await this.prisma.customerSubscription.updateMany({
      where: { id: subscriptionId, status: SubscriptionStatus.PENDING_PAYMENT },
      data: { status: SubscriptionStatus.ACTIVE, startsAt, expiresAt },
    });
    if (activated.count === 0) return;

    await this.notifications.notify({
      userId: subscription.customerId,
      type: NotificationType.PAYMENT_SUCCESS,
      title: 'Your plan is active',
      body: `${plan.name} is now active until ${expiresAt.toDateString()} with ${subscription.visitsTotal} visit(s).`,
      data: { subscriptionId, planId: plan.id, paymentId },
    });
  }

  private async markFailed(paymentId: string, reason: string): Promise<void> {
    const result = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.FAILED, failureReason: reason },
    });
    if (result.count === 0) return;

    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return;
    await this.notifications.notify({
      userId: payment.customerId,
      type: NotificationType.PAYMENT_FAILED,
      title: 'Payment could not be completed',
      body: reason,
      data: { paymentId: payment.id, ...(payment.bookingId ? { bookingId: payment.bookingId } : {}) },
    });
  }

  /**
   * The single place a booking becomes CONFIRMED. Safe to call repeatedly: the booking is
   * re-read inside the transaction and the transition guard rejects any illegal jump.
   */
  private async confirmBookingAfterPayment(bookingId: string, paymentId: string): Promise<void> {
    await this.prisma.runWithRetry(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking || booking.status !== BookingStatus.PENDING_PAYMENT) return;
      assertTransition(booking.status as BookingStatus, BookingStatus.CONFIRMED);
      await tx.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CONFIRMED } });
      await writeStatusHistory(tx, {
        bookingId: booking.id,
        status: BookingStatus.CONFIRMED,
        actorRole: 'SYSTEM',
        note: 'Payment received.',
      });
    });

    await this.ensureInvoice(bookingId, paymentId);

    const detail = await loadBookingDetailOrThrow(this.prisma, bookingId);
    await this.notifications.notify({
      userId: detail.customerId,
      type: NotificationType.PAYMENT_SUCCESS,
      title: 'Payment successful',
      body: `We received your payment for booking ${detail.reference}.`,
      data: { paymentId, bookingId: detail.id, reference: detail.reference },
    });
    this.realtime.emitBookingUpdate(toRealtimeEvent(detail), [detail.customerId]);
  }

  private async loadBookingDetail(bookingId: string): Promise<BookingDetail> {
    const detail = await loadBookingDetailOrThrow(this.prisma, bookingId);
    return toBookingDetail(detail, await this.settings.get());
  }

  private async loadSubscription(subscriptionId: string): Promise<CustomerSubscription> {
    const record = await this.prisma.customerSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: subscriptionInclude,
    });
    return toCustomerSubscription(record as SubscriptionRecord);
  }

  /* ------------------------------------------------------------------ */
  /* Webhooks                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Gateway callback. Rejected unless the signature verifies, then deduplicated on
   * `(provider, eventId)` before anything is applied.
   */
  async handleWebhook(providerName: string, rawBody: string, headers: WebhookHeaders): Promise<WebhookResult> {
    const adapter = this.resolveAdapter(providerName);
    const signature = firstHeader(headers[signatureHeaderFor(providerName)]);

    if (!adapter.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn(`Rejected ${providerName} webhook with an invalid signature`);
      throw AppError.badRequest('PAYMENT_VERIFICATION_FAILED', 'The webhook signature could not be verified.');
    }

    const parsed = adapter.parseWebhook(rawBody, headers);

    let recordId: string;
    try {
      const record = await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: String(adapter.name),
          eventId: parsed.eventId,
          eventType: parsed.eventType,
          payload: (safeJson(rawBody) ?? { raw: rawBody.slice(0, 2000) }) as Prisma.InputJsonValue,
          signatureValid: true,
        },
      });
      recordId = record.id;
    } catch (error) {
      // `@@unique([provider, eventId])` is the dedupe guard: the gateway retried an event
      // we have already applied.
      if (isUniqueViolation(error)) {
        return { received: true, duplicate: true, outcome: 'IGNORED' };
      }
      throw error;
    }

    try {
      switch (parsed.outcome) {
        case 'PAID':
          await this.applyWebhookPaid(parsed);
          break;
        case 'FAILED':
          await this.applyWebhookFailed(parsed);
          break;
        case 'REFUNDED':
          await this.applyWebhookRefunded(parsed);
          break;
        default:
          break;
      }
      await this.prisma.paymentWebhookEvent.update({
        where: { id: recordId },
        data: { processedAt: new Date(), processingNote: `Applied ${parsed.outcome}.` },
      });
    } catch (error) {
      await this.prisma.paymentWebhookEvent.update({
        where: { id: recordId },
        data: {
          processedAt: new Date(),
          processingNote: `Failed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`,
        },
      });
      throw error;
    }

    return { received: true, duplicate: false, outcome: parsed.outcome };
  }

  private async applyWebhookPaid(parsed: ParsedWebhook): Promise<void> {
    const payment = await this.findPaymentByGatewayIds(parsed);
    if (!payment) {
      this.logger.warn(`Webhook ${parsed.eventId} does not match any payment`);
      return;
    }
    if (payment.status === PaymentStatus.PAID) return;

    await this.applySuccess(payment.id, {
      providerOrderId: parsed.providerOrderId ?? payment.providerOrderId,
      providerPaymentId: parsed.providerPaymentId ?? payment.providerPaymentId,
      signature: null,
      message: 'Payment confirmed by the gateway.',
      isSimulated: payment.isSimulated,
    });
  }

  private async applyWebhookFailed(parsed: ParsedWebhook): Promise<void> {
    const payment = await this.findPaymentByGatewayIds(parsed);
    if (!payment || payment.status !== PaymentStatus.PENDING) return;
    await this.markFailed(payment.id, 'The gateway reported that this payment failed.');
  }

  private async applyWebhookRefunded(parsed: ParsedWebhook): Promise<void> {
    const payment = await this.findPaymentByGatewayIds(parsed);
    if (!payment) return;

    if (parsed.providerPaymentId) {
      const refund = await this.prisma.refund.findFirst({
        where: { paymentId: payment.id, providerRefundId: parsed.providerPaymentId },
      });
      if (refund) {
        await this.prisma.refund.update({
          where: { id: refund.id },
          data: { status: RefundStatus.COMPLETED, processedAt: new Date(), failureReason: null },
        });
      }
    }

    // Re-derive the refunded total from the refund rows rather than trusting the payload.
    const settled = await this.prisma.refund.findMany({
      where: { paymentId: payment.id, status: { in: [RefundStatus.APPROVED, RefundStatus.PROCESSING, RefundStatus.COMPLETED] } },
      select: { amountMinor: true },
    });
    const refundedTotal = settled.reduce((total, entry) => total + entry.amountMinor, 0);

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmountMinor: refundedTotal,
        status:
          refundedTotal <= 0
            ? payment.status
            : refundedTotal >= payment.amountMinor
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
      },
    });

    await this.notifications.notify({
      userId: payment.customerId,
      type: NotificationType.REFUND_UPDATE,
      title: 'Refund processed',
      body: 'Your refund has been processed by the payment gateway.',
      data: { paymentId: payment.id },
    });
  }

  private findPaymentByGatewayIds(parsed: ParsedWebhook): Promise<PrismaPayment | null> {
    if (parsed.providerOrderId) {
      return this.prisma.payment.findFirst({ where: { providerOrderId: parsed.providerOrderId } });
    }
    if (parsed.providerPaymentId) {
      return this.prisma.payment.findFirst({ where: { providerPaymentId: parsed.providerPaymentId } });
    }
    return Promise.resolve(null);
  }

  private resolveAdapter(providerName: string): PaymentProviderAdapter {
    if (providerName.toLowerCase() !== this.provider.name.toLowerCase()) {
      throw AppError.notFound(`There is no configured payment gateway named "${providerName}".`);
    }
    return this.provider;
  }

  /* ------------------------------------------------------------------ */
  /* Refunds                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Issues the automatic refund for a cancelled booking.
   *
   * Returns null when there is nothing to refund, and cancels a pending intent so the
   * customer is never charged for a booking that no longer exists.
   */
  async refundForCancellation(input: {
    bookingId: string;
    amountMinor: number;
    reason: string;
    requestedByUserId: string;
    requestedByRole: UserRole | 'SYSTEM';
  }): Promise<Refund | null> {
    const payment = await this.prisma.payment.findFirst({
      where: {
        bookingId: input.bookingId,
        status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      await this.prisma.payment.updateMany({
        where: { bookingId: input.bookingId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELLED, failureReason: 'Booking cancelled before payment was collected.' },
      });
      return null;
    }

    const refundableMinor = Math.max(0, payment.amountMinor - payment.refundedAmountMinor);
    const amountMinor = Math.min(Math.max(0, input.amountMinor), refundableMinor);
    if (amountMinor <= 0) return null;

    const idempotencyKey = `cancel:${input.bookingId}`;
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
    if (existing) return toRefundDto(existing);

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: payment.id,
        bookingId: input.bookingId,
        customerId: payment.customerId,
        amountMinor,
        status: RefundStatus.REQUESTED,
        reason: input.reason,
        requestedByUserId: input.requestedByUserId,
        requestedByRole: String(input.requestedByRole),
        idempotencyKey,
      },
    });

    const result = await this.provider.refund({
      providerPaymentId: payment.providerPaymentId,
      amountMinor,
      reason: input.reason,
    });

    const updated = await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: result.status,
        providerRefundId: result.providerRefundId,
        failureReason: result.failureReason,
        processedAt: result.status === RefundStatus.COMPLETED ? new Date() : null,
      },
    });

    const refundedTotal = payment.refundedAmountMinor + amountMinor;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmountMinor: refundedTotal,
        status: refundedTotal >= payment.amountMinor ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
      },
    });

    await this.notifications.notify({
      userId: payment.customerId,
      type: NotificationType.REFUND_UPDATE,
      title: result.status === RefundStatus.COMPLETED ? 'Refund issued' : 'Refund in progress',
      body:
        result.status === RefundStatus.COMPLETED
          ? 'We have refunded the eligible amount to your original payment method.'
          : 'Your refund is being processed and will reach your payment method shortly.',
      data: { refundId: updated.id, bookingId: input.bookingId },
    });

    await this.audit.record({
      actorUserId: input.requestedByUserId,
      actorRole: input.requestedByRole,
      action: 'REFUND',
      entity: 'Refund',
      entityId: updated.id,
      summary: `Refund of ${amountMinor} issued for booking ${input.bookingId}.`,
    });

    return toRefundDto(updated);
  }

  /* ------------------------------------------------------------------ */
  /* Read models                                                         */
  /* ------------------------------------------------------------------ */

  async listForCustomer(
    customerId: string,
    query: { page?: number; pageSize?: number },
  ): Promise<Paginated<PaymentRow>> {
    const paging = resolvePagination(query);
    const where: Prisma.PaymentWhereInput = { customerId };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: paging.skip, take: paging.take }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        bookingId: row.bookingId ?? row.subscriptionId ?? '',
        amountMinor: row.amountMinor,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      paging,
    );
  }

  async listRefundsForCustomer(customerId: string): Promise<{ items: Refund[] }> {
    const refunds = await this.prisma.refund.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
    return { items: refunds.map(toRefundDto) };
  }

  async listAllForAdmin(query: { page?: number; pageSize?: number; status?: string }) {
    const paging = resolvePagination(query);
    const where: Prisma.PaymentWhereInput = query.status
      ? { status: query.status as PaymentStatus }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: paging.skip,
        take: paging.take,
        include: { booking: { select: { reference: true } } },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        bookingReference: row.booking?.reference ?? '-',
        amountMinor: row.amountMinor,
        status: row.status,
        method: row.method,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      paging,
    );
  }

  async listAllRefundsForAdmin(query: { page?: number; pageSize?: number }): Promise<Paginated<Refund>> {
    const paging = resolvePagination(query);
    const [rows, total] = await Promise.all([
      this.prisma.refund.findMany({ orderBy: { createdAt: 'desc' }, skip: paging.skip, take: paging.take }),
      this.prisma.refund.count(),
    ]);
    return paginate(rows.map(toRefundDto), total, paging);
  }

  /* ------------------------------------------------------------------ */
  /* Invoices                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Issues the invoice for a booking exactly once.
   *
   * The sequence number is derived from the rows already stored for the year; a collision
   * (two bookings paid in the same instant) is retried rather than overwritten.
   */
  async ensureInvoice(bookingId: string, paymentId?: string | null): Promise<PrismaInvoice | null> {
    const existing = await this.prisma.invoice.findUnique({ where: { bookingId } });
    if (existing) return existing;

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: { select: { phone: true, name: true } } },
    });
    if (!booking) return null;

    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < INVOICE_NUMBER_ATTEMPTS; attempt += 1) {
      const issuedThisYear = await this.prisma.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } });
      try {
        return await this.prisma.invoice.create({
          data: {
            number: generateInvoiceNumber(year, issuedThisYear + 1),
            bookingId,
            paymentId: paymentId ?? null,
            customerName: booking.customer.name ?? booking.customer.phone,
            customerPhone: booking.customer.phone,
            subtotalMinor: booking.subtotalMinor,
            discountMinor: booking.discountMinor,
            taxMinor: booking.taxAmountMinor,
            totalMinor: booking.totalMinor,
            currency: booking.currency,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        this.logger.warn(`Invoice number collision for booking ${bookingId}; retrying (attempt ${attempt + 1})`);
      }
    }

    throw AppError.internal('We could not issue an invoice number for this booking. Please try again.');
  }

  /** Printable invoice document; the customer app opens this URL in the device browser. */
  async renderInvoice(input: {
    bookingId: string;
    requesterId: string;
    requesterRole: UserRole;
  }): Promise<string> {
    const booking = await loadBookingDetailOrThrow(this.prisma, input.bookingId);
    if (input.requesterRole !== 'ADMIN' && booking.customerId !== input.requesterId) {
      throw AppError.notFound('That booking was not found.');
    }

    const paidPayment = booking.payments.find((payment) => payment.status === PaymentStatus.PAID);
    const invoice = await this.ensureInvoice(booking.id, paidPayment?.id ?? null);
    if (!invoice) throw AppError.notFound('That booking was not found.');

    return renderInvoiceHtml({
      invoice,
      reference: booking.reference,
      status: booking.status,
      scheduledStart: booking.scheduledStart.toISOString(),
      serviceNames: booking.items.map((item) => item.serviceName),
    });
  }
}

/* -------------------------------------------------------------------- */
/* Helpers                                                               */
/* -------------------------------------------------------------------- */

function describeBooking(booking: BookingDetailRecord): string {
  const names = booking.items.map((item) => item.serviceName).join(', ');
  return `${names || 'Autowra service'} - ${booking.reference}`;
}

function signatureHeaderFor(providerName: string): string {
  return providerName.toLowerCase() === 'razorpay' ? 'x-razorpay-signature' : 'x-mock-signature';
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function safeJson(rawBody: string): unknown | null {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return true;
  const message = error instanceof Error ? error.message : '';
  return message.includes('Unique constraint');
}

export function toRefundDto(refund: Prisma.RefundGetPayload<Record<string, never>>): Refund {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    bookingId: refund.bookingId ?? '',
    amountMinor: refund.amountMinor,
    status: refund.status as RefundStatus,
    reason: refund.reason,
    providerRefundId: refund.providerRefundId,
    requestedAt: refund.createdAt.toISOString(),
    processedAt: refund.processedAt ? refund.processedAt.toISOString() : null,
    failureReason: refund.failureReason,
    requestedByRole: refund.requestedByRole as UserRole,
  };
}

function renderInvoiceHtml(input: {
  invoice: PrismaInvoice;
  reference: string;
  status: BookingStatus;
  scheduledStart: string;
  serviceNames: string[];
}): string {
  const { invoice } = input;
  const money = (minor: number) => `${invoice.currency} ${(minor / 100).toFixed(2)}`;
  const row = (label: string, value: string) =>
    `<tr><th align="left">${escapeHtml(label)}</th><td align="right">${escapeHtml(value)}</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${escapeHtml(invoice.number)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 32px; color: #14181f; background: #f4f6f9; }
  main { max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #dfe4eb; border-radius: 12px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 24px; color: #5a6472; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 8px 0; border-bottom: 1px solid #eef1f5; font-weight: 400; }
  tr:last-child th, tr:last-child td { border-bottom: 0; font-weight: 600; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; font-size: 14px; margin: 0 0 24px; }
  dt { color: #5a6472; } dd { margin: 0; }
</style>
</head>
<body>
<main>
  <h1>Autowra invoice ${escapeHtml(invoice.number)}</h1>
  <p>Issued ${escapeHtml(invoice.issuedAt.toISOString())}</p>
  <dl>
    <dt>Billed to</dt><dd>${escapeHtml(invoice.customerName)} (${escapeHtml(invoice.customerPhone)})</dd>
    <dt>Booking</dt><dd>${escapeHtml(input.reference)}</dd>
    <dt>Services</dt><dd>${escapeHtml(input.serviceNames.join(', '))}</dd>
    <dt>Scheduled</dt><dd>${escapeHtml(input.scheduledStart)}</dd>
    <dt>Status</dt><dd>${escapeHtml(input.status)}</dd>
  </dl>
  <table>
    ${row('Subtotal', money(invoice.subtotalMinor))}
    ${invoice.discountMinor > 0 ? row('Discounts', `- ${money(invoice.discountMinor)}`) : ''}
    ${row('Taxes', money(invoice.taxMinor))}
    ${row('Total', money(invoice.totalMinor))}
  </table>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
