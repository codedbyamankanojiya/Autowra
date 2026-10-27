/**
 * REST contract.
 *
 * Every request/response body the API accepts or returns is declared here so
 * the mobile apps, dashboard and backend compile against one description.
 * Routes are versioned under `/api/v1`.
 */

import type { AdminRole, BookingStatus, CouponType, DocumentType, NotificationType, PaymentMethod, RefundStatus, ServiceAreaStatus, SupportTicketCategory, SupportTicketStatus, UserRole, VehicleSize, VehicleType } from './enums';
import type {
  Address,
  AdminBookingRow,
  AdminCustomerRow,
  AdminDashboardMetrics,
  AdminPartnerRow,
  AdminReport,
  AppNotification,
  AuditLogEntry,
  AuthSession,
  AuthUser,
  AvailabilityDay,
  BookingDetail,
  BookingSummary,
  BusinessSettings,
  Coupon,
  CouponValidationResult,
  CreatePaymentOrderResult,
  CustomerProfile,
  CustomerSubscription,
  GeoPoint,
  IsoDateTime,
  LedgerEntry,
  Paginated,
  PartnerEarningsSummary,
  PartnerJobDetail,
  PartnerJobSummary,
  PartnerPayout,
  PartnerProfile,
  PartnerTrainingItem,
  PriceBreakdown,
  Refund,
  Review,
  Service,
  ServiceArea,
  ServiceCategory,
  ServiceabilityResult,
  SubscriptionPlan,
  SupportTicket,
  Vehicle,
  VerifyPaymentRequest,
  VerifyPaymentResult,
} from './models';

export const API_VERSION = 'v1';
export const API_PREFIX = '/api/v1';

/** Machine readable error codes returned by the API. */
export const ApiErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_TOO_MANY_ATTEMPTS: 'OTP_TOO_MANY_ATTEMPTS',
  ACCOUNT_NOT_APPROVED: 'ACCOUNT_NOT_APPROVED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  ADDRESS_NOT_SERVICEABLE: 'ADDRESS_NOT_SERVICEABLE',
  SERVICE_NOT_ELIGIBLE: 'SERVICE_NOT_ELIGIBLE',
  COUPON_INVALID: 'COUPON_INVALID',
  SUBSCRIPTION_NOT_ELIGIBLE: 'SUBSCRIPTION_NOT_ELIGIBLE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  PAYMENT_NOT_CONFIGURED: 'PAYMENT_NOT_CONFIGURED',
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface ApiErrorBody {
  readonly statusCode: number;
  readonly code: ApiErrorCode | string;
  readonly message: string;
  readonly details?: Array<{ path: string; message: string }>;
  readonly requestId?: string;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export interface RequestOtpRequest {
  readonly phone: string;
  readonly role?: Extract<UserRole, 'CUSTOMER' | 'PARTNER' | 'ADMIN'>;
}

export interface RequestOtpResponse {
  readonly requestId: string;
  readonly phone: string;
  readonly expiresInSeconds: number;
  readonly deliveryChannel: 'sms' | 'console' | 'disabled';
  /**
   * Only populated in non-production when development authentication is
   * enabled. The UI must display it as a development-only value.
   */
  readonly devCode: string | null;
  readonly message: string;
}

export interface VerifyOtpRequest {
  readonly phone: string;
  readonly code: string;
  readonly role?: Extract<UserRole, 'CUSTOMER' | 'PARTNER' | 'ADMIN'>;
  readonly deviceId?: string;
  readonly pushToken?: string;
  readonly platform?: 'ios' | 'android' | 'web';
}

export type VerifyOtpResponse = AuthSession;

export interface RefreshSessionRequest {
  readonly refreshToken: string;
}

export type RefreshSessionResponse = AuthSession;

export interface RegisterPushTokenRequest {
  readonly token: string;
  readonly platform: 'ios' | 'android' | 'web';
  readonly deviceId?: string;
}

export interface UpdateProfileRequest {
  readonly name?: string;
  readonly email?: string | null;
  readonly pushOptIn?: boolean;
  readonly emailOptIn?: boolean;
  readonly smsOptIn?: boolean;
}

export interface DeleteAccountRequest {
  readonly reason?: string;
  readonly confirm: true;
}

/* ------------------------------------------------------------------ */
/* Vehicles & addresses                                                */
/* ------------------------------------------------------------------ */

export interface CreateVehicleRequest {
  readonly type: VehicleType;
  readonly size: VehicleSize;
  readonly make: string;
  readonly model: string;
  readonly registrationNumber?: string | null;
  readonly nickname?: string | null;
  readonly color?: string | null;
  readonly isDefault?: boolean;
}

export type UpdateVehicleRequest = Partial<CreateVehicleRequest>;

export interface CreateAddressRequest {
  readonly label: 'HOME' | 'WORK' | 'OTHER';
  readonly nickname?: string | null;
  readonly line1: string;
  readonly line2?: string | null;
  readonly landmark?: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly isDefault?: boolean;
}

export type UpdateAddressRequest = Partial<CreateAddressRequest>;

export interface ServiceabilityCheckQuery {
  readonly postalCode?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export interface ListServicesQuery {
  readonly vehicleType?: VehicleType;
  readonly categorySlug?: string;
  readonly popularOnly?: boolean;
}

export interface ServiceCatalogResponse {
  readonly categories: ServiceCategory[];
  readonly services: Service[];
  readonly addons: Service['addons'];
  readonly source: 'database';
}

export interface AvailabilityQuery {
  readonly serviceId: string;
  readonly date: string;
  readonly addressId?: string;
  readonly postalCode?: string;
}

export interface AvailabilityResponse {
  readonly date: string;
  readonly slotMinutes: number;
  readonly days: AvailabilityDay[];
  readonly timezone: string;
  readonly message: string | null;
}

/* ------------------------------------------------------------------ */
/* Pricing & bookings                                                  */
/* ------------------------------------------------------------------ */

export interface PriceQuoteRequest {
  readonly serviceId: string;
  readonly vehicleId: string;
  readonly addonIds?: string[];
  readonly addressId?: string;
  readonly couponCode?: string;
  readonly subscriptionId?: string;
}

export interface PriceQuoteResponse {
  readonly breakdown: PriceBreakdown;
  readonly notes: string[];
  readonly addons: Service['addons'];
}

export interface CreateBookingRequest {
  readonly serviceId: string;
  readonly vehicleId: string;
  readonly addressId: string;
  readonly addonIds?: string[];
  readonly scheduledStart: IsoDateTime;
  readonly couponCode?: string;
  readonly subscriptionId?: string;
  readonly paymentMethod: PaymentMethod;
  readonly notes?: string;
  /** Client generated UUID - the server rejects a second create with the same key. */
  readonly idempotencyKey: string;
}

export interface CreateBookingResponse {
  readonly booking: BookingDetail;
  readonly payment: CreatePaymentOrderResult | null;
}

export interface CancelBookingRequest {
  readonly reason: string;
  readonly idempotencyKey?: string;
}

export interface CancelBookingResponse {
  readonly booking: BookingDetail;
  readonly refund: Refund | null;
  readonly cancellationFeeMinor: number;
  readonly message: string;
}

export interface RescheduleBookingRequest {
  readonly scheduledStart: IsoDateTime;
  readonly reason?: string;
}

export interface ListBookingsQuery {
  readonly status?: BookingStatus;
  readonly page?: number;
  readonly pageSize?: number;
  readonly upcomingOnly?: boolean;
}

export interface BookingStatusResponse {
  readonly bookingId: string;
  readonly reference: string;
  readonly status: BookingStatus;
  readonly partner: BookingDetail['partner'];
  readonly updatedAt: IsoDateTime;
  readonly nextExpectedStatuses: BookingStatus[];
}

/* ------------------------------------------------------------------ */
/* Reviews & support                                                   */
/* ------------------------------------------------------------------ */

export interface CreateReviewRequest {
  readonly bookingId: string;
  readonly rating: number;
  readonly comment?: string | null;
}

export interface CreateSupportTicketRequest {
  readonly category: SupportTicketCategory;
  readonly subject: string;
  readonly description: string;
  readonly bookingId?: string | null;
}

export interface AddTicketMessageRequest {
  readonly body: string;
}

export interface UpdateTicketStatusRequest {
  readonly status: SupportTicketStatus;
  readonly note?: string;
}

/* ------------------------------------------------------------------ */
/* Coupons & subscriptions                                             */
/* ------------------------------------------------------------------ */

export interface ValidateCouponRequest {
  readonly code: string;
  readonly serviceId: string;
  readonly vehicleId: string;
  readonly addonIds?: string[];
}

export interface SubscribeRequest {
  readonly planId: string;
  readonly vehicleId: string;
  readonly paymentMethod: PaymentMethod;
  readonly idempotencyKey: string;
}

/* ------------------------------------------------------------------ */
/* Partner                                                             */
/* ------------------------------------------------------------------ */

export interface PartnerRegisterRequest {
  readonly fullName: string;
  readonly email?: string | null;
  readonly experienceYears: number;
  readonly skills: string[];
  readonly vehicleLabel?: string | null;
  readonly serviceAreaIds: string[];
  readonly upiId?: string | null;
  readonly bankAccountNumber?: string | null;
  readonly bankIfsc?: string | null;
}

export interface PartnerProfileUpdateRequest {
  readonly fullName?: string;
  readonly email?: string | null;
  readonly experienceYears?: number;
  readonly skills?: string[];
  readonly vehicleLabel?: string | null;
  readonly serviceAreaIds?: string[];
  readonly upiId?: string | null;
  readonly trainingChecklist?: Array<{ key: string; completed: boolean }>;
}

export interface PartnerDocumentUploadRequest {
  readonly type: DocumentType;
  readonly fileName: string;
  /** Base64 payload (data URL stripped) - validated and size limited server side. */
  readonly contentBase64: string;
  readonly contentType: string;
}

export interface PartnerDutyStatusRequest {
  readonly isOnline: boolean;
  readonly location?: GeoPoint;
}

export interface ListPartnerJobsQuery {
  readonly scope: 'offers' | 'today' | 'upcoming' | 'completed' | 'all';
  readonly page?: number;
  readonly pageSize?: number;
}

export interface PartnerJobsResponse {
  readonly jobs: PartnerJobSummary[];
  readonly counts: {
    readonly offers: number;
    readonly today: number;
    readonly upcoming: number;
    readonly completed: number;
  };
  readonly pagination: Pick<Paginated<never>, 'page' | 'pageSize' | 'total' | 'totalPages'>;
}

export interface PartnerJobActionRequest {
  readonly note?: string;
}

export interface PartnerJobStatusRequest {
  readonly status: Extract<
    BookingStatus,
    'TRAVELLING' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED'
  >;
  readonly note?: string;
  readonly location?: GeoPoint;
}

export interface PartnerLocationRequest {
  readonly latitude: number;
  readonly longitude: number;
}

export interface PartnerPhotoUploadRequest {
  readonly kind: 'BEFORE' | 'AFTER' | 'ISSUE';
  readonly contentBase64: string;
  readonly contentType: string;
  readonly fileName?: string;
}

export interface PartnerIssueRequest {
  readonly reason: string;
  readonly note?: string;
}

export interface PartnerEarningsResponse {
  readonly summary: PartnerEarningsSummary;
  readonly entries: LedgerEntry[];
  readonly pagination: Pick<Paginated<never>, 'page' | 'pageSize' | 'total' | 'totalPages'>;
}

export interface PartnerPayoutsResponse {
  readonly payouts: PartnerPayout[];
  readonly pagination: Pick<Paginated<never>, 'page' | 'pageSize' | 'total' | 'totalPages'>;
}

export interface PartnerTrainingUpdateRequest {
  readonly items: PartnerTrainingItem[];
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface AdminLoginRequest {
  readonly email: string;
  readonly password: string;
}

export interface AdminDashboardQuery {
  readonly rangeDays?: number;
}

export interface AdminListQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string;
  readonly sort?: string;
  readonly order?: 'asc' | 'desc';
}

export interface AdminListBookingsQuery extends AdminListQuery {
  readonly status?: BookingStatus;
  readonly paymentStatus?: string;
  readonly areaId?: string;
  readonly partnerId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly unassignedOnly?: boolean;
}

export interface AdminAssignBookingRequest {
  readonly partnerId?: string;
  readonly note?: string;
  /** When true the server picks the best eligible partner. */
  readonly autoAssign?: boolean;
}

export interface AdminCancelBookingRequest {
  readonly reason: string;
  readonly refundAmountMinor?: number;
  readonly cancelFeeMinor?: number;
}

export interface AdminApprovePartnerRequest {
  readonly decision: 'APPROVE' | 'REJECT';
  readonly note?: string;
  readonly rejectedDocumentIds?: string[];
}

export interface AdminReviewDocumentRequest {
  readonly decision: 'APPROVE' | 'REJECT';
  readonly note?: string;
}

export interface UpsertServiceRequest {
  readonly categoryId: string;
  readonly slug: string;
  readonly name: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly vehicleType: VehicleType;
  readonly eligibleVehicleSizes: VehicleSize[];
  readonly includedTasks: string[];
  readonly basePriceMinor: number;
  readonly durationMinutes: number;
  readonly taxPercent: number;
  readonly sizePrices: Array<{ vehicleSize: VehicleSize; priceMinor: number }>;
  readonly addonIds: string[];
  readonly isPopular: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly imageUrl?: string | null;
}

export interface UpsertAddonRequest {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly durationMinutes: number;
  readonly isActive: boolean;
}

export interface UpsertServiceAreaRequest {
  readonly name: string;
  readonly city: string;
  readonly state: string;
  readonly postalCodes: string[];
  readonly status: ServiceAreaStatus;
  readonly boundary?: GeoPoint[] | null;
}

export interface UpsertCouponRequest {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly type: CouponType;
  readonly value: number;
  readonly maxDiscountMinor?: number | null;
  readonly minOrderMinor: number;
  readonly appliesToVehicleType?: VehicleType | null;
  readonly firstBookingOnly: boolean;
  readonly isActive: boolean;
  readonly startsAt: IsoDateTime;
  readonly endsAt?: IsoDateTime | null;
  readonly usageLimitTotal?: number | null;
  readonly usageLimitPerCustomer?: number | null;
}

export interface UpsertSubscriptionPlanRequest {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly validityDays: number;
  readonly visitAllowance: number;
  readonly vehicleType: VehicleType;
  readonly eligibleServiceSlugs: string[];
  readonly benefits: string[];
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export interface AdminCreatePayoutRequest {
  readonly partnerId: string;
  readonly periodStart: IsoDateTime;
  readonly periodEnd: IsoDateTime;
  readonly note?: string;
}

export interface AdminUpdatePayoutRequest {
  readonly status: 'PROCESSING' | 'PAID' | 'FAILED';
  readonly reference?: string | null;
  readonly note?: string | null;
}

export interface AdminUpdateSettingsRequest {
  readonly taxPercent?: number;
  readonly platformCommissionPercent?: number;
  readonly platformFeeMinor?: number;
  readonly visitFeeMinor?: number;
  readonly cancellationWindowHours?: number;
  readonly cancellationFeePercent?: number;
  readonly rescheduleWindowHours?: number;
  readonly maxReschedulesPerBooking?: number;
  readonly assignmentOfferTtlSeconds?: number;
  readonly maxConcurrentPartnerJobs?: number;
  readonly supportPhone?: string;
  readonly supportEmail?: string;
}

export interface AdminCreateAdminRequest {
  readonly phone: string;
  readonly name: string;
  readonly email: string;
  readonly adminRole: AdminRole;
  readonly password: string;
}

export interface AdminBroadcastNotificationRequest {
  readonly title: string;
  readonly body: string;
  readonly audience: 'ALL_CUSTOMERS' | 'ALL_PARTNERS' | 'CUSTOMER' | 'PARTNER' | 'ADMIN';
  readonly targetUserId?: string;
  readonly type?: NotificationType;
}

/* ------------------------------------------------------------------ */
/* Aggregated response shapes                                          */
/* ------------------------------------------------------------------ */

export type ListVehiclesResponse = Paginated<Vehicle> | { items: Vehicle[] };
export type ListAddressesResponse = { items: Address[] };
export type ListCategoriesResponse = { items: ServiceCategory[] };
export type ListServicesResponse = { items: Service[] };
export type ListAreasResponse = { items: ServiceArea[] };
export type ListBookingsResponse = Paginated<BookingSummary>;
export type ListCouponsResponse = Paginated<Coupon>;
export type ListPlansResponse = { items: SubscriptionPlan[] };
export type ListSubscriptionsResponse = { items: CustomerSubscription[] };
export type ListReviewsResponse = Paginated<Review>;
export type ListTicketsResponse = Paginated<SupportTicket>;
export type ListNotificationsResponse = Paginated<AppNotification>;
export type ListAuditLogsResponse = Paginated<AuditLogEntry>;
export type ListAdminBookingsResponse = Paginated<AdminBookingRow>;
export type ListAdminCustomersResponse = Paginated<AdminCustomerRow>;
export type ListAdminPartnersResponse = Paginated<AdminPartnerRow>;
export type ValidateCouponResponse = CouponValidationResult;
export type AdminDashboardResponse = AdminDashboardMetrics;
export type AdminReportResponse = AdminReport;
export type AdminSettingsResponse = BusinessSettings;
export type ServiceabilityResponse = ServiceabilityResult;
