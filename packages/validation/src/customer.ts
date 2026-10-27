import { z } from 'zod';

import { VehicleSize, VehicleType } from '@autowra/shared-types';

import {
  addressLabelSchema,
  indianPostalCodeSchema,
  latitudeSchema,
  longitudeSchema,
  vehicleSizeSchema,
  vehicleTypeSchema,
} from './common';

/** Vehicle sizes that make sense for a given vehicle type. */
export const allowedSizesByType: Record<VehicleType, readonly VehicleSize[]> = {
  [VehicleType.CAR]: [VehicleSize.HATCHBACK, VehicleSize.SEDAN, VehicleSize.SUV, VehicleSize.MUV, VehicleSize.LUXURY],
  [VehicleType.BIKE]: [VehicleSize.BIKE_SMALL, VehicleSize.BIKE_MEDIUM, VehicleSize.BIKE_LARGE],
};

const registrationNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9 -]{4,15}$/, 'Enter a valid registration number');

export const createVehicleSchema = z
  .object({
    type: vehicleTypeSchema,
    size: vehicleSizeSchema,
    make: z.string().trim().min(1, 'Make is required').max(40),
    model: z.string().trim().min(1, 'Model is required').max(60),
    registrationNumber: registrationNumberSchema.nullable().optional(),
    nickname: z.string().trim().max(40).nullable().optional(),
    color: z.string().trim().max(30).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Boolean(allowedSizesByType[value.type]?.includes(value.size)), {
    message: 'The selected size is not available for this vehicle type',
    path: ['size'],
  });

export const updateVehicleSchema = z
  .object({
    type: vehicleTypeSchema.optional(),
    size: vehicleSizeSchema.optional(),
    make: z.string().trim().min(1).max(40).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    registrationNumber: registrationNumberSchema.nullable().optional(),
    nickname: z.string().trim().max(40).nullable().optional(),
    color: z.string().trim().max(30).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.type === undefined || value.size === undefined || Boolean(allowedSizesByType[value.type]?.includes(value.size)),
    { message: 'The selected size is not available for this vehicle type', path: ['size'] },
  );

export const createAddressSchema = z.object({
  label: addressLabelSchema,
  nickname: z.string().trim().max(40).nullable().optional(),
  line1: z.string().trim().min(4, 'Address line is too short').max(160),
  line2: z.string().trim().max(160).nullable().optional(),
  landmark: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(2, 'City is required').max(60),
  state: z.string().trim().min(2, 'State is required').max(60),
  postalCode: indianPostalCodeSchema,
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  isDefault: z.boolean().optional(),
});

export const updateAddressSchema = createAddressSchema.partial();

export const serviceabilityQuerySchema = z
  .object({
    postalCode: indianPostalCodeSchema.optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
  })
  .refine((value) => value.postalCode !== undefined || (value.latitude !== undefined && value.longitude !== undefined), {
    message: 'Provide a postal code or a latitude/longitude pair',
  });

export const updateNotificationPreferencesSchema = z.object({
  pushOptIn: z.boolean(),
  emailOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
