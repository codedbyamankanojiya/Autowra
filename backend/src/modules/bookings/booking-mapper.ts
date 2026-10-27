import type { Prisma } from '@prisma/client';
import {
  BookingStatus,
  type AddressLabel,
  type BookingAddonSelection,
  type BookingAddressSummary,
  type BookingDetail,
  type BookingItem,
  type BookingStatusEvent,
  type BookingSummary,
  type BookingVehicleSummary,
  type CompletionPhoto,
  type InvoiceSummary,
  type IsoDateTime,
  type PartnerAssignmentSummary,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentStatus,
  type PaymentSummary,
  type PriceBreakdown,
  type PriceLine,
  type UserRole,
  type VehicleSize,
  type VehicleType,
} from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import type { Db } from '../../common/types';
import type { BookingRealtimeEvent } from '../realtime/realtime.gateway';

/**
 * Relations required to render a booking row in any list.
 *
 * Only one payment is fetched (the most recent) because `paymentStatus` must reflect the
 * current attempt, not a superseded one.
 */
export const bookingSummaryInclude = {
  items: { select: { serviceName: true }, orderBy: { createdAt: 'asc' } },
  vehicle: true,
  address: true,
  assignments: { select: { status: true } },
  review: { select: { id: true } },
  payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.BookingInclude;

/** Everything a booking detail screen, an invoice or a support ticket needs. */
export const bookingDetailInclude = {
  address: true,
  vehicle: true,
  coupon: { select: { code: true } },
  items: { orderBy: { createdAt: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  photos: {
    orderBy: { createdAt: 'asc' },
    include: { uploadedByUser: { select: { role: true } } },
  },
  assignments: {
    orderBy: { createdAt: 'desc' },
    include: { partner: { include: { user: { select: { phone: true } } } } },
  },
  payments: { orderBy: { createdAt: 'desc' } },
  invoice: true,
  review: { select: { id: true } },
} satisfies Prisma.BookingInclude;

export type BookingSummaryRecord = Prisma.BookingGetPayload<{ include: typeof bookingSummaryInclude }>;
export type BookingDetailRecord = Prisma.BookingGetPayload<{ include: typeof bookingDetailInclude }>;

/**
 * Policy inputs the flags depend on. `SettingsService` is read once per request and passed in
 * so the mapper itself stays pure and testable.
 */
export interface BookingFlagsPolicy {
  readonly maxReschedulesPerBooking: number;
}

/** Statuses a customer may cancel from. Shared with `BookingsService` so the flag and the
 *  enforcement can never drift apart. */
export const CANCELLABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
];

/** Statuses a customer may move to another slot. */
export const RESCHEDULABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
];

export function loadBookingDetail(db: Db, bookingId: string): Promise<BookingDetailRecord | null> {
  return db.booking.findUnique({ where: { id: bookingId }, include: bookingDetailInclude });
}

/** Throws instead of returning null so every caller maps a missing/foreign booking the same way. */
export async function loadBookingDetailOrThrow(db: Db, bookingId: string): Promise<BookingDetailRecord> {
  const booking = await loadBookingDetail(db, bookingId);
  if (!booking) throw AppError.notFound('That booking was not found.');
  return booking;
}

export function toBookingSummary(
  booking: BookingSummaryRecord | BookingDetailRecord,
  policy: BookingFlagsPolicy,
): BookingSummary {
  const now = Date.now();
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status as BookingStatus,
    paymentStatus: resolvePaymentStatus(booking),
    scheduledStart: iso(booking.scheduledStart),
    scheduledEnd: iso(booking.scheduledEnd),
    totalMinor: booking.totalMinor,
    currency: booking.currency,
    serviceNames: booking.items.map((item) => item.serviceName),
    vehicle: booking.vehicle ? toVehicleSummary(booking.vehicle) : null,
    addressLine: addressLine(booking.address),
    createdAt: iso(booking.createdAt),
    canCancel: CANCELLABLE_BOOKING_STATUSES.includes(booking.status as BookingStatus) && booking.scheduledStart.getTime() > now,
    canReschedule:
      RESCHEDULABLE_BOOKING_STATUSES.includes(booking.status as BookingStatus) &&
      booking.rescheduleCount < policy.maxReschedulesPerBooking &&
      booking.scheduledStart.getTime() > now,
    canReview: booking.status === BookingStatus.COMPLETED && booking.review === null,
    hasPartner: booking.assignments.some((assignment) => assignment.status === 'ACCEPTED'),
  };
}

export function toBookingDetail(
  booking: BookingDetailRecord,
  policy: BookingFlagsPolicy,
): BookingDetail {
  const summary = toBookingSummary(booking, policy);
  const partner = toPartnerAssignmentSummary(booking);

  return {
    ...summary,
    customerId: booking.customerId,
    address: toAddressSummary(booking.address),
    items: booking.items.map(toBookingItem),
    priceBreakdown: toPriceBreakdown(booking),
    pricingNotes: buildPricingNotes(booking),
    couponCode: booking.coupon?.code ?? null,
    notes: booking.notes,
    partner,
    payment: booking.payments[0] ? toPaymentSummary(booking.payments[0]) : null,
    statusHistory: booking.statusHistory.map(toStatusEvent),
    photos: booking.photos.map(toCompletionPhoto),
    subscriptionId: booking.subscriptionId,
    cancellationReason: booking.cancellationReason,
    cancelledAt: booking.cancelledAt ? iso(booking.cancelledAt) : null,
    rescheduledFrom: booking.rescheduledFrom ? iso(booking.rescheduledFrom) : null,
    completedAt: booking.completedAt ? iso(booking.completedAt) : null,
    updatedAt: iso(booking.updatedAt),
    invoice: booking.invoice ? toInvoiceSummary(booking.invoice) : null,
  };
}

/**
 * The payload pushed over the socket. Every surface (customer, partner, admin) receives
 * the same minimal shape and refetches the detail it is allowed to see.
 */
export function toRealtimeEvent(booking: BookingSummaryRecord | BookingDetailRecord): BookingRealtimeEvent {
  const accepted = booking.assignments.find((assignment) => assignment.status === 'ACCEPTED');
  return {
    bookingId: booking.id,
    reference: booking.reference,
    status: booking.status as BookingStatus,
    paymentStatus: resolvePaymentStatus(booking),
    // Only the detail include loads `partner`; the summary include does not, so the `in`
    // guard narrows to a synthesized member and the shape is asserted here.
    partnerName: accepted && 'partner' in accepted ? (accepted.partner as { fullName: string }).fullName : null,
    updatedAt: iso(booking.updatedAt),
  };
}

/* ------------------------------------------------------------------ */
/* Field mappers                                                       */
/* ------------------------------------------------------------------ */

function iso(value: Date): IsoDateTime {
  return value.toISOString();
}

function resolvePaymentStatus(
  booking: Pick<BookingSummaryRecord, 'status' | 'payments'>,
): PaymentStatus {
  const latest = booking.payments[0];
  if (latest) return latest.status as PaymentStatus;
  // No payment attempt yet: a cancelled booking never needs one.
  return booking.status === BookingStatus.CANCELLED ? 'CANCELLED' : 'PENDING';
}

function addressLine(address: {
  line1: string;
  landmark: string | null;
  city: string;
  postalCode: string;
}): string {
  return [address.line1, address.landmark, `${address.city} ${address.postalCode}`]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

function toVehicleSummary(vehicle: {
  id: string;
  type: string;
  size: string;
  make: string;
  model: string;
  registrationNumber: string | null;
  nickname: string | null;
}): BookingVehicleSummary {
  return {
    id: vehicle.id,
    type: vehicle.type as VehicleType,
    size: vehicle.size as VehicleSize,
    make: vehicle.make,
    model: vehicle.model,
    registrationNumber: vehicle.registrationNumber,
    nickname: vehicle.nickname,
  };
}

function toAddressSummary(address: {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}): BookingAddressSummary {
  return {
    id: address.id,
    label: address.label as AddressLabel,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    latitude: address.latitude,
    longitude: address.longitude,
  };
}

function toBookingItem(item: BookingDetailRecord['items'][number]): BookingItem {
  return {
    id: item.id,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    serviceSlug: item.serviceSlug,
    vehicleSize: item.vehicleSize as VehicleSize,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    totalMinor: item.totalMinor,
    durationMinutes: item.durationMinutes,
    addons: (item.addons as unknown as BookingAddonSelection[]) ?? [],
    includedTasks: item.includedTasks,
  };
}

function toStatusEvent(entry: BookingDetailRecord['statusHistory'][number]): BookingStatusEvent {
  return {
    id: entry.id,
    status: entry.status as BookingStatus,
    note: entry.note,
    actorRole: entry.actorRole as UserRole | 'SYSTEM',
    createdAt: iso(entry.createdAt),
  };
}

function toCompletionPhoto(photo: BookingDetailRecord['photos'][number]): CompletionPhoto {
  return {
    id: photo.id,
    kind: photo.kind,
    url: photo.url,
    // The uploader's role is recorded through their user, which is the only trustworthy source.
    uploadedByRole: (photo.uploadedByUser?.role as UserRole) ?? 'PARTNER',
    createdAt: iso(photo.createdAt),
  };
}

function toPaymentSummary(payment: BookingDetailRecord['payments'][number]): PaymentSummary {
  return {
    id: payment.id,
    method: payment.method as PaymentMethod,
    provider: payment.provider as PaymentProvider,
    status: payment.status as PaymentStatus,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    paidAt: payment.paidAt ? iso(payment.paidAt) : null,
    failureReason: payment.failureReason,
    refundedAmountMinor: payment.refundedAmountMinor,
    isSimulated: payment.isSimulated,
  };
}

/**
 * The most advanced assignment wins: an accepted partner is who the customer is told about,
 * and a still-open offer is shown while the customer waits.
 */
function toPartnerAssignmentSummary(booking: BookingDetailRecord): PartnerAssignmentSummary | null {
  if (booking.assignments.length === 0) return null;
  const accepted = booking.assignments.find((assignment) => assignment.status === 'ACCEPTED');
  const offered = booking.assignments.find((assignment) => assignment.status === 'OFFERED');
  const chosen = accepted ?? offered ?? booking.assignments[0];
  if (!chosen) return null;

  const partner = chosen.partner;
  return {
    id: chosen.id,
    status: chosen.status,
    partnerId: chosen.partnerId,
    partnerName: partner.fullName,
    partnerPhone: partner.user.phone,
    partnerRating: partner.ratingCount > 0 ? partner.rating : null,
    partnerVehicleLabel: partner.vehicleLabel,
    offeredAt: iso(chosen.offeredAt),
    respondedAt: chosen.respondedAt ? iso(chosen.respondedAt) : null,
    currentLocation:
      partner.lastLatitude !== null && partner.lastLongitude !== null
        ? { latitude: partner.lastLatitude, longitude: partner.lastLongitude }
        : null,
    locationUpdatedAt: partner.lastLocationAt ? iso(partner.lastLocationAt) : null,
  };
}

function toInvoiceSummary(invoice: NonNullable<BookingDetailRecord['invoice']>): InvoiceSummary {
  return {
    id: invoice.id,
    number: invoice.number,
    bookingId: invoice.bookingId,
    issuedAt: iso(invoice.issuedAt),
    subtotalMinor: invoice.subtotalMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    currency: invoice.currency,
    downloadUrl: `/api/v1/bookings/${invoice.bookingId}/invoice`,
  };
}

/**
 * Rebuilds the price lines from the persisted money columns.
 *
 * The booking row is the source of truth for every amount, so a historic invoice keeps
 * showing the price the customer actually approved even after catalogue prices change.
 */
export function toPriceBreakdown(booking: BookingDetailRecord): PriceBreakdown {
  const lines: PriceLine[] = [
    {
      code: 'base',
      label: booking.items[0]?.serviceName ?? 'Service',
      amountMinor: booking.baseAmountMinor,
      isDiscount: false,
    },
  ];

  if (booking.sizeAdjustmentMinor !== 0) {
    lines.push({
      code: 'size_adjustment',
      label: 'Vehicle size pricing',
      amountMinor: booking.sizeAdjustmentMinor,
      isDiscount: false,
    });
  }

  for (const item of booking.items) {
    const addons = (item.addons as unknown as BookingAddonSelection[]) ?? [];
    for (const addon of addons) {
      lines.push({ code: `addon:${addon.addonId}`, label: addon.name, amountMinor: addon.priceMinor, isDiscount: false });
    }
  }

  const couponDiscount = booking.couponDiscountMinor;
  const subscriptionCoverage = booking.subscriptionCoverageMinor;
  if (couponDiscount > 0) {
    lines.push({
      code: 'coupon',
      label: booking.coupon?.code ? `Coupon ${booking.coupon.code}` : 'Coupon discount',
      amountMinor: couponDiscount,
      isDiscount: true,
    });
  }
  if (subscriptionCoverage > 0) {
    lines.push({ code: 'subscription', label: 'Plan visit applied', amountMinor: subscriptionCoverage, isDiscount: true });
  }
  if (booking.taxAmountMinor > 0) {
    lines.push({ code: 'tax', label: `Taxes (${booking.taxPercent}%)`, amountMinor: booking.taxAmountMinor, isDiscount: false });
  }
  if (booking.platformFeeMinor > 0) {
    lines.push({ code: 'platform_fee', label: 'Platform fee', amountMinor: booking.platformFeeMinor, isDiscount: false });
  }
  if (booking.visitFeeMinor > 0) {
    lines.push({ code: 'visit_fee', label: 'Doorstep visit fee', amountMinor: booking.visitFeeMinor, isDiscount: false });
  }

  return {
    currency: booking.currency,
    baseAmountMinor: booking.baseAmountMinor,
    sizeAdjustmentMinor: booking.sizeAdjustmentMinor,
    addonsAmountMinor: booking.addonsAmountMinor,
    subtotalMinor: booking.subtotalMinor,
    discountMinor: booking.discountMinor,
    couponCode: couponDiscount > 0 ? (booking.coupon?.code ?? null) : null,
    taxableAmountMinor: booking.taxableAmountMinor,
    taxPercent: booking.taxPercent,
    taxAmountMinor: booking.taxAmountMinor,
    platformFeeMinor: booking.platformFeeMinor,
    visitFeeMinor: booking.visitFeeMinor,
    totalMinor: booking.totalMinor,
    lines,
  };
}

function buildPricingNotes(booking: BookingDetailRecord): string[] {
  const notes: string[] = [];
  if (booking.discountMinor > 0 && booking.coupon?.code) {
    notes.push(`Coupon ${booking.coupon.code} applied.`);
  }
  if (booking.subscriptionId) {
    notes.push('A plan visit was used for this booking.');
  }
  return notes;
}
