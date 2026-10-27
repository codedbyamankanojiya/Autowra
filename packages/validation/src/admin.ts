import { z } from 'zod';

import {
  bookingStatusSchema,
  couponTypeSchema,
  emailSchema,
  geoPointSchema,
  idSchema,
  indianPostalCodeSchema,
  isoDateTimeSchema,
  listQuerySchema,
  minorUnitsSchema,
  paginationSchema,
  passwordSchema,
  percentageSchema,
  phoneSchema,
  serviceAreaStatusSchema,
  sortOrderSchema,
  supportTicketCategorySchema,
  supportTicketStatusSchema,
  vehicleSizeSchema,
  vehicleTypeSchema,
} from './common';

export const adminDashboardQuerySchema = z.object({
  rangeDays: z.coerce.number().int().min(1).max(365).default(30),
});

export const adminListBookingsQuerySchema = listQuerySchema.extend({
  status: bookingStatusSchema.optional(),
  paymentStatus: z.string().trim().max(30).optional(),
  areaId: idSchema.optional(),
  partnerId: idSchema.optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  unassignedOnly: z.coerce.boolean().optional(),
});

export const adminListCustomersQuerySchema = listQuerySchema;
export const adminListPartnersQuerySchema = listQuerySchema.extend({
  status: z.string().trim().max(30).optional(),
});

export const adminAssignBookingSchema = z
  .object({
    partnerId: idSchema.optional(),
    note: z.string().trim().max(300).optional(),
    autoAssign: z.boolean().optional(),
  })
  .refine((value) => value.partnerId !== undefined || value.autoAssign === true, {
    message: 'Provide a partner or request automatic assignment',
  });

export const adminCancelBookingSchema = z.object({
  reason: z.string().trim().min(4).max(400),
  refundAmountMinor: minorUnitsSchema.optional(),
  cancelFeeMinor: minorUnitsSchema.optional(),
});

export const adminApprovePartnerSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
  rejectedDocumentIds: z.array(idSchema).max(20).optional(),
});

export const adminReviewDocumentSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(300).optional(),
});

export const upsertServiceSchema = z.object({
  categoryId: idSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,60}$/, 'Use lowercase letters, numbers and dashes'),
  name: z.string().trim().min(3).max(80),
  shortDescription: z.string().trim().min(5).max(160),
  description: z.string().trim().min(10).max(2000),
  vehicleType: vehicleTypeSchema,
  eligibleVehicleSizes: z.array(vehicleSizeSchema).min(1),
  includedTasks: z.array(z.string().trim().min(2).max(120)).min(1).max(20),
  basePriceMinor: minorUnitsSchema,
  durationMinutes: z.number().int().min(15).max(600),
  taxPercent: percentageSchema,
  sizePrices: z.array(z.object({ vehicleSize: vehicleSizeSchema, priceMinor: minorUnitsSchema })).max(10),
  addonIds: z.array(idSchema).max(20),
  isPopular: z.boolean(),
  isActive: z.boolean(),
  sortOrder: sortOrderSchema,
  imageUrl: z.string().trim().url().nullable().optional(),
});

export const upsertAddonSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,60}$/),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(5).max(500),
  priceMinor: minorUnitsSchema,
  durationMinutes: z.number().int().min(0).max(300),
  isActive: z.boolean(),
});

export const upsertServiceAreaSchema = z.object({
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  postalCodes: z.array(indianPostalCodeSchema).min(1).max(500),
  status: serviceAreaStatusSchema,
  boundary: z.array(geoPointSchema).max(200).nullable().optional(),
});

export const upsertCouponSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,30}$/, 'Use uppercase letters, numbers, dashes'),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300),
  type: couponTypeSchema,
  value: z.number().min(0).max(1_000_000),
  maxDiscountMinor: minorUnitsSchema.nullable().optional(),
  minOrderMinor: minorUnitsSchema,
  appliesToVehicleType: vehicleTypeSchema.nullable().optional(),
  firstBookingOnly: z.boolean(),
  isActive: z.boolean(),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema.nullable().optional(),
  usageLimitTotal: z.number().int().min(1).max(1_000_000).nullable().optional(),
  usageLimitPerCustomer: z.number().int().min(1).max(1000).nullable().optional(),
});

export const upsertSubscriptionPlanSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,60}$/),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(5).max(500),
  priceMinor: minorUnitsSchema,
  validityDays: z.number().int().min(7).max(730),
  visitAllowance: z.number().int().min(1).max(200),
  vehicleType: vehicleTypeSchema,
  eligibleServiceSlugs: z.array(z.string().trim().max(60)).min(1).max(20),
  benefits: z.array(z.string().trim().min(2).max(120)).max(10),
  isActive: z.boolean(),
  sortOrder: sortOrderSchema,
});

export const adminCreatePayoutSchema = z.object({
  partnerId: idSchema,
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
  note: z.string().trim().max(300).optional(),
});

export const adminUpdatePayoutSchema = z.object({
  status: z.enum(['PROCESSING', 'PAID', 'FAILED']),
  reference: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

export const adminUpdateSettingsSchema = z.object({
  taxPercent: percentageSchema.optional(),
  platformCommissionPercent: percentageSchema.optional(),
  platformFeeMinor: minorUnitsSchema.optional(),
  visitFeeMinor: minorUnitsSchema.optional(),
  cancellationWindowHours: z.number().int().min(0).max(72).optional(),
  cancellationFeePercent: percentageSchema.optional(),
  rescheduleWindowHours: z.number().int().min(0).max(72).optional(),
  maxReschedulesPerBooking: z.number().int().min(0).max(5).optional(),
  assignmentOfferTtlSeconds: z.number().int().min(30).max(900).optional(),
  maxConcurrentPartnerJobs: z.number().int().min(1).max(20).optional(),
  supportPhone: z.string().trim().max(30).optional(),
  supportEmail: emailSchema.optional(),
});

export const adminCreateAdminSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  adminRole: z.enum(['SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT']),
  password: passwordSchema,
});

export const adminBroadcastNotificationSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(500),
    audience: z.enum(['ALL_CUSTOMERS', 'ALL_PARTNERS', 'CUSTOMER', 'PARTNER', 'ADMIN']),
    targetUserId: idSchema.optional(),
  })
  .refine((value) => !['CUSTOMER', 'PARTNER', 'ADMIN'].includes(value.audience) || value.targetUserId !== undefined, {
    message: 'A target user is required for a targeted audience',
  });

export const adminListAuditLogsQuerySchema = paginationSchema.extend({
  entity: z.string().trim().max(60).optional(),
  actorId: idSchema.optional(),
  action: z.string().trim().max(30).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export const adminListTicketsQuerySchema = paginationSchema.extend({
  status: supportTicketStatusSchema.optional(),
  category: supportTicketCategorySchema.optional(),
});

export const adminListPaymentsQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(30).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export const adminReportsQuerySchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export type AdminAssignBookingInput = z.infer<typeof adminAssignBookingSchema>;
export type UpsertServiceInput = z.infer<typeof upsertServiceSchema>;
export type UpsertCouponInput = z.infer<typeof upsertCouponSchema>;
export type AdminUpdateSettingsInput = z.infer<typeof adminUpdateSettingsSchema>;
