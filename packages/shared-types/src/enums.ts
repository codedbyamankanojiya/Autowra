/**
 * Domain enumerations.
 *
 * These are plain `as const` objects plus union types rather than TypeScript
 * `enum`s so that the same runtime values can be shared by Node (NestJS),
 * Metro (React Native) and the Next.js server without interop surprises.
 *
 * The Prisma schema declares matching enums; keep both in sync.
 */

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  PARTNER: 'PARTNER',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Fine grained roles for staff accounts. Only ADMIN users have these. */
export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OPERATIONS: 'OPERATIONS',
  FINANCE: 'FINANCE',
  SUPPORT: 'SUPPORT',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const PartnerStatus = {
  /** Registered but the application has not been submitted yet. */
  DRAFT: 'DRAFT',
  /** Submitted and waiting for an administrator to review documents. */
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type PartnerStatus = (typeof PartnerStatus)[keyof typeof PartnerStatus];

export const DocumentType = {
  AADHAAR: 'AADHAAR',
  PAN: 'PAN',
  DRIVING_LICENSE: 'DRIVING_LICENSE',
  PROFILE_PHOTO: 'PROFILE_PHOTO',
  POLICE_VERIFICATION: 'POLICE_VERIFICATION',
  BANK_PROOF: 'BANK_PROOF',
  OTHER: 'OTHER',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const DocumentStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const VehicleType = {
  CAR: 'CAR',
  BIKE: 'BIKE',
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

export const VehicleSize = {
  HATCHBACK: 'HATCHBACK',
  SEDAN: 'SEDAN',
  SUV: 'SUV',
  MUV: 'MUV',
  LUXURY: 'LUXURY',
  BIKE_SMALL: 'BIKE_SMALL',
  BIKE_MEDIUM: 'BIKE_MEDIUM',
  BIKE_LARGE: 'BIKE_LARGE',
} as const;
export type VehicleSize = (typeof VehicleSize)[keyof typeof VehicleSize];

export const AddressLabel = {
  HOME: 'HOME',
  WORK: 'WORK',
  OTHER: 'OTHER',
} as const;
export type AddressLabel = (typeof AddressLabel)[keyof typeof AddressLabel];

/**
 * Booking lifecycle. Payment status is tracked separately on the payment
 * record, so a booking can be CONFIRMED while its payment is still PENDING
 * (for pay-after-service methods).
 */
export const BookingStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  ASSIGNED: 'ASSIGNED',
  PARTNER_ACCEPTED: 'PARTNER_ACCEPTED',
  TRAVELLING: 'TRAVELLING',
  ARRIVED: 'ARRIVED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_PARTNER_FOUND: 'NO_PARTNER_FOUND',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/** Lifecycle of a single partner <-> booking assignment. */
export const AssignmentStatus = {
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  TIMED_OUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = {
  UPI: 'UPI',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  WALLET: 'WALLET',
  /** Collected in cash by the partner after the service. */
  CASH_AFTER_SERVICE: 'CASH_AFTER_SERVICE',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentProvider = {
  RAZORPAY: 'RAZORPAY',
  /** Development-only simulated provider. Never used in production. */
  MOCK: 'MOCK',
  CASH: 'CASH',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export const RefundStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const CouponType = {
  PERCENTAGE: 'PERCENTAGE',
  FLAT: 'FLAT',
} as const;
export type CouponType = (typeof CouponType)[keyof typeof CouponType];

export const SubscriptionStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const LedgerEntryType = {
  /** Amount credited to the partner for completing a job. */
  JOB_EARNING: 'JOB_EARNING',
  /** Platform commission deducted from the partner. */
  COMMISSION: 'COMMISSION',
  INCENTIVE: 'INCENTIVE',
  ADJUSTMENT: 'ADJUSTMENT',
  PAYOUT: 'PAYOUT',
  /** Reversal issued when a job is cancelled/refunded after settlement. */
  REVERSAL: 'REVERSAL',
} as const;
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];

export const PayoutStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

/** How broadly a commission rule applies; a narrower scope always wins. */
export const CommissionScope = {
  GLOBAL: 'GLOBAL',
  SERVICE: 'SERVICE',
  AREA: 'AREA',
  PARTNER: 'PARTNER',
} as const;
export type CommissionScope = (typeof CommissionScope)[keyof typeof CommissionScope];

export const SupportTicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_CUSTOMER: 'WAITING_CUSTOMER',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
export type SupportTicketStatus = (typeof SupportTicketStatus)[keyof typeof SupportTicketStatus];

export const SupportTicketCategory = {
  BOOKING: 'BOOKING',
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
  PARTNER: 'PARTNER',
  SERVICE_QUALITY: 'SERVICE_QUALITY',
  OTHER: 'OTHER',
} as const;
export type SupportTicketCategory = (typeof SupportTicketCategory)[keyof typeof SupportTicketCategory];

export const NotificationType = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
  PARTNER_ASSIGNED: 'PARTNER_ASSIGNED',
  PARTNER_ACCEPTED: 'PARTNER_ACCEPTED',
  PARTNER_TRAVELLING: 'PARTNER_TRAVELLING',
  PARTNER_ARRIVED: 'PARTNER_ARRIVED',
  SERVICE_STARTED: 'SERVICE_STARTED',
  SERVICE_COMPLETED: 'SERVICE_COMPLETED',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUND_UPDATE: 'REFUND_UPDATE',
  JOB_OFFER: 'JOB_OFFER',
  JOB_CANCELLED: 'JOB_CANCELLED',
  PAYOUT_UPDATE: 'PAYOUT_UPDATE',
  SUBSCRIPTION_UPDATE: 'SUBSCRIPTION_UPDATE',
  SUPPORT_TICKET_UPDATE: 'SUPPORT_TICKET_UPDATE',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationChannel = {
  PUSH: 'PUSH',
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  STATUS_CHANGE: 'STATUS_CHANGE',
  ASSIGN: 'ASSIGN',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REFUND: 'REFUND',
  PAYOUT: 'PAYOUT',
  EXPORT: 'EXPORT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const ServiceAreaStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type ServiceAreaStatus = (typeof ServiceAreaStatus)[keyof typeof ServiceAreaStatus];

/** Sorted lifecycle used to render booking trackers. */
export const BOOKING_STATUS_SEQUENCE: readonly BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
  BookingStatus.TRAVELLING,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
];

/** Jobs a partner can still act on. */
export const ACTIVE_PARTNER_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
  BookingStatus.TRAVELLING,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

/** Bookings that may be rescheduled or cancelled by the customer. */
export const CUSTOMER_EDITABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
];

export const PARTNER_JOB_OFFER_TTL_SECONDS = 120;
