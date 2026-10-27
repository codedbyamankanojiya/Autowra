import { z } from 'zod';

import { BookingStatus } from '@autowra/shared-types';

import {
  bookingStatusSchema,
  idSchema,
  idempotencyKeySchema,
  isoDateTimeSchema,
  paginationSchema,
  paymentMethodSchema,
  supportTicketCategorySchema,
  supportTicketStatusSchema,
} from './common';

export const priceQuoteSchema = z.object({
  serviceId: idSchema,
  vehicleId: idSchema,
  addonIds: z.array(idSchema).max(10).optional(),
  addressId: idSchema.optional(),
  couponCode: z.string().trim().toUpperCase().max(30).optional(),
  subscriptionId: idSchema.optional(),
});

export const createBookingSchema = z.object({
  serviceId: idSchema,
  vehicleId: idSchema,
  addressId: idSchema,
  addonIds: z.array(idSchema).max(10).optional(),
  scheduledStart: isoDateTimeSchema,
  couponCode: z.string().trim().toUpperCase().max(30).optional(),
  subscriptionId: idSchema.optional(),
  paymentMethod: paymentMethodSchema,
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(4, 'Tell us why you are cancelling').max(400),
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const rescheduleBookingSchema = z.object({
  scheduledStart: isoDateTimeSchema,
  reason: z.string().trim().max(400).optional(),
});

export const listBookingsQuerySchema = paginationSchema.extend({
  status: bookingStatusSchema.optional(),
  // Query strings arrive as text, so "false" must not be coerced into true.
  upcomingOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((value) => value === true || value === 'true'),
});

export const createPaymentOrderSchema = z.object({
  bookingId: idSchema,
});

export const simulatePaymentSchema = z.object({
  paymentId: idSchema,
  outcome: z.enum(['success', 'failure']),
});

/**
 * The client echoes back what the gateway checkout returned. Every field is optional because
 * the server already holds the authoritative order/payment ids from the order it created.
 */
export const verifyPaymentSchema = z.object({
  bookingId: idSchema,
  paymentId: idSchema,
  providerOrderId: z.string().trim().max(120).nullable().default(null),
  providerPaymentId: z.string().trim().max(120).nullable().default(null),
  providerSignature: z.string().trim().max(400).nullable().default(null),
});

export const validateCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(30),
  serviceId: idSchema,
  vehicleId: idSchema,
  addonIds: z.array(idSchema).max(10).optional(),
});

export const createReviewSchema = z.object({
  bookingId: idSchema,
  rating: z.number().int().min(1, 'Choose a rating between 1 and 5').max(5),
  comment: z.string().trim().max(600).nullable().optional(),
});

export const createSupportTicketSchema = z.object({
  category: z.enum(['BOOKING', 'PAYMENT', 'REFUND', 'PARTNER', 'SERVICE_QUALITY', 'OTHER']),
  subject: z.string().trim().min(4, 'Subject is too short').max(120),
  description: z.string().trim().min(10, 'Please describe the issue').max(2000),
  bookingId: idSchema.nullable().optional(),
});

export const addTicketMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(2000),
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED']),
  note: z.string().trim().max(500).optional(),
});

/** Queue filters shared by the customer ticket list and the admin ticket desk. */
export const listTicketsQuerySchema = paginationSchema.extend({
  status: supportTicketStatusSchema.optional(),
  category: supportTicketCategorySchema.optional(),
});

export const subscribeSchema = z.object({
  planId: idSchema,
  vehicleId: idSchema,
  paymentMethod: paymentMethodSchema,
  idempotencyKey: idempotencyKeySchema,
});

/** Statuses a customer may request from the API. */
export const customerVisibleStatuses: BookingStatus[] = [
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
];

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type PriceQuoteInput = z.infer<typeof priceQuoteSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;
export type AddTicketMessageInput = z.infer<typeof addTicketMessageSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;
export type ListTicketsQueryInput = z.infer<typeof listTicketsQuerySchema>;
export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderSchema>;
export type SimulatePaymentInput = z.infer<typeof simulatePaymentSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type ListBookingsQueryInput = z.infer<typeof listBookingsQuerySchema>;
