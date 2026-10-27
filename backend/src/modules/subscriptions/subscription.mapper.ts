import type { Prisma } from '@prisma/client';
import type { CustomerSubscription, SubscriptionPlan, VehicleType } from '@autowra/shared-types';

/** Plan name is needed on every subscription row the customer sees. */
export const subscriptionInclude = {
  plan: { select: { name: true } },
} satisfies Prisma.CustomerSubscriptionInclude;

export type SubscriptionRecord = Prisma.CustomerSubscriptionGetPayload<{
  include: typeof subscriptionInclude;
}>;

type PlanRecord = Prisma.SubscriptionPlanGetPayload<Record<string, never>>;

export function toSubscriptionPlan(plan: PlanRecord): SubscriptionPlan {
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    priceMinor: plan.priceMinor,
    currency: plan.currency,
    validityDays: plan.validityDays,
    visitAllowance: plan.visitAllowance,
    vehicleType: plan.vehicleType as VehicleType,
    eligibleServiceSlugs: plan.eligibleServiceSlugs,
    benefits: plan.benefits,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
  };
}

export function toCustomerSubscription(record: SubscriptionRecord): CustomerSubscription {
  return {
    id: record.id,
    planId: record.planId,
    planName: record.plan.name,
    status: record.status as CustomerSubscription['status'],
    visitsTotal: record.visitsTotal,
    visitsUsed: record.visitsUsed,
    // Derived, never stored: the count of remaining visits is always consistent with usage.
    visitsRemaining: Math.max(0, record.visitsTotal - record.visitsUsed),
    startsAt: record.startsAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    cancelledAt: record.cancelledAt ? record.cancelledAt.toISOString() : null,
    autoRenew: record.autoRenew,
  };
}
