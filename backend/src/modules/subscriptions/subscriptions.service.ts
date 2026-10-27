import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  NotificationType,
  SubscriptionStatus,
  type CreatePaymentOrderResult,
  type CustomerSubscription,
  type SubscriptionPlan,
} from '@autowra/shared-types';
import type { SubscribeInput } from '@autowra/validation';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { VehiclesService } from '../customers/customer-assets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import {
  subscriptionInclude,
  toCustomerSubscription,
  toSubscriptionPlan,
  type SubscriptionRecord,
} from './subscription.mapper';

export interface SubscribeResult {
  readonly subscription: CustomerSubscription;
  /** Null when the plan needs no online payment (a free or fully discounted plan). */
  readonly payment: CreatePaymentOrderResult | null;
}

/**
 * Subscription plans.
 *
 * Buying a plan creates the entitlement first and the payment intent second, and the plan only
 * becomes `ACTIVE` when the payment service confirms the charge - so a customer can never use
 * visits they have not paid for. Consuming a visit happens in the booking flow, where the
 * unique `SubscriptionUsage.bookingId` is what stops one visit being spent twice.
 *
 * Nothing renews automatically: `autoRenew` stays false and there is no recurring charge.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Catalogue                                                           */
  /* ------------------------------------------------------------------ */

  async listPlans(): Promise<{ items: SubscriptionPlan[] }> {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }],
    });
    return { items: plans.map(toSubscriptionPlan) };
  }

  /* ------------------------------------------------------------------ */
  /* Customer subscriptions                                              */
  /* ------------------------------------------------------------------ */

  async listMine(customerId: string): Promise<{ items: CustomerSubscription[] }> {
    await this.expireLapsed(customerId);
    const subscriptions = await this.prisma.customerSubscription.findMany({
      where: { customerId },
      include: subscriptionInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { items: subscriptions.map((row) => toCustomerSubscription(row as SubscriptionRecord)) };
  }

  /**
   * Starts a plan purchase.
   *
   * The entitlement row is written as `PENDING_PAYMENT` before the gateway order exists, so a
   * purchase that is abandoned leaves a cancelable pending row rather than a free plan. The
   * idempotency key makes a retried request return the same subscription.
   */
  async subscribe(customerId: string, input: SubscribeInput): Promise<SubscribeResult> {
    const replay = await this.prisma.customerSubscription.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: subscriptionInclude,
    });
    if (replay) {
      if (replay.customerId !== customerId) {
        throw AppError.conflict('CONFLICT', 'That request identifier has already been used.');
      }
      return {
        subscription: toCustomerSubscription(replay as SubscriptionRecord),
        payment: replay.status === SubscriptionStatus.PENDING_PAYMENT ? await this.openOrder(replay.id) : null,
      };
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.isActive) throw AppError.notFound('That plan is no longer available.');

    const vehicle = await this.vehicles.getOrThrow(customerId, input.vehicleId);
    if (vehicle.type !== plan.vehicleType) {
      throw AppError.badRequest(
        'VALIDATION_FAILED',
        `This plan covers ${plan.vehicleType.toLowerCase()} services, but the selected vehicle is registered as ${vehicle.type.toLowerCase()}.`,
      );
    }

    this.payments.assertOnlinePaymentAvailable(input.paymentMethod);

    const existingOnVehicle = await this.prisma.customerSubscription.findFirst({
      where: { customerId, vehicleId: vehicle.id, status: SubscriptionStatus.ACTIVE },
      select: { id: true, plan: { select: { name: true } } },
    });
    if (existingOnVehicle) {
      throw AppError.conflict(
        'CONFLICT',
        `This vehicle is already covered by "${existingOnVehicle.plan.name}". Cancel it first to switch plans.`,
      );
    }

    const now = new Date();
    const subscription = await this.prisma.customerSubscription.create({
      data: {
        customerId,
        planId: plan.id,
        vehicleId: vehicle.id,
        status: SubscriptionStatus.PENDING_PAYMENT,
        visitsTotal: plan.visitAllowance,
        visitsUsed: 0,
        // Provisional window: it is recomputed from the plan when the payment settles.
        startsAt: now,
        expiresAt: new Date(now.getTime() + plan.validityDays * 86_400_000),
        autoRenew: false,
        idempotencyKey: input.idempotencyKey,
      },
      include: subscriptionInclude,
    });

    await this.audit.record({
      actorUserId: customerId,
      actorRole: 'CUSTOMER',
      action: 'CREATE',
      entity: 'CustomerSubscription',
      entityId: subscription.id,
      summary: `Plan ${plan.slug} started for ${plan.priceMinor} ${plan.currency}.`,
    });

    return {
      subscription: toCustomerSubscription(subscription as SubscriptionRecord),
      payment: await this.openOrder(subscription.id),
    };
  }

  /** Cancels a pending purchase outright, or stops an active plan from being used further. */
  async cancel(customerId: string, subscriptionId: string): Promise<CustomerSubscription> {
    const subscription = await this.prisma.customerSubscription.findFirst({
      where: { id: subscriptionId, customerId },
      include: subscriptionInclude,
    });
    if (!subscription) throw AppError.notFound('That subscription was not found.');

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      return toCustomerSubscription(subscription as SubscriptionRecord);
    }
    if (
      subscription.status === SubscriptionStatus.EXPIRED ||
      subscription.status === SubscriptionStatus.PENDING_PAYMENT
    ) {
      // A pending purchase is cancelled and its open payment intent retired, so the customer
      // is never charged for a plan they walked away from.
      const updated = await this.prisma.customerSubscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
        include: subscriptionInclude,
      });
      await this.prisma.payment.updateMany({
        where: { subscriptionId: subscription.id, status: 'PENDING' },
        data: { status: 'CANCELLED', failureReason: 'The plan purchase was cancelled.' },
      });
      await this.audit.record({
        actorUserId: customerId,
        actorRole: 'CUSTOMER',
        action: 'UPDATE',
        entity: 'CustomerSubscription',
        entityId: subscription.id,
        summary: 'Pending plan purchase cancelled.',
      });
      return toCustomerSubscription(updated as SubscriptionRecord);
    }

    const updated = await this.prisma.customerSubscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date(), autoRenew: false },
      include: subscriptionInclude,
    });

    await this.notifications.notify({
      userId: customerId,
      type: NotificationType.SUBSCRIPTION_UPDATE,
      title: 'Plan cancelled',
      body: `Your "${subscription.plan.name}" plan has been cancelled. Unused visits are no longer claimable.`,
      data: { subscriptionId: subscription.id },
    });
    await this.audit.record({
      actorUserId: customerId,
      actorRole: 'CUSTOMER',
      action: 'UPDATE',
      entity: 'CustomerSubscription',
      entityId: subscription.id,
      summary: 'Active plan cancelled by the customer.',
    });

    return toCustomerSubscription(updated as SubscriptionRecord);
  }

  /* ------------------------------------------------------------------ */
  /* Expiry                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Marks lapsed subscriptions expired. Called on every read so the status a customer sees is
   * never stale, and swept nightly so admin reports do not depend on somebody opening the app.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async expireAll(): Promise<number> {
    const result = await this.prisma.customerSubscription.updateMany({
      where: { status: SubscriptionStatus.ACTIVE, expiresAt: { lt: new Date() } },
      data: { status: SubscriptionStatus.EXPIRED },
    });
    if (result.count > 0) this.logger.log(`Expired ${result.count} subscription(s)`);
    return result.count;
  }

  private async expireLapsed(customerId: string): Promise<void> {
    await this.prisma.customerSubscription.updateMany({
      where: { customerId, status: SubscriptionStatus.ACTIVE, expiresAt: { lt: new Date() } },
      data: { status: SubscriptionStatus.EXPIRED },
    });
  }

  private async openOrder(subscriptionId: string): Promise<CreatePaymentOrderResult | null> {
    const subscription = await this.prisma.customerSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw AppError.notFound('That subscription was not found.');
    if (subscription.plan.priceMinor <= 0) return null;

    return this.payments.openSubscriptionOrder({
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      method: 'UPI',
      amountMinor: subscription.plan.priceMinor,
      currency: subscription.plan.currency,
      description: `${subscription.plan.name} plan`,
      reference: subscription.id.slice(0, 8).toUpperCase(),
    });
  }
}
