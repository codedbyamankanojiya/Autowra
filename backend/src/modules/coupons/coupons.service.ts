import { Injectable } from '@nestjs/common';
import type { Coupon as PrismaCoupon } from '@prisma/client';
import {
  CouponType,
  clampNonNegative,
  percentOf,
  type Coupon,
  type CouponValidationResult,
  type VehicleType,
} from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import type { Db } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

export interface CouponEvaluationInput {
  readonly code: string;
  readonly customerId: string;
  readonly vehicleType: VehicleType;
  readonly subtotalMinor: number;
  readonly isFirstBooking: boolean;
}

/**
 * Coupon evaluation.
 *
 * All rules are applied server side against the database: the client only ever sends a code,
 * never a discount amount. The returned `discountMinor` is what the pricing engine uses.
 */
@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(input: CouponEvaluationInput, db: Db = this.prisma): Promise<CouponValidationResult> {
    const code = input.code.trim().toUpperCase();
    const coupon = await db.coupon.findUnique({ where: { code } });
    if (!coupon) {
      return invalid('That coupon code is not recognised.');
    }

    const reason = this.rejectionReason(coupon, input);
    if (reason) {
      return { valid: false, coupon: toCouponDto(coupon), discountMinor: 0, message: reason };
    }

    const discountMinor = this.computeDiscount(coupon, input.subtotalMinor);
    if (discountMinor <= 0) {
      return {
        valid: false,
        coupon: toCouponDto(coupon),
        discountMinor: 0,
        message: 'This coupon does not reduce the price of your current selection.',
      };
    }

    return {
      valid: true,
      coupon: toCouponDto(coupon),
      discountMinor,
      message: `Coupon ${coupon.code} applied. You save on this booking.`,
    };
  }

  /** Pure arithmetic: separated so unit tests can cover it without a database. */
  computeDiscount(coupon: PrismaCoupon | Coupon, subtotalMinor: number): number {
    if (subtotalMinor <= 0) return 0;
    const raw =
      coupon.type === CouponType.PERCENTAGE
        ? percentOf(subtotalMinor, coupon.value)
        : Math.round(coupon.value * 100) / 100;
    const capped = coupon.maxDiscountMinor !== null ? Math.min(raw, coupon.maxDiscountMinor) : raw;
    return clampNonNegative(Math.min(Math.round(capped), subtotalMinor));
  }

  private rejectionReason(coupon: PrismaCoupon, input: CouponEvaluationInput): string | null {
    const now = new Date();
    if (!coupon.isActive) return 'This coupon is no longer active.';
    if (coupon.startsAt > now) return 'This coupon is not active yet.';
    if (coupon.endsAt && coupon.endsAt < now) return 'This coupon has expired.';
    if (coupon.appliesToVehicleType && coupon.appliesToVehicleType !== input.vehicleType) {
      return `This coupon is only valid for ${coupon.appliesToVehicleType.toLowerCase()} bookings.`;
    }
    if (coupon.minOrderMinor > input.subtotalMinor) {
      return `Add more services to use this coupon - the minimum order is reached at a higher value.`;
    }
    if (coupon.firstBookingOnly && !input.isFirstBooking) {
      return 'This coupon is valid on your first booking only.';
    }
    if (coupon.usageLimitTotal !== null && coupon.usedCount >= coupon.usageLimitTotal) {
      return 'This coupon has reached its usage limit.';
    }
    return null;
  }

  /** Per-customer limits are checked against redemptions, not a counter. */
  async assertCustomerEligible(couponId: string, customerId: string, db: Db = this.prisma): Promise<void> {
    const coupon = await db.coupon.findUnique({ where: { id: couponId } });
    if (!coupon || coupon.usageLimitPerCustomer === null) return;
    const used = await db.couponRedemption.count({ where: { couponId, customerId } });
    if (used >= coupon.usageLimitPerCustomer) {
      throw AppError.conflict('COUPON_INVALID', 'You have already used this coupon the maximum number of times.');
    }
  }

  /**
   * Reserves one redemption of a coupon.
   *
   * The `usedCount < usageLimitTotal` predicate is evaluated by PostgreSQL while the row is
   * locked, so two concurrent bookings cannot push the coupon past its total limit.
   */
  async consume(couponId: string, db: Db): Promise<void> {
    const affected = await db.$executeRaw`
      UPDATE "Coupon"
      SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
      WHERE "id" = ${couponId}
        AND "isActive" = true
        AND ("usageLimitTotal" IS NULL OR "usedCount" < "usageLimitTotal")
    `;
    if (affected === 0) {
      throw AppError.conflict('COUPON_INVALID', 'This coupon has just reached its usage limit.');
    }
  }

  async listActive(db: Db = this.prisma): Promise<Coupon[]> {
    const coupons = await db.coupon.findMany({
      where: { isActive: true, endsAt: { gte: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return coupons.map(toCouponDto);
  }
}

function invalid(message: string): CouponValidationResult {
  return { valid: false, coupon: null, discountMinor: 0, message };
}

export function toCouponDto(coupon: PrismaCoupon): Coupon {
  return {
    id: coupon.id,
    code: coupon.code,
    title: coupon.title,
    description: coupon.description,
    type: coupon.type as Coupon['type'],
    value: coupon.value,
    maxDiscountMinor: coupon.maxDiscountMinor,
    minOrderMinor: coupon.minOrderMinor,
    appliesToVehicleType: (coupon.appliesToVehicleType as VehicleType | null) ?? null,
    firstBookingOnly: coupon.firstBookingOnly,
    isActive: coupon.isActive,
    startsAt: coupon.startsAt.toISOString(),
    endsAt: coupon.endsAt ? coupon.endsAt.toISOString() : null,
    usageLimitTotal: coupon.usageLimitTotal,
    usageLimitPerCustomer: coupon.usageLimitPerCustomer,
    usedCount: coupon.usedCount,
  };
}
