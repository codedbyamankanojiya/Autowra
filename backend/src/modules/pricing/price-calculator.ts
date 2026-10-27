import type { BusinessSettings, PriceBreakdown, PriceLine, ServiceAddon, VehicleSize } from '@autowra/shared-types';
import { percentOf } from '@autowra/shared-types';

export interface PriceCalculationInput {
  readonly service: {
    id: string;
    name: string;
    basePriceMinor: number;
    taxPercent: number;
    eligibleVehicleSizes: string[];
  };
  readonly vehicleSize: VehicleSize;
  readonly sizePriceMinor: number;
  readonly addons: readonly Pick<ServiceAddon, 'id' | 'name' | 'priceMinor'>[];
  readonly settings: BusinessSettings;
  readonly discountMinor?: number;
  readonly couponCode?: string | null;
  readonly subscriptionCoverageMinor?: number;
}

/**
 * Pure pricing engine.
 *
 * Every booking total in the system comes from this function, so the client can never
 * influence a price. Order of operations:
 *
 *   1. unit price for the vehicle size (list price + size adjustment)
 *   2. add-ons at their catalogue price
 *   3. subtotal
 *   4. coupon discount, then subscription coverage, capped at the subtotal
 *   5. tax on the discounted amount
 *   6. platform + visit fees
 */
export function calculatePrice(input: PriceCalculationInput): PriceBreakdown {
  const { service, vehicleSize, settings } = input;

  const sizeAdjustmentMinor = input.sizePriceMinor - service.basePriceMinor;
  const addonsAmountMinor = input.addons.reduce((total, addon) => total + addon.priceMinor, 0);
  const subtotalMinor = service.basePriceMinor + sizeAdjustmentMinor + addonsAmountMinor;

  const couponDiscount = Math.max(0, Math.min(input.discountMinor ?? 0, subtotalMinor));
  const subscriptionCoverage = Math.max(0, Math.min(input.subscriptionCoverageMinor ?? 0, subtotalMinor - couponDiscount));
  const discountMinor = couponDiscount + subscriptionCoverage;

  const taxableAmountMinor = Math.max(0, subtotalMinor - discountMinor);
  const taxPercent = service.taxPercent ?? settings.taxPercent;
  const taxAmountMinor = percentOf(taxableAmountMinor, taxPercent);

  // Fees are only charged when the customer is actually paying something for the visit.
  const platformFeeMinor = taxableAmountMinor > 0 ? Math.max(0, settings.platformFeeMinor) : 0;
  const visitFeeMinor = taxableAmountMinor > 0 ? Math.max(0, settings.visitFeeMinor) : 0;

  const totalMinor = taxableAmountMinor + taxAmountMinor + platformFeeMinor + visitFeeMinor;

  const lines: PriceLine[] = [
    { code: 'base', label: service.name, amountMinor: service.basePriceMinor, isDiscount: false },
  ];
  if (sizeAdjustmentMinor !== 0) {
    lines.push({
      code: 'size_adjustment',
      label: `${humanVehicleSize(vehicleSize)} pricing`,
      amountMinor: sizeAdjustmentMinor,
      isDiscount: false,
    });
  }
  for (const addon of input.addons) {
    lines.push({ code: `addon:${addon.id}`, label: addon.name, amountMinor: addon.priceMinor, isDiscount: false });
  }
  if (couponDiscount > 0) {
    lines.push({
      code: 'coupon',
      label: input.couponCode ? `Coupon ${input.couponCode}` : 'Coupon discount',
      amountMinor: couponDiscount,
      isDiscount: true,
    });
  }
  if (subscriptionCoverage > 0) {
    lines.push({ code: 'subscription', label: 'Plan visit applied', amountMinor: subscriptionCoverage, isDiscount: true });
  }
  if (taxAmountMinor > 0) {
    lines.push({ code: 'tax', label: `Taxes (${taxPercent}%)`, amountMinor: taxAmountMinor, isDiscount: false });
  }
  if (platformFeeMinor > 0) {
    lines.push({ code: 'platform_fee', label: 'Platform fee', amountMinor: platformFeeMinor, isDiscount: false });
  }
  if (visitFeeMinor > 0) {
    lines.push({ code: 'visit_fee', label: 'Doorstep visit fee', amountMinor: visitFeeMinor, isDiscount: false });
  }

  return {
    currency: settings.currency,
    baseAmountMinor: service.basePriceMinor,
    sizeAdjustmentMinor,
    addonsAmountMinor,
    subtotalMinor,
    discountMinor,
    couponCode: couponDiscount > 0 ? (input.couponCode ?? null) : null,
    taxableAmountMinor,
    taxPercent,
    taxAmountMinor,
    platformFeeMinor,
    visitFeeMinor,
    totalMinor,
    lines,
  };
}

/**
 * Commission is always a percentage of the booking subtotal (after discounts, before tax),
 * which keeps partner payouts consistent with what the customer actually paid Autowra.
 */
export function calculatePartnerPayout(
  breakdown: Pick<PriceBreakdown, 'taxableAmountMinor'>,
  commissionPercent: number,
): { grossMinor: number; commissionMinor: number; netMinor: number; commissionPercent: number } {
  const grossMinor = Math.max(0, breakdown.taxableAmountMinor);
  const commissionMinor = percentOf(grossMinor, commissionPercent);
  return {
    grossMinor,
    commissionMinor,
    netMinor: Math.max(0, grossMinor - commissionMinor),
    commissionPercent,
  };
}

/** Size tokens that are acronyms and must not be title-cased. */
const SIZE_ACRONYMS = new Set(['SUV', 'MUV']);

export function humanVehicleSize(size: string): string {
  return size
    .split('_')
    .map((part) => (SIZE_ACRONYMS.has(part) ? part : part.charAt(0) + part.slice(1).toLowerCase()))
    .join(' ');
}
