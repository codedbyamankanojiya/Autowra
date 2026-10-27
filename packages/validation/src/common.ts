import { z } from 'zod';

import {
  AddressLabel,
  BookingStatus,
  CouponType,
  DocumentType,
  LedgerEntryType,
  NotificationType,
  PaymentMethod,
  PayoutStatus,
  RefundStatus,
  ServiceAreaStatus,
  SubscriptionStatus,
  SupportTicketCategory,
  SupportTicketStatus,
  UserRole,
  VehicleSize,
  VehicleType,
} from '@autowra/shared-types';

/** Indian mobile numbers, optionally in +91 / E.164 form. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10 digit Indian mobile number')
  .transform((value) => (value.startsWith('+91') ? value : `+91${value}`));

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, 'Enter the numeric code sent to your phone');

/**
 * Monetary values travel as integer minor units (paise). The upper bound keeps
 * values far inside the safe-integer range.
 */
export const minorUnitsSchema = z.number().int('Amount must be a whole number of paise').min(0).max(100_000_000_00);

export const percentageSchema = z.number().min(0).max(100);

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const geoPointSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export const indianPostalCodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a valid 6 digit PIN code');

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Use an ISO-8601 date-time string' })
  .or(z.string().datetime({ message: 'Use an ISO-8601 date-time string' }));

export const idSchema = z.string().trim().min(1, 'Identifier is required').max(64);

export const sortOrderSchema = z.number().int().min(0).max(9999);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format');

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'Idempotency key is too short')
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency key contains unsupported characters');

/** Base64 upload payload. The transport limit is enforced again server side. */
export const base64UploadSchema = z
  .string()
  .min(16, 'File payload is too small')
  .max(8_000_000, 'File is larger than the 6 MB limit')
  .regex(/^[A-Za-z0-9+/=\r\n]+$/, 'File payload must be base64 encoded');

export const contentMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/* --------------------------- shared enums --------------------------- */

export const userRoleSchema = z.enum([UserRole.CUSTOMER, UserRole.PARTNER, UserRole.ADMIN]);
export const clientRoleSchema = z.enum([UserRole.CUSTOMER, UserRole.PARTNER]);
export const vehicleTypeSchema = z.enum([VehicleType.CAR, VehicleType.BIKE]);
export const vehicleSizeSchema = z.enum([
  VehicleSize.HATCHBACK,
  VehicleSize.SEDAN,
  VehicleSize.SUV,
  VehicleSize.MUV,
  VehicleSize.LUXURY,
  VehicleSize.BIKE_SMALL,
  VehicleSize.BIKE_MEDIUM,
  VehicleSize.BIKE_LARGE,
]);
export const addressLabelSchema = z.enum([AddressLabel.HOME, AddressLabel.WORK, AddressLabel.OTHER]);
export const bookingStatusSchema = z.enum([
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
  BookingStatus.TRAVELLING,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_PARTNER_FOUND,
]);
export const paymentMethodSchema = z.enum([
  PaymentMethod.UPI,
  PaymentMethod.CARD,
  PaymentMethod.NETBANKING,
  PaymentMethod.WALLET,
  PaymentMethod.CASH_AFTER_SERVICE,
]);
export const refundStatusSchema = z.enum([
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.REJECTED,
  RefundStatus.PROCESSING,
  RefundStatus.COMPLETED,
  RefundStatus.FAILED,
]);
export const couponTypeSchema = z.enum([CouponType.PERCENTAGE, CouponType.FLAT]);
export const subscriptionStatusSchema = z.enum([
  SubscriptionStatus.PENDING_PAYMENT,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAUSED,
  SubscriptionStatus.EXPIRED,
  SubscriptionStatus.CANCELLED,
]);
export const documentTypeSchema = z.enum([
  DocumentType.AADHAAR,
  DocumentType.PAN,
  DocumentType.DRIVING_LICENSE,
  DocumentType.PROFILE_PHOTO,
  DocumentType.POLICE_VERIFICATION,
  DocumentType.BANK_PROOF,
  DocumentType.OTHER,
]);
export const payoutStatusSchema = z.enum([
  PayoutStatus.PENDING,
  PayoutStatus.PROCESSING,
  PayoutStatus.PAID,
  PayoutStatus.FAILED,
]);
export const ledgerEntryTypeSchema = z.enum([
  LedgerEntryType.JOB_EARNING,
  LedgerEntryType.COMMISSION,
  LedgerEntryType.INCENTIVE,
  LedgerEntryType.ADJUSTMENT,
  LedgerEntryType.PAYOUT,
  LedgerEntryType.REVERSAL,
]);
export const serviceAreaStatusSchema = z.enum([ServiceAreaStatus.ACTIVE, ServiceAreaStatus.INACTIVE]);
export const supportTicketCategorySchema = z.enum([
  SupportTicketCategory.BOOKING,
  SupportTicketCategory.PAYMENT,
  SupportTicketCategory.REFUND,
  SupportTicketCategory.PARTNER,
  SupportTicketCategory.SERVICE_QUALITY,
  SupportTicketCategory.OTHER,
]);
export const supportTicketStatusSchema = z.enum([
  SupportTicketStatus.OPEN,
  SupportTicketStatus.IN_PROGRESS,
  SupportTicketStatus.WAITING_CUSTOMER,
  SupportTicketStatus.RESOLVED,
  SupportTicketStatus.CLOSED,
]);
export const notificationTypeSchema = z.enum([
  NotificationType.BOOKING_CREATED,
  NotificationType.BOOKING_CONFIRMED,
  NotificationType.BOOKING_CANCELLED,
  NotificationType.BOOKING_RESCHEDULED,
  NotificationType.PARTNER_ASSIGNED,
  NotificationType.PARTNER_ACCEPTED,
  NotificationType.PARTNER_TRAVELLING,
  NotificationType.PARTNER_ARRIVED,
  NotificationType.SERVICE_STARTED,
  NotificationType.SERVICE_COMPLETED,
  NotificationType.PAYMENT_SUCCESS,
  NotificationType.PAYMENT_FAILED,
  NotificationType.REFUND_UPDATE,
  NotificationType.JOB_OFFER,
  NotificationType.JOB_CANCELLED,
  NotificationType.PAYOUT_UPDATE,
  NotificationType.SUBSCRIPTION_UPDATE,
  NotificationType.SUPPORT_TICKET_UPDATE,
  NotificationType.SYSTEM,
]);

export type PaginationInput = z.infer<typeof paginationSchema>;
export type ListQueryInput = z.infer<typeof listQuerySchema>;
