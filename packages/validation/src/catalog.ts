import { z } from 'zod';

import { dateOnlySchema, idSchema, vehicleTypeSchema } from './common';

export const listServicesQuerySchema = z.object({
  vehicleType: vehicleTypeSchema.optional(),
  categorySlug: z.string().trim().max(60).optional(),
  popularOnly: z.coerce.boolean().optional(),
});

export const availabilityQuerySchema = z
  .object({
    serviceId: idSchema,
    date: dateOnlySchema,
    addressId: idSchema.optional(),
    postalCode: z.string().trim().max(10).optional(),
  })
  .refine((value) => value.addressId !== undefined || value.postalCode !== undefined, {
    message: 'Provide an address or a postal code',
  });

export const serviceIdParamSchema = z.object({ id: idSchema });

export const listReviewsQuerySchema = z.object({
  serviceId: idSchema.optional(),
  partnerId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;
export type ListServicesQueryInput = z.infer<typeof listServicesQuerySchema>;
export type ListReviewsQueryInput = z.infer<typeof listReviewsQuerySchema>;
