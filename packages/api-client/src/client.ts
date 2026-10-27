import type {
  AdminAssignBookingRequest,
  AdminApprovePartnerRequest,
  AdminBroadcastNotificationRequest,
  AdminCancelBookingRequest,
  AdminCreateAdminRequest,
  AdminCreatePayoutRequest,
  AdminDashboardMetrics,
  AdminListBookingsQuery,
  AdminReport,
  AdminReviewDocumentRequest,
  AdminUpdatePayoutRequest,
  AdminUpdateSettingsRequest,
  Address,
  AppNotification,
  AuditLogEntry,
  AuthSession,
  AuthUser,
  AvailabilityQuery,
  AvailabilityResponse,
  BookingDetail,
  BookingStatusResponse,
  BookingSummary,
  BusinessSettings,
  CancelBookingRequest,
  CancelBookingResponse,
  Coupon,
  CreateAddressRequest,
  CreateBookingRequest,
  CreateBookingResponse,
  CreatePaymentOrderResult,
  CreateReviewRequest,
  CreateSupportTicketRequest,
  CreateVehicleRequest,
  CustomerProfile,
  CustomerSubscription,
  DeleteAccountRequest,
  GeoPoint,
  LedgerEntry,
  ListAdminBookingsResponse,
  ListAdminCustomersResponse,
  ListAdminPartnersResponse,
  ListAuditLogsResponse,
  ListBookingsResponse,
  ListNotificationsResponse,
  ListReviewsResponse,
  ListTicketsResponse,
  Paginated,
  PartnerEarningsResponse,
  PartnerJobActionRequest,
  PartnerJobDetail,
  PartnerJobStatusRequest,
  PartnerJobsResponse,
  PartnerLocationRequest,
  PartnerPayoutsResponse,
  PartnerProfile,
  PartnerPayout,
  PartnerRegisterRequest,
  PartnerProfileUpdateRequest,
  PartnerDocumentUploadRequest,
  PartnerDutyStatusRequest,
  PartnerPhotoUploadRequest,
  PriceQuoteRequest,
  PriceQuoteResponse,
  Refund,
  RequestOtpRequest,
  RequestOtpResponse,
  Service,
  ServiceArea,
  ServiceCategory,
  ServiceabilityResult,
  SubscriptionPlan,
  SupportTicket,
  UpdateAddressRequest,
  UpdateProfileRequest,
  UpdateVehicleRequest,
  UpsertAddonRequest,
  UpsertCouponRequest,
  UpsertServiceAreaRequest,
  UpsertServiceRequest,
  UpsertSubscriptionPlanRequest as UpsertPlanRequest,
  ValidateCouponRequest,
  Vehicle,
  VerifyOtpRequest,
  VerifyPaymentRequest,
  VerifyPaymentResult,
} from '@autowra/shared-types';

import { ApiClientError, NetworkError } from './errors';

export interface TokenStore {
  getAccessToken(): string | null | Promise<string | null>;
  getRefreshToken(): string | null | Promise<string | null>;
  setSession(session: AuthSession | null): void | Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore?: TokenStore;
  /** Override for tests or non-standard runtimes. */
  fetchImpl?: typeof fetch;
  /** Called when the session can no longer be refreshed. */
  onSessionExpired?: () => void;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Internal guard so a failed refresh does not recurse. */
  retryOnUnauthorized?: boolean;
  raw?: boolean;
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const serialised = params.toString();
  return serialised.length > 0 ? `?${serialised}` : '';
}

/**
 * Typed HTTP client shared by the two mobile apps and the admin dashboard.
 * It owns token attachment, one-shot refresh on 401 and error normalisation
 * so screens only deal with `ApiClientError`.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly options: ApiClientOptions;
  private readonly fetchImpl: typeof fetch;
  private refreshInFlight: Promise<AuthSession | null> | null = null;

  constructor(options: ApiClientOptions) {
    this.options = options;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async resolveToken(): Promise<string | null> {
    if (!this.options.tokenStore) return null;
    return this.options.tokenStore.getAccessToken();
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${options.path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.options.defaultHeaders,
      ...options.headers,
    };

    const requiresAuth = options.auth !== false;
    if (requiresAuth) {
      const token = await this.resolveToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let bodyInit: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? 20_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body: bodyInit,
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError' && options.signal?.aborted) {
        throw new NetworkError('The request was cancelled.');
      }
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }

    if (response.status === 401 && requiresAuth && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshSession();
      if (refreshed) {
        return this.request<T>({ ...options, retryOnUnauthorized: false });
      }
      this.options.onSessionExpired?.();
    }

    return this.parse<T>(response, options.raw === true);
  }

  private async parse<T>(response: Response, raw: boolean): Promise<T> {
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload = text.length > 0 ? safeJsonParse(text) : undefined;

    if (!response.ok) {
      const body = (payload ?? {}) as Record<string, unknown>;
      throw new ApiClientError({
        statusCode: response.status,
        code: typeof body.code === 'string' ? body.code : 'INTERNAL_ERROR',
        message:
          typeof body.message === 'string'
            ? body.message
            : response.status >= 500
              ? 'Something went wrong on our side. Please try again.'
              : 'The request could not be completed.',
        details: Array.isArray(body.details) ? (body.details as Array<{ path: string; message: string }>) : [],
        requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
      });
    }

    if (raw) return payload as T;
    return payload as T;
  }

  private async refreshSession(): Promise<AuthSession | null> {
    if (!this.options.tokenStore) return null;
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const refreshToken = await this.options.tokenStore?.getRefreshToken();
        if (!refreshToken) return null;
        const session = await this.request<AuthSession>({
          method: 'POST',
          path: '/auth/refresh',
          body: { refreshToken },
          auth: false,
          retryOnUnauthorized: false,
        });
        await this.options.tokenStore?.setSession(session);
        return session;
      } catch {
        await this.options.tokenStore?.setSession(null);
        return null;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  /* ----------------------------- auth ----------------------------- */

  requestOtp(body: RequestOtpRequest): Promise<RequestOtpResponse> {
    return this.request({ method: 'POST', path: '/auth/login', body, auth: false });
  }

  verifyOtp(body: VerifyOtpRequest): Promise<AuthSession> {
    return this.request({ method: 'POST', path: '/auth/verify-otp', body, auth: false });
  }

  logout(refreshToken: string): Promise<{ success: boolean }> {
    return this.request({ method: 'POST', path: '/auth/logout', body: { refreshToken }, auth: false });
  }

  me(): Promise<AuthUser> {
    return this.request({ method: 'GET', path: '/auth/me' });
  }

  registerPushToken(body: { token: string; platform: 'ios' | 'android' | 'web'; deviceId?: string }): Promise<{ success: boolean }> {
    return this.request({ method: 'POST', path: '/auth/push-token', body });
  }

  /* --------------------------- customer --------------------------- */

  getMyProfile(): Promise<CustomerProfile> {
    return this.request({ method: 'GET', path: '/customers/me' });
  }

  updateMyProfile(body: UpdateProfileRequest): Promise<CustomerProfile> {
    return this.request({ method: 'PATCH', path: '/customers/me', body });
  }

  requestAccountDeletion(body: DeleteAccountRequest): Promise<{ success: boolean; message: string }> {
    return this.request({ method: 'POST', path: '/customers/me/delete-request', body });
  }

  listVehicles(): Promise<{ items: Vehicle[] }> {
    return this.request({ method: 'GET', path: '/vehicles' });
  }

  createVehicle(body: CreateVehicleRequest): Promise<Vehicle> {
    return this.request({ method: 'POST', path: '/vehicles', body });
  }

  updateVehicle(id: string, body: UpdateVehicleRequest): Promise<Vehicle> {
    return this.request({ method: 'PATCH', path: `/vehicles/${id}`, body });
  }

  deleteVehicle(id: string): Promise<{ success: boolean }> {
    return this.request({ method: 'DELETE', path: `/vehicles/${id}` });
  }

  listAddresses(): Promise<{ items: Address[] }> {
    return this.request({ method: 'GET', path: '/addresses' });
  }

  createAddress(body: CreateAddressRequest): Promise<Address> {
    return this.request({ method: 'POST', path: '/addresses', body });
  }

  updateAddress(id: string, body: UpdateAddressRequest): Promise<Address> {
    return this.request({ method: 'PATCH', path: `/addresses/${id}`, body });
  }

  deleteAddress(id: string): Promise<{ success: boolean }> {
    return this.request({ method: 'DELETE', path: `/addresses/${id}` });
  }

  /* --------------------------- catalogue --------------------------- */

  listCategories(): Promise<{ items: ServiceCategory[] }> {
    return this.request({ method: 'GET', path: '/services/categories', auth: false });
  }

  listServices(query: { vehicleType?: string; categorySlug?: string; popularOnly?: boolean } = {}): Promise<{ items: Service[] }> {
    return this.request({ method: 'GET', path: '/services', query, auth: false });
  }

  getService(id: string): Promise<Service> {
    return this.request({ method: 'GET', path: `/services/${id}`, auth: false });
  }

  listServiceAreas(): Promise<{ items: ServiceArea[] }> {
    return this.request({ method: 'GET', path: '/service-areas', auth: false });
  }

  checkServiceability(query: { postalCode?: string; latitude?: number; longitude?: number }): Promise<ServiceabilityResult> {
    return this.request({ method: 'GET', path: '/service-areas/check', query, auth: false });
  }

  getAvailability(query: AvailabilityQuery): Promise<AvailabilityResponse> {
    return this.request({ method: 'GET', path: '/availability', query: { ...query } });
  }

  /* ---------------------------- pricing ---------------------------- */

  quotePrice(body: PriceQuoteRequest): Promise<PriceQuoteResponse> {
    return this.request({ method: 'POST', path: '/pricing/quote', body });
  }

  validateCoupon(body: ValidateCouponRequest): Promise<{ valid: boolean; coupon: Coupon | null; discountMinor: number; message: string }> {
    return this.request({ method: 'POST', path: '/coupons/validate', body });
  }

  listMyCoupons(): Promise<{ items: Coupon[] }> {
    return this.request({ method: 'GET', path: '/coupons/mine' });
  }

  /* --------------------------- bookings --------------------------- */

  createBooking(body: CreateBookingRequest): Promise<CreateBookingResponse> {
    return this.request({ method: 'POST', path: '/bookings', body });
  }

  listBookings(query: { status?: string; page?: number; pageSize?: number; upcomingOnly?: boolean } = {}): Promise<ListBookingsResponse> {
    return this.request({ method: 'GET', path: '/bookings', query });
  }

  getBooking(id: string): Promise<BookingDetail> {
    return this.request({ method: 'GET', path: `/bookings/${id}` });
  }

  getBookingStatus(id: string): Promise<BookingStatusResponse> {
    return this.request({ method: 'GET', path: `/bookings/${id}/status` });
  }

  cancelBooking(id: string, body: CancelBookingRequest): Promise<CancelBookingResponse> {
    return this.request({ method: 'POST', path: `/bookings/${id}/cancel`, body });
  }

  rescheduleBooking(id: string, body: { scheduledStart: string; reason?: string }): Promise<BookingDetail> {
    return this.request({ method: 'POST', path: `/bookings/${id}/reschedule`, body });
  }

  /* --------------------------- payments --------------------------- */

  createPaymentOrder(bookingId: string): Promise<CreatePaymentOrderResult> {
    return this.request({ method: 'POST', path: '/payments/create-order', body: { bookingId } });
  }

  verifyPayment(body: VerifyPaymentRequest): Promise<VerifyPaymentResult> {
    return this.request({ method: 'POST', path: '/payments/verify', body });
  }

  /** Development-only helper for the mock provider. */
  simulatePayment(params: { paymentId: string; outcome: 'success' | 'failure' }): Promise<VerifyPaymentResult> {
    return this.request({ method: 'POST', path: '/payments/dev/simulate', body: params });
  }

  listMyPayments(): Promise<Paginated<{ id: string; bookingId: string; amountMinor: number; status: string; createdAt: string }>> {
    return this.request({ method: 'GET', path: '/payments/mine' });
  }

  listMyRefunds(): Promise<{ items: Refund[] }> {
    return this.request({ method: 'GET', path: '/payments/refunds' });
  }

  /* ------------------------ reviews & support ---------------------- */

  createReview(body: CreateReviewRequest): Promise<{ success: boolean }> {
    return this.request({ method: 'POST', path: '/reviews', body });
  }

  listReviews(query: { serviceId?: string; partnerId?: string; limit?: number } = {}): Promise<ListReviewsResponse> {
    return this.request({ method: 'GET', path: '/reviews', query, auth: false });
  }

  createTicket(body: CreateSupportTicketRequest): Promise<SupportTicket> {
    return this.request({ method: 'POST', path: '/support/tickets', body });
  }

  listMyTickets(): Promise<ListTicketsResponse> {
    return this.request({ method: 'GET', path: '/support/tickets' });
  }

  getTicket(id: string): Promise<SupportTicket> {
    return this.request({ method: 'GET', path: `/support/tickets/${id}` });
  }

  replyTicket(id: string, body: string): Promise<SupportTicket> {
    return this.request({ method: 'POST', path: `/support/tickets/${id}/messages`, body: { body } });
  }

  /* ------------------------ notifications ------------------------ */

  listNotifications(query: { page?: number; pageSize?: number } = {}): Promise<ListNotificationsResponse> {
    return this.request({ method: 'GET', path: '/notifications', query });
  }

  markNotificationRead(id: string): Promise<AppNotification> {
    return this.request({ method: 'POST', path: `/notifications/${id}/read` });
  }

  markAllNotificationsRead(): Promise<{ success: boolean }> {
    return this.request({ method: 'POST', path: '/notifications/read-all' });
  }

  /* ------------------------- subscriptions ------------------------ */

  listPlans(): Promise<{ items: SubscriptionPlan[] }> {
    return this.request({ method: 'GET', path: '/subscriptions/plans', auth: false });
  }

  listMySubscriptions(): Promise<{ items: CustomerSubscription[] }> {
    return this.request({ method: 'GET', path: '/subscriptions/mine' });
  }

  subscribe(body: { planId: string; vehicleId: string; paymentMethod: string; idempotencyKey: string }): Promise<{ subscription: CustomerSubscription; payment: CreatePaymentOrderResult | null }> {
    return this.request({ method: 'POST', path: '/subscriptions', body });
  }

  cancelSubscription(id: string): Promise<CustomerSubscription> {
    return this.request({ method: 'POST', path: `/subscriptions/${id}/cancel` });
  }

  /* ---------------------------- partner --------------------------- */

  getPartnerProfile(): Promise<PartnerProfile> {
    return this.request({ method: 'GET', path: '/partner/profile' });
  }

  registerPartner(body: PartnerRegisterRequest): Promise<PartnerProfile> {
    return this.request({ method: 'POST', path: '/partner/register', body });
  }

  updatePartnerProfile(body: PartnerProfileUpdateRequest): Promise<PartnerProfile> {
    return this.request({ method: 'PATCH', path: '/partner/profile', body });
  }

  uploadPartnerDocument(body: PartnerDocumentUploadRequest): Promise<PartnerProfile> {
    return this.request({ method: 'POST', path: '/partner/documents', body });
  }

  submitPartnerApplication(): Promise<PartnerProfile> {
    return this.request({ method: 'POST', path: '/partner/submit' });
  }

  setPartnerDutyStatus(body: PartnerDutyStatusRequest): Promise<PartnerProfile> {
    return this.request({ method: 'POST', path: '/partner/duty', body });
  }

  listPartnerJobs(query: { scope?: string; page?: number; pageSize?: number } = {}): Promise<PartnerJobsResponse> {
    return this.request({ method: 'GET', path: '/partner/jobs', query });
  }

  getPartnerJob(id: string): Promise<PartnerJobDetail> {
    return this.request({ method: 'GET', path: `/partner/jobs/${id}` });
  }

  acceptPartnerJob(id: string, body: PartnerJobActionRequest = {}): Promise<PartnerJobDetail> {
    return this.request({ method: 'POST', path: `/partner/jobs/${id}/accept`, body });
  }

  rejectPartnerJob(id: string, body: PartnerJobActionRequest = {}): Promise<{ success: boolean }> {
    return this.request({ method: 'POST', path: `/partner/jobs/${id}/reject`, body });
  }

  updatePartnerJobStatus(id: string, body: PartnerJobStatusRequest): Promise<PartnerJobDetail> {
    return this.request({ method: 'POST', path: `/partner/jobs/${id}/status`, body });
  }

  reportPartnerJobIssue(id: string, body: { reason: string; note?: string }): Promise<PartnerJobDetail> {
    return this.request({ method: 'POST', path: `/partner/jobs/${id}/issue`, body });
  }

  pushPartnerLocation(body: PartnerLocationRequest): Promise<{ success: boolean }> {
    return this.request({ method: 'POST', path: '/partner/location', body });
  }

  uploadPartnerJobPhoto(id: string, body: PartnerPhotoUploadRequest): Promise<PartnerJobDetail> {
    return this.request({ method: 'POST', path: `/partner/jobs/${id}/photos`, body });
  }

  getPartnerEarnings(query: { page?: number; pageSize?: number } = {}): Promise<PartnerEarningsResponse> {
    return this.request({ method: 'GET', path: '/partner/earnings', query });
  }

  getPartnerPayouts(query: { page?: number; pageSize?: number } = {}): Promise<PartnerPayoutsResponse> {
    return this.request({ method: 'GET', path: '/partner/payouts', query });
  }

  /* ----------------------------- admin ---------------------------- */

  adminLogin(body: { email: string; password: string }): Promise<AuthSession> {
    return this.request({ method: 'POST', path: '/admin/auth/login', body, auth: false });
  }

  adminDashboard(query: { rangeDays?: number } = {}): Promise<AdminDashboardMetrics> {
    return this.request({ method: 'GET', path: '/admin/dashboard', query });
  }

  adminListBookings(query: AdminListBookingsQuery = {}): Promise<ListAdminBookingsResponse> {
    return this.request({ method: 'GET', path: '/admin/bookings', query: { ...query } });
  }

  adminGetBooking(id: string): Promise<BookingDetail> {
    return this.request({ method: 'GET', path: `/admin/bookings/${id}` });
  }

  adminAssignBooking(id: string, body: AdminAssignBookingRequest): Promise<BookingDetail> {
    return this.request({ method: 'POST', path: `/admin/bookings/${id}/assign`, body });
  }

  adminCancelBooking(id: string, body: AdminCancelBookingRequest): Promise<BookingDetail> {
    return this.request({ method: 'POST', path: `/admin/bookings/${id}/cancel`, body });
  }

  adminListCustomers(query: { page?: number; pageSize?: number; search?: string } = {}): Promise<ListAdminCustomersResponse> {
    return this.request({ method: 'GET', path: '/admin/customers', query });
  }

  adminListPartners(query: { page?: number; pageSize?: number; search?: string; status?: string } = {}): Promise<ListAdminPartnersResponse> {
    return this.request({ method: 'GET', path: '/admin/partners', query });
  }

  adminGetPartner(id: string): Promise<PartnerProfile> {
    return this.request({ method: 'GET', path: `/admin/partners/${id}` });
  }

  adminApprovePartner(id: string, body: AdminApprovePartnerRequest): Promise<PartnerProfile> {
    return this.request({ method: 'POST', path: `/admin/partners/${id}/approve`, body });
  }

  adminReviewPartnerDocument(partnerId: string, documentId: string, body: AdminReviewDocumentRequest): Promise<PartnerProfile> {
    return this.request({ method: 'POST', path: `/admin/partners/${partnerId}/documents/${documentId}/review`, body });
  }

  adminListServices(): Promise<{ items: Service[] }> {
    return this.request({ method: 'GET', path: '/admin/services' });
  }

  adminCreateService(body: UpsertServiceRequest): Promise<Service> {
    return this.request({ method: 'POST', path: '/admin/services', body });
  }

  adminUpdateService(id: string, body: UpsertServiceRequest): Promise<Service> {
    return this.request({ method: 'PUT', path: `/admin/services/${id}`, body });
  }

  adminDeleteService(id: string): Promise<{ success: boolean }> {
    return this.request({ method: 'DELETE', path: `/admin/services/${id}` });
  }

  adminListAddons(): Promise<{ items: Service['addons'] }> {
    return this.request({ method: 'GET', path: '/admin/addons' });
  }

  adminCreateAddon(body: UpsertAddonRequest): Promise<Service['addons'][number]> {
    return this.request({ method: 'POST', path: '/admin/addons', body });
  }

  adminUpdateAddon(id: string, body: UpsertAddonRequest): Promise<Service['addons'][number]> {
    return this.request({ method: 'PUT', path: `/admin/addons/${id}`, body });
  }

  adminListAreas(): Promise<{ items: ServiceArea[] }> {
    return this.request({ method: 'GET', path: '/admin/service-areas' });
  }

  adminCreateArea(body: UpsertServiceAreaRequest): Promise<ServiceArea> {
    return this.request({ method: 'POST', path: '/admin/service-areas', body });
  }

  adminUpdateArea(id: string, body: UpsertServiceAreaRequest): Promise<ServiceArea> {
    return this.request({ method: 'PUT', path: `/admin/service-areas/${id}`, body });
  }

  adminListCoupons(query: { page?: number; pageSize?: number; search?: string } = {}): Promise<Paginated<Coupon>> {
    return this.request({ method: 'GET', path: '/admin/coupons', query });
  }

  adminCreateCoupon(body: UpsertCouponRequest): Promise<Coupon> {
    return this.request({ method: 'POST', path: '/admin/coupons', body });
  }

  adminUpdateCoupon(id: string, body: UpsertCouponRequest): Promise<Coupon> {
    return this.request({ method: 'PUT', path: `/admin/coupons/${id}`, body });
  }

  adminListPlans(): Promise<{ items: SubscriptionPlan[] }> {
    return this.request({ method: 'GET', path: '/admin/subscription-plans' });
  }

  adminUpsertPlan(body: UpsertPlanRequest, id?: string): Promise<SubscriptionPlan> {
    return id
      ? this.request({ method: 'PUT', path: `/admin/subscription-plans/${id}`, body })
      : this.request({ method: 'POST', path: '/admin/subscription-plans', body });
  }

  adminListPayments(query: { page?: number; pageSize?: number; status?: string } = {}): Promise<Paginated<{ id: string; bookingReference: string; amountMinor: number; status: string; method: string; createdAt: string }>> {
    return this.request({ method: 'GET', path: '/admin/payments', query });
  }

  adminListRefunds(query: { page?: number; pageSize?: number } = {}): Promise<Paginated<Refund>> {
    return this.request({ method: 'GET', path: '/admin/refunds', query });
  }

  adminCreateRefund(body: { paymentId: string; amountMinor: number; reason: string }): Promise<Refund> {
    return this.request({ method: 'POST', path: '/admin/refunds', body });
  }

  adminListEarnings(query: { page?: number; pageSize?: number; partnerId?: string } = {}): Promise<{ items: LedgerEntry[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
    return this.request({ method: 'GET', path: '/admin/earnings', query });
  }

  adminListPayouts(query: { page?: number; pageSize?: number; partnerId?: string; status?: string } = {}): Promise<Paginated<PartnerPayout>> {
    return this.request({ method: 'GET', path: '/admin/payouts', query });
  }

  adminCreatePayout(body: AdminCreatePayoutRequest): Promise<PartnerPayout> {
    return this.request({ method: 'POST', path: '/admin/payouts', body });
  }

  adminUpdatePayout(id: string, body: AdminUpdatePayoutRequest): Promise<PartnerPayout> {
    return this.request({ method: 'POST', path: `/admin/payouts/${id}`, body });
  }

  adminListReviews(query: { page?: number; pageSize?: number } = {}): Promise<ListReviewsResponse> {
    return this.request({ method: 'GET', path: '/admin/reviews', query });
  }

  adminListTickets(query: { page?: number; pageSize?: number; status?: string; category?: string } = {}): Promise<ListTicketsResponse> {
    return this.request({ method: 'GET', path: '/admin/tickets', query });
  }

  adminUpdateTicket(id: string, body: { status: string; note?: string }): Promise<SupportTicket> {
    return this.request({ method: 'POST', path: `/admin/tickets/${id}/status`, body });
  }

  adminReplyTicket(id: string, body: string): Promise<SupportTicket> {
    return this.request({ method: 'POST', path: `/admin/tickets/${id}/messages`, body: { body } });
  }

  adminListAuditLogs(query: { page?: number; pageSize?: number; entity?: string; action?: string } = {}): Promise<ListAuditLogsResponse> {
    return this.request({ method: 'GET', path: '/admin/audit-logs', query });
  }

  adminReport(query: { days?: number; from?: string; to?: string } = {}): Promise<AdminReport> {
    return this.request({ method: 'GET', path: '/admin/reports', query });
  }

  adminGetSettings(): Promise<BusinessSettings> {
    return this.request({ method: 'GET', path: '/admin/settings' });
  }

  adminUpdateSettings(body: AdminUpdateSettingsRequest): Promise<BusinessSettings> {
    return this.request({ method: 'PATCH', path: '/admin/settings', body });
  }

  adminCreateAdmin(body: AdminCreateAdminRequest): Promise<AuthUser> {
    return this.request({ method: 'POST', path: '/admin/users', body });
  }

  adminListAdmins(): Promise<{ items: AuthUser[] }> {
    return this.request({ method: 'GET', path: '/admin/users' });
  }

  adminBroadcast(body: AdminBroadcastNotificationRequest): Promise<{ success: boolean; recipients: number }> {
    return this.request({ method: 'POST', path: '/admin/notifications/broadcast', body });
  }

  adminExportBookingsCsv(query: AdminListBookingsQuery = {}): Promise<string> {
    return this.request({ method: 'GET', path: '/admin/bookings/export', query: { ...query }, raw: true });
  }

  /** Helper used by the mock payment screen to poll until the server confirms. */
  async waitForBookingStatus(
    bookingId: string,
    predicate: (status: BookingStatusResponse) => boolean,
    options: { attempts?: number; intervalMs?: number } = {},
  ): Promise<BookingStatusResponse | null> {
    const attempts = options.attempts ?? 10;
    const intervalMs = options.intervalMs ?? 1500;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const status = await this.getBookingStatus(bookingId);
      if (predicate(status)) return status;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type { AdminListBookingsQuery, PartnerPayout, BookingSummary, GeoPoint };
export { ApiClientError, NetworkError };
