/**
 * API resource shapes.
 *
 * These describe exactly what the REST API returns over JSON, so every date is
 * an ISO-8601 string and every money value is an integer in minor units.
 */

import type {
  AddressLabel,
  AdminRole,
  AssignmentStatus,
  AuditAction,
  BookingStatus,
  CouponType,
  DocumentStatus,
  DocumentType,
  LedgerEntryType,
  NotificationChannel,
  NotificationType,
  PartnerStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
  SubscriptionStatus,
  SupportTicketCategory,
  SupportTicketStatus,
  UserRole,
  VehicleSize,
  VehicleType,
} from './enums';

export type IsoDateTime = string;

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Paginated<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface PaginationQuery {
  readonly page?: number;
  readonly pageSize?: number;
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export interface AuthUser {
  readonly id: string;
  readonly role: UserRole;
  readonly phone: string;
  readonly name: string | null;
  readonly email: string | null;
  /** Only present when role is ADMIN. */
  readonly adminRole: AdminRole | null;
  /** Only present when role is PARTNER. */
  readonly partnerStatus: PartnerStatus | null;
  readonly createdAt: IsoDateTime;
}

export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Access token lifetime in seconds. */
  readonly expiresIn: number;
  readonly user: AuthUser;
}

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

export interface CustomerProfile {
  readonly id: string;
  readonly userId: string;
  readonly phone: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly defaultAddressId: string | null;
  readonly walletBalanceMinor: number;
  readonly lifetimeBookings: number;
  readonly lifetimeSpendMinor: number;
  readonly pushOptIn: boolean;
  readonly emailOptIn: boolean;
  readonly smsOptIn: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface Vehicle {
  readonly id: string;
  readonly customerId: string;
  readonly type: VehicleType;
  readonly size: VehicleSize;
  readonly make: string;
  readonly model: string;
  readonly registrationNumber: string | null;
  readonly nickname: string | null;
  readonly color: string | null;
  readonly isDefault: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface Address {
  readonly id: string;
  readonly customerId: string;
  readonly label: AddressLabel;
  readonly nickname: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly landmark: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly isDefault: boolean;
  readonly serviceAreaId: string | null;
  readonly serviceable: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export interface ServiceCategory {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly vehicleType: VehicleType;
  readonly iconKey: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

export interface ServiceAddon {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly durationMinutes: number;
  readonly isActive: boolean;
}

export interface ServiceSizePrice {
  readonly vehicleSize: VehicleSize;
  readonly priceMinor: number;
}

export interface Service {
  readonly id: string;
  readonly categoryId: string;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly slug: string;
  readonly name: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly vehicleType: VehicleType;
  readonly eligibleVehicleSizes: VehicleSize[];
  readonly includedTasks: string[];
  readonly basePriceMinor: number;
  readonly durationMinutes: number;
  readonly sizePrices: ServiceSizePrice[];
  readonly addons: ServiceAddon[];
  readonly taxPercent: number;
  readonly isPopular: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly imageUrl: string | null;
}

export interface ServiceArea {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly state: string;
  readonly postalCodes: string[];
  readonly isActive: boolean;
}

export interface ServiceabilityResult {
  readonly serviceable: boolean;
  readonly area: ServiceArea | null;
  readonly reason: string | null;
  readonly message: string;
}

export interface AvailabilitySlot {
  readonly startTime: IsoDateTime;
  readonly endTime: IsoDateTime;
  /** Remaining capacity for this slot. */
  readonly capacity: number;
  readonly booked: number;
  readonly available: boolean;
}

export interface AvailabilityDay {
  readonly date: string;
  readonly slots: AvailabilitySlot[];
}

/* ------------------------------------------------------------------ */
/* Pricing & bookings                                                  */
/* ------------------------------------------------------------------ */

export interface PriceLine {
  readonly code: string;
  readonly label: string;
  readonly amountMinor: number;
  /** Set on discount lines so the UI can render them as negative. */
  readonly isDiscount: boolean;
}

export interface PriceBreakdown {
  readonly currency: string;
  readonly baseAmountMinor: number;
  readonly sizeAdjustmentMinor: number;
  readonly addonsAmountMinor: number;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly couponCode: string | null;
  readonly taxableAmountMinor: number;
  readonly taxPercent: number;
  readonly taxAmountMinor: number;
  readonly platformFeeMinor: number;
  readonly visitFeeMinor: number;
  readonly totalMinor: number;
  readonly lines: PriceLine[];
}

export interface BookingAddonSelection {
  readonly addonId: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly durationMinutes: number;
}

export interface BookingItem {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly serviceSlug: string;
  readonly vehicleSize: VehicleSize;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly totalMinor: number;
  readonly durationMinutes: number;
  readonly addons: BookingAddonSelection[];
  readonly includedTasks: string[];
}

export interface BookingVehicleSummary {
  readonly id: string;
  readonly type: VehicleType;
  readonly size: VehicleSize;
  readonly make: string;
  readonly model: string;
  readonly registrationNumber: string | null;
  readonly nickname: string | null;
}

export interface BookingAddressSummary {
  readonly id: string;
  readonly label: AddressLabel;
  readonly line1: string;
  readonly line2: string | null;
  readonly landmark: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface BookingStatusEvent {
  readonly id: string;
  readonly status: BookingStatus;
  readonly note: string | null;
  readonly actorRole: UserRole | 'SYSTEM';
  readonly createdAt: IsoDateTime;
}

export interface CompletionPhoto {
  readonly id: string;
  readonly kind: 'BEFORE' | 'AFTER' | 'ISSUE';
  readonly url: string;
  readonly uploadedByRole: UserRole;
  readonly createdAt: IsoDateTime;
}

export interface PaymentSummary {
  readonly id: string;
  readonly method: PaymentMethod;
  readonly provider: PaymentProvider;
  readonly status: PaymentStatus;
  readonly amountMinor: number;
  readonly currency: string;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly paidAt: IsoDateTime | null;
  readonly failureReason: string | null;
  readonly refundedAmountMinor: number;
  readonly isSimulated: boolean;
}

export interface PartnerAssignmentSummary {
  readonly id: string;
  readonly status: AssignmentStatus;
  readonly partnerId: string;
  readonly partnerName: string | null;
  readonly partnerPhone: string | null;
  readonly partnerRating: number | null;
  readonly partnerVehicleLabel: string | null;
  readonly offeredAt: IsoDateTime;
  readonly respondedAt: IsoDateTime | null;
  readonly currentLocation: GeoPoint | null;
  readonly locationUpdatedAt: IsoDateTime | null;
}

export interface BookingSummary {
  readonly id: string;
  readonly reference: string;
  readonly status: BookingStatus;
  readonly paymentStatus: PaymentStatus;
  readonly scheduledStart: IsoDateTime;
  readonly scheduledEnd: IsoDateTime;
  readonly totalMinor: number;
  readonly currency: string;
  readonly serviceNames: string[];
  readonly vehicle: BookingVehicleSummary | null;
  readonly addressLine: string;
  readonly createdAt: IsoDateTime;
  readonly canCancel: boolean;
  readonly canReschedule: boolean;
  readonly canReview: boolean;
  readonly hasPartner: boolean;
}

export interface BookingDetail extends BookingSummary {
  readonly customerId: string;
  readonly address: BookingAddressSummary;
  readonly vehicle: BookingVehicleSummary | null;
  readonly items: BookingItem[];
  readonly priceBreakdown: PriceBreakdown;
  readonly pricingNotes: string[];
  readonly couponCode: string | null;
  readonly notes: string | null;
  readonly partner: PartnerAssignmentSummary | null;
  readonly payment: PaymentSummary | null;
  readonly statusHistory: BookingStatusEvent[];
  readonly photos: CompletionPhoto[];
  readonly subscriptionId: string | null;
  readonly cancellationReason: string | null;
  readonly cancelledAt: IsoDateTime | null;
  readonly rescheduledFrom: IsoDateTime | null;
  readonly completedAt: IsoDateTime | null;
  readonly updatedAt: IsoDateTime;
  readonly invoice: InvoiceSummary | null;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export interface InvoiceSummary {
  readonly id: string;
  readonly number: string;
  readonly bookingId: string;
  readonly issuedAt: IsoDateTime;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly downloadUrl: string;
}

export interface CreatePaymentOrderResult {
  readonly paymentId: string;
  readonly provider: PaymentProvider;
  readonly amountMinor: number;
  readonly currency: string;
  readonly providerOrderId: string | null;
  /**
   * True when the provider is the development mock adapter. The UI must show
   * an explicit "simulated payment" notice and must never claim a real charge.
   */
  readonly isSimulated: boolean;
  readonly checkout: {
    readonly keyId: string | null;
    readonly orderId: string | null;
    readonly name: string;
    readonly description: string;
    readonly prefillPhone: string | null;
    readonly prefillEmail: string | null;
    readonly notes: Record<string, string>;
  };
  /** Only present for the mock provider. */
  readonly mockCheckoutUrl: string | null;
}

/**
 * Confirmation of a gateway payment. A payment is linked to either a booking or a
 * subscription, never both, so exactly one of the two identifiers is sent.
 */
export interface VerifyPaymentRequest {
  readonly bookingId?: string | null;
  readonly subscriptionId?: string | null;
  readonly paymentId: string;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly providerSignature: string | null;
}

export interface VerifyPaymentResult {
  /** Present when the payment paid for a booking. */
  readonly booking: BookingDetail | null;
  /** Present when the payment bought a subscription plan. */
  readonly subscription: CustomerSubscription | null;
  readonly verified: boolean;
  readonly message: string;
}

export interface Refund {
  readonly id: string;
  readonly paymentId: string;
  readonly bookingId: string;
  readonly amountMinor: number;
  readonly status: RefundStatus;
  readonly reason: string;
  readonly providerRefundId: string | null;
  readonly requestedAt: IsoDateTime;
  readonly processedAt: IsoDateTime | null;
  readonly failureReason: string | null;
  readonly requestedByRole: UserRole;
}

/* ------------------------------------------------------------------ */
/* Coupons & subscriptions                                             */
/* ------------------------------------------------------------------ */

export interface Coupon {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly type: CouponType;
  readonly value: number;
  readonly maxDiscountMinor: number | null;
  readonly minOrderMinor: number;
  readonly appliesToVehicleType: VehicleType | null;
  readonly firstBookingOnly: boolean;
  readonly isActive: boolean;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime | null;
  readonly usageLimitTotal: number | null;
  readonly usageLimitPerCustomer: number | null;
  readonly usedCount: number;
}

export interface CouponValidationResult {
  readonly valid: boolean;
  readonly coupon: Coupon | null;
  readonly discountMinor: number;
  readonly message: string;
}

export interface SubscriptionPlan {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly validityDays: number;
  readonly visitAllowance: number;
  readonly vehicleType: VehicleType;
  readonly eligibleServiceSlugs: string[];
  readonly benefits: string[];
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export interface CustomerSubscription {
  readonly id: string;
  readonly planId: string;
  readonly planName: string;
  readonly status: SubscriptionStatus;
  readonly visitsTotal: number;
  readonly visitsUsed: number;
  readonly visitsRemaining: number;
  readonly startsAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly cancelledAt: IsoDateTime | null;
  readonly autoRenew: boolean;
}

/* ------------------------------------------------------------------ */
/* Partner                                                             */
/* ------------------------------------------------------------------ */

export interface PartnerDocument {
  readonly id: string;
  readonly type: DocumentType;
  readonly status: DocumentStatus;
  readonly fileName: string;
  readonly url: string;
  readonly reviewNote: string | null;
  readonly uploadedAt: IsoDateTime;
}

export interface PartnerProfile {
  readonly id: string;
  readonly userId: string;
  readonly phone: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly status: PartnerStatus;
  readonly isOnline: boolean;
  readonly rating: number;
  readonly completedJobs: number;
  readonly cancelledJobs: number;
  readonly skills: string[];
  readonly experienceYears: number;
  readonly vehicleLabel: string | null;
  readonly serviceAreaIds: string[];
  readonly serviceAreaNames: string[];
  readonly documents: PartnerDocument[];
  readonly trainingChecklist: PartnerTrainingItem[];
  readonly rejectionReason: string | null;
  readonly approvedAt: IsoDateTime | null;
  readonly maskedBankAccount: string | null;
  readonly upiId: string | null;
  readonly createdAt: IsoDateTime;
}

export interface PartnerTrainingItem {
  readonly key: string;
  readonly label: string;
  readonly completed: boolean;
  readonly required: boolean;
}

export interface PartnerJobSummary {
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly reference: string;
  readonly status: BookingStatus;
  readonly assignmentStatus: AssignmentStatus;
  readonly scheduledStart: IsoDateTime;
  readonly scheduledEnd: IsoDateTime;
  readonly serviceNames: string[];
  readonly vehicleLabel: string;
  readonly areaName: string;
  readonly approximateAddress: string;
  readonly distanceKm: number | null;
  readonly payoutMinor: number;
  readonly offerExpiresAt: IsoDateTime | null;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
}

export interface PartnerJobDetail extends PartnerJobSummary {
  readonly exactAddress: BookingAddressSummary;
  readonly addressInstructions: string | null;
  readonly items: BookingItem[];
  readonly vehicle: BookingVehicleSummary | null;
  readonly payoutBreakdown: {
    readonly grossMinor: number;
    readonly commissionMinor: number;
    readonly incentiveMinor: number;
    readonly netMinor: number;
    readonly commissionPercent: number;
  };
  readonly statusHistory: BookingStatusEvent[];
  readonly photos: CompletionPhoto[];
  readonly issueReport: { readonly reason: string; readonly reportedAt: IsoDateTime } | null;
}

export interface PartnerEarningsSummary {
  readonly currency: string;
  readonly todayMinor: number;
  readonly weekMinor: number;
  readonly monthMinor: number;
  readonly lifetimeMinor: number;
  readonly pendingSettlementMinor: number;
  readonly paidSettlementMinor: number;
  readonly commissionPercent: number;
  readonly jobsCompletedToday: number;
  readonly jobsCompletedWeek: number;
  readonly incentiveMinor: number;
}

export interface LedgerEntry {
  readonly id: string;
  readonly type: LedgerEntryType;
  readonly amountMinor: number;
  readonly currency: string;
  readonly description: string;
  readonly bookingId: string | null;
  readonly bookingReference: string | null;
  readonly payoutId: string | null;
  readonly balanceAfterMinor: number | null;
  readonly createdAt: IsoDateTime;
}

export interface PartnerPayout {
  readonly id: string;
  readonly status: PayoutStatus;
  readonly amountMinor: number;
  readonly currency: string;
  readonly periodStart: IsoDateTime;
  readonly periodEnd: IsoDateTime;
  readonly reference: string | null;
  readonly paidAt: IsoDateTime | null;
  readonly note: string | null;
  readonly entryCount: number;
}

/* ------------------------------------------------------------------ */
/* Reviews, support, notifications                                     */
/* ------------------------------------------------------------------ */

export interface Review {
  readonly id: string;
  readonly bookingId: string;
  readonly bookingReference: string | null;
  readonly rating: number;
  readonly comment: string | null;
  readonly customerName: string | null;
  readonly partnerName: string | null;
  readonly createdAt: IsoDateTime;
}

export interface SupportTicketMessage {
  readonly id: string;
  readonly authorRole: UserRole;
  readonly authorName: string | null;
  readonly body: string;
  readonly createdAt: IsoDateTime;
}

export interface SupportTicket {
  readonly id: string;
  readonly reference: string;
  readonly category: SupportTicketCategory;
  readonly status: SupportTicketStatus;
  readonly subject: string;
  readonly description: string;
  readonly bookingId: string | null;
  readonly bookingReference: string | null;
  readonly createdByRole: UserRole;
  readonly createdByName: string | null;
  readonly assignedToName: string | null;
  readonly messages: SupportTicketMessage[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface AppNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly channel: NotificationChannel;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, string> | null;
  readonly readAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
}

export interface AuditLogEntry {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly actorRole: UserRole | null;
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId: string | null;
  readonly summary: string;
  readonly metadata: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly createdAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface AdminDashboardMetrics {
  readonly generatedAt: IsoDateTime;
  readonly rangeDays: number;
  readonly bookings: {
    readonly total: number;
    readonly today: number;
    readonly upcoming: number;
    readonly completed: number;
    readonly cancelled: number;
    readonly unassigned: number;
    readonly byStatus: Record<BookingStatus, number>;
  };
  readonly revenue: {
    readonly currency: string;
    readonly collectedMinor: number;
    readonly pendingMinor: number;
    readonly refundedMinor: number;
    readonly averageOrderValueMinor: number;
  };
  readonly partners: {
    readonly total: number;
    readonly approved: number;
    readonly pendingVerification: number;
    readonly online: number;
  };
  readonly customers: {
    readonly total: number;
    readonly newInRange: number;
    readonly repeatRate: number;
  };
  readonly operations: {
    readonly openTickets: number;
    readonly lowRatedBookings: number;
    readonly averageRating: number;
    readonly pendingPayoutMinor: number;
  };
}

export interface AdminCustomerRow {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string;
  readonly email: string | null;
  readonly bookingCount: number;
  readonly lifetimeSpendMinor: number;
  readonly vehicles: number;
  readonly lastBookingAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
}

export interface AdminPartnerRow {
  readonly id: string;
  readonly fullName: string;
  readonly phone: string;
  readonly status: PartnerStatus;
  readonly isOnline: boolean;
  readonly rating: number;
  readonly completedJobs: number;
  readonly areas: string[];
  readonly pendingDocuments: number;
  readonly createdAt: IsoDateTime;
}

export interface AdminBookingRow {
  readonly id: string;
  readonly reference: string;
  readonly customerName: string | null;
  readonly customerPhone: string;
  readonly status: BookingStatus;
  readonly paymentStatus: PaymentStatus;
  readonly scheduledStart: IsoDateTime;
  readonly totalMinor: number;
  readonly currency: string;
  readonly areaName: string | null;
  readonly partnerName: string | null;
  readonly itemCount: number;
}

export interface AdminReport {
  readonly generatedAt: IsoDateTime;
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly currency: string;
  readonly totals: {
    readonly bookings: number;
    readonly completed: number;
    readonly cancelled: number;
    readonly grossRevenueMinor: number;
    readonly taxMinor: number;
    readonly discountsMinor: number;
    readonly refundsMinor: number;
    readonly commissionMinor: number;
    readonly partnerPayoutMinor: number;
  };
  readonly daily: Array<{
    readonly date: string;
    readonly bookings: number;
    readonly completed: number;
    readonly revenueMinor: number;
  }>;
  readonly topServices: Array<{ readonly serviceName: string; readonly bookings: number; readonly revenueMinor: number }>;
  readonly partnerPerformance: Array<{
    readonly partnerId: string;
    readonly partnerName: string;
    readonly jobs: number;
    readonly rating: number;
    readonly earningsMinor: number;
  }>;
}

export interface BusinessSettings {
  readonly currency: string;
  readonly taxPercent: number;
  readonly platformCommissionPercent: number;
  readonly platformFeeMinor: number;
  readonly visitFeeMinor: number;
  readonly cancellationWindowHours: number;
  readonly cancellationFeePercent: number;
  readonly rescheduleWindowHours: number;
  readonly maxReschedulesPerBooking: number;
  readonly assignmentOfferTtlSeconds: number;
  readonly maxConcurrentPartnerJobs: number;
  readonly supportPhone: string;
  readonly supportEmail: string;
}
