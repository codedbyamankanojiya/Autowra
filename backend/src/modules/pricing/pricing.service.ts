import { Injectable } from '@nestjs/common';
import type { CouponValidationResult, PriceQuoteResponse, VehicleSize, VehicleType } from '@autowra/shared-types';
import { SubscriptionStatus } from '@autowra/shared-types';
import type { PriceQuoteInput, ValidateCouponInput } from '@autowra/validation';
import { AppError } from '../../common/app-error';
import type { Db } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { CouponsService } from '../coupons/coupons.service';
import { AddressesService, VehiclesService } from '../customers/customer-assets.service';
import { SettingsService } from '../settings/settings.service';
import { calculatePrice, humanVehicleSize } from './price-calculator';

type ServiceRecord = Awaited<ReturnType<CatalogService['getServiceOrThrow']>>;

const SUBSCRIPTION_COVERED_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE];

/**
 * Everything the booking transaction needs from a price decision, including the coupon and
 * subscription identifiers it must persist alongside the money columns.
 */
export interface BookingPriceComputation {
  readonly quote: PriceQuoteResponse;
  readonly serviceId: string;
  readonly serviceSlug: string;
  readonly serviceName: string;
  readonly includedTasks: string[];
  readonly vehicleType: VehicleType;
  readonly vehicleSize: VehicleSize;
  readonly unitPriceMinor: number;
  readonly durationMinutes: number;
  readonly couponId: string | null;
  readonly couponCode: string | null;
  readonly couponDiscountMinor: number;
  readonly subscriptionId: string | null;
  readonly subscriptionCoverageMinor: number;
}

export interface ComputeBookingPriceOptions {
  /**
   * When true a supplied coupon code that cannot be applied rejects the request instead of
   * being silently dropped. Booking creation uses this so a customer never pays more than
   * the quote they approved; the preview endpoint stays lenient and explains the problem.
   */
  readonly strictCoupon?: boolean;
}

/**
 * Server-side pricing.
 *
 * The customer app renders whatever this service returns and never computes a
 * total itself. Everything that can change a price - vehicle size, add-on
 * eligibility, coupon rules, plan coverage, tax and fees - is resolved here
 * against the database before any booking is created.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly vehicles: VehiclesService,
    private readonly addresses: AddressesService,
    private readonly coupons: CouponsService,
    private readonly settings: SettingsService,
  ) {}

  async quote(customerId: string, input: PriceQuoteInput): Promise<PriceQuoteResponse> {
    return (await this.computeBookingPrice(customerId, input)).quote;
  }

  /**
   * The single price decision used by both the quote preview and booking creation.
   *
   * `db` lets the booking transaction resolve the service, vehicle, address, coupon and plan
   * coverage against the same snapshot that will persist the booking, so a price can never
   * be computed from data that changed between the quote and the write.
   */
  async computeBookingPrice(
    customerId: string,
    input: PriceQuoteInput,
    db: Db = this.prisma,
    options: ComputeBookingPriceOptions = {},
  ): Promise<BookingPriceComputation> {
    const [service, vehicle, settings] = await Promise.all([
      this.catalog.getServiceOrThrow(input.serviceId, db),
      this.vehicles.getOrThrow(customerId, input.vehicleId, db),
      this.settings.get(),
    ]);

    const notes: string[] = [];
    const vehicleType = vehicle.type as VehicleType;
    const vehicleSize = vehicle.size as VehicleSize;

    this.assertEligible(service, vehicleType, vehicleSize);

    const addons = this.catalog.resolveAddons(service, input.addonIds ?? []);
    const sizePriceMinor = this.catalog.priceForSize(service, vehicleSize);
    const subtotalMinor = sizePriceMinor + addons.reduce((total, addon) => total + addon.priceMinor, 0);

    let couponId: string | null = null;
    let couponCode: string | null = null;
    let discountMinor = 0;
    if (input.couponCode) {
      const evaluation = await this.evaluateCoupon(customerId, input.couponCode, vehicleType, subtotalMinor, db);
      notes.push(evaluation.message);
      if (evaluation.valid) {
        discountMinor = evaluation.discountMinor;
        couponId = evaluation.coupon?.id ?? null;
        couponCode = evaluation.coupon?.code ?? input.couponCode;
      } else if (options.strictCoupon) {
        throw AppError.badRequest('COUPON_INVALID', evaluation.message);
      }
    }

    let subscriptionId: string | null = null;
    let subscriptionCoverageMinor = 0;
    if (input.subscriptionId) {
      const coverage = await this.resolveSubscriptionCoverage(
        {
          customerId,
          subscriptionId: input.subscriptionId,
          vehicleId: vehicle.id,
          vehicleType,
          service,
          coveredMinor: Math.max(0, subtotalMinor - discountMinor),
        },
        db,
      );
      subscriptionCoverageMinor = coverage.coverageMinor;
      if (coverage.note) notes.push(coverage.note);
      // A plan that cannot contribute is not attached, so the booking never claims a visit.
      if (subscriptionCoverageMinor > 0) subscriptionId = input.subscriptionId;
    }

    if (input.addressId) {
      const address = await this.addresses.getOrThrow(customerId, input.addressId, db);
      if (!address.serviceAreaId) {
        notes.push('We may not serve this address yet - please confirm the pinned location before booking.');
      }
    }

    const breakdown = calculatePrice({
      service: {
        id: service.id,
        name: service.name,
        basePriceMinor: service.basePriceMinor,
        taxPercent: service.taxPercent,
        eligibleVehicleSizes: service.eligibleVehicleSizes,
      },
      vehicleSize,
      sizePriceMinor,
      addons: addons.map((addon) => ({ id: addon.id, name: addon.name, priceMinor: addon.priceMinor })),
      settings,
      discountMinor,
      couponCode,
      subscriptionCoverageMinor,
    });

    return {
      quote: { breakdown, notes, addons },
      serviceId: service.id,
      serviceSlug: service.slug,
      serviceName: service.name,
      includedTasks: service.includedTasks,
      vehicleType,
      vehicleSize,
      unitPriceMinor: sizePriceMinor,
      durationMinutes: service.durationMinutes + addons.reduce((total, addon) => total + addon.durationMinutes, 0),
      couponId,
      couponCode,
      couponDiscountMinor: discountMinor,
      subscriptionId,
      subscriptionCoverageMinor,
    };
  }

  /** Shared by the quote endpoint and the standalone coupon check. */
  async validateCoupon(customerId: string, input: ValidateCouponInput): Promise<CouponValidationResult> {
    const [service, vehicle] = await Promise.all([
      this.catalog.getServiceOrThrow(input.serviceId),
      this.vehicles.getOrThrow(customerId, input.vehicleId),
    ]);

    const vehicleType = vehicle.type as VehicleType;
    const vehicleSize = vehicle.size as VehicleSize;
    this.assertEligible(service, vehicleType, vehicleSize);

    const addons = this.catalog.resolveAddons(service, input.addonIds ?? []);
    const subtotalMinor =
      this.catalog.priceForSize(service, vehicleSize) + addons.reduce((total, addon) => total + addon.priceMinor, 0);

    try {
      return await this.evaluateCoupon(customerId, input.code, vehicleType, subtotalMinor);
    } catch (error) {
      if (error instanceof AppError) {
        return { valid: false, coupon: null, discountMinor: 0, message: error.message };
      }
      throw error;
    }
  }

  /**
   * A customer is "new" until their first booking is created, so cancelled
   * attempts do not silently consume first-booking coupons.
   */
  private async evaluateCoupon(
    customerId: string,
    code: string,
    vehicleType: VehicleType,
    subtotalMinor: number,
    db: Db = this.prisma,
  ): Promise<CouponValidationResult> {
    const isFirstBooking =
      (await db.booking.count({ where: { customerId, status: { not: 'CANCELLED' } } })) === 0;
    return this.coupons.evaluate({ code, customerId, vehicleType, subtotalMinor, isFirstBooking }, db);
  }

  private assertEligible(service: ServiceRecord, vehicleType: VehicleType, vehicleSize: VehicleSize): void {
    if (service.vehicleType !== vehicleType) {
      throw AppError.badRequest(
        'SERVICE_NOT_ELIGIBLE',
        `"${service.name}" is a ${vehicleType.toLowerCase()} service. Pick a vehicle that matches.`,
      );
    }
    if (service.eligibleVehicleSizes.length > 0 && !service.eligibleVehicleSizes.includes(vehicleSize)) {
      throw AppError.badRequest(
        'SERVICE_NOT_ELIGIBLE',
        `"${service.name}" is not offered for ${humanVehicleSize(vehicleSize)} ${vehicleType.toLowerCase()}s.`,
      );
    }
  }

  /**
   * Plan visits cover the base service for an eligible vehicle, never add-ons.
   * Anything that fails a rule degrades to a note instead of an error so the
   * customer can still see a valid, fully priced quote.
   */
  private async resolveSubscriptionCoverage(
    input: {
      customerId: string;
      subscriptionId: string;
      vehicleId: string;
      vehicleType: VehicleType;
      service: ServiceRecord;
      coveredMinor: number;
    },
    db: Db = this.prisma,
  ): Promise<{ coverageMinor: number; note: string | null }> {
    const subscription = await db.customerSubscription.findFirst({
      where: { id: input.subscriptionId, customerId: input.customerId },
      include: { plan: true },
    });
    if (!subscription) throw AppError.notFound('That subscription was not found on your account.');

    if (!SUBSCRIPTION_COVERED_STATUSES.includes(subscription.status as SubscriptionStatus)) {
      return { coverageMinor: 0, note: 'Your plan is not active yet, so it cannot be applied to this booking.' };
    }
    if (subscription.expiresAt.getTime() < Date.now()) {
      return { coverageMinor: 0, note: 'Your plan has expired. Renew it to keep saving on visits.' };
    }
    if (subscription.visitsUsed >= subscription.visitsTotal) {
      return { coverageMinor: 0, note: 'You have used every visit in this plan.' };
    }
    if (subscription.vehicleId !== input.vehicleId) {
      return { coverageMinor: 0, note: 'This plan is linked to a different vehicle in your garage.' };
    }
    if (subscription.plan.vehicleType !== input.vehicleType) {
      return { coverageMinor: 0, note: `This plan only covers ${subscription.plan.vehicleType.toLowerCase()} services.` };
    }
    if (
      subscription.plan.eligibleServiceSlugs.length > 0 &&
      !subscription.plan.eligibleServiceSlugs.includes(input.service.slug)
    ) {
      return { coverageMinor: 0, note: 'The selected service is not covered by your plan.' };
    }

    const coverageMinor = Math.max(0, Math.min(input.service.basePriceMinor, input.coveredMinor));
    if (coverageMinor <= 0) {
      return { coverageMinor: 0, note: 'Your plan has nothing left to cover on this booking.' };
    }
    return {
      coverageMinor,
      note: `Plan visit applied - ${subscription.visitsTotal - subscription.visitsUsed} visit(s) remaining after this booking.`,
    };
  }
}
