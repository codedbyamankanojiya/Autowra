import { z } from 'zod';

import {
  base64UploadSchema,
  contentMimeTypeSchema,
  documentTypeSchema,
  geoPointSchema,
  idSchema,
  latitudeSchema,
  longitudeSchema,
  paginationSchema,
} from './common';

export const partnerRegisterSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name').max(80),
  email: z.string().trim().toLowerCase().email().nullable().optional(),
  experienceYears: z.number().int().min(0).max(50),
  skills: z.array(z.string().trim().min(1).max(40)).min(1, 'Select at least one skill').max(10),
  vehicleLabel: z.string().trim().max(60).nullable().optional(),
  serviceAreaIds: z.array(idSchema).min(1, 'Select at least one service area').max(20),
  upiId: z
    .string()
    .trim()
    .regex(/^[\w.\-]{2,64}@[A-Za-z]{2,20}$/, 'Enter a valid UPI ID')
    .nullable()
    .optional(),
  bankAccountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Enter a valid account number').nullable().optional(),
  bankIfsc: z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code').nullable().optional(),
});

export const partnerProfileUpdateSchema = partnerRegisterSchema.partial().extend({
  trainingChecklist: z.array(z.object({ key: z.string().trim().min(1).max(60), completed: z.boolean() })).max(30).optional(),
});

export const partnerDocumentUploadSchema = z.object({
  type: documentTypeSchema,
  fileName: z.string().trim().min(1).max(200),
  contentBase64: base64UploadSchema,
  contentType: contentMimeTypeSchema,
});

export const partnerDutyStatusSchema = z.object({
  isOnline: z.boolean(),
  location: geoPointSchema.optional(),
});

export const partnerJobScopeSchema = z.enum(['offers', 'today', 'upcoming', 'completed', 'all']);

export const listPartnerJobsQuerySchema = paginationSchema.extend({
  scope: partnerJobScopeSchema.default('all'),
});

export const partnerJobActionSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const partnerJobStatusSchema = z.object({
  status: z.enum(['TRAVELLING', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']),
  note: z.string().trim().max(500).optional(),
  location: geoPointSchema.optional(),
});

export const partnerLocationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export const partnerPhotoUploadSchema = z.object({
  kind: z.enum(['BEFORE', 'AFTER', 'ISSUE']),
  contentBase64: base64UploadSchema,
  contentType: contentMimeTypeSchema,
  fileName: z.string().trim().max(200).optional(),
});

export const partnerIssueSchema = z.object({
  reason: z.enum(['CUSTOMER_UNAVAILABLE', 'VEHICLE_NOT_ACCESSIBLE', 'ADDRESS_NOT_FOUND', 'UNSAFE_CONDITION', 'OTHER']),
  note: z.string().trim().max(500).optional(),
});

export const partnerEarningsQuerySchema = paginationSchema.extend({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export const partnerTrainingUpdateSchema = z.object({
  items: z
    .array(z.object({ key: z.string().trim().min(1).max(60), label: z.string().trim().max(120), completed: z.boolean(), required: z.boolean() }))
    .max(30),
});

export type PartnerRegisterInput = z.infer<typeof partnerRegisterSchema>;
export type PartnerProfileUpdateInput = z.infer<typeof partnerProfileUpdateSchema>;
export type PartnerDocumentUploadInput = z.infer<typeof partnerDocumentUploadSchema>;
export type PartnerDutyStatusInput = z.infer<typeof partnerDutyStatusSchema>;
export type ListPartnerJobsQueryInput = z.infer<typeof listPartnerJobsQuerySchema>;
export type PartnerJobActionInput = z.infer<typeof partnerJobActionSchema>;
export type PartnerJobStatusInput = z.infer<typeof partnerJobStatusSchema>;
export type PartnerLocationInput = z.infer<typeof partnerLocationSchema>;
export type PartnerPhotoUploadInput = z.infer<typeof partnerPhotoUploadSchema>;
export type PartnerIssueInput = z.infer<typeof partnerIssueSchema>;
export type PartnerEarningsQueryInput = z.infer<typeof partnerEarningsQuerySchema>;
export type PartnerTrainingUpdateInput = z.infer<typeof partnerTrainingUpdateSchema>;
