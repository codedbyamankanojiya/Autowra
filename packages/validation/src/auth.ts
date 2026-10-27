import { z } from 'zod';

import {
  emailSchema,
  idempotencyKeySchema,
  otpCodeSchema,
  passwordSchema,
  phoneSchema,
  userRoleSchema,
} from './common';

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  role: userRoleSchema.optional(),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
  role: userRoleSchema.optional(),
  deviceId: z.string().trim().max(120).optional(),
  pushToken: z.string().trim().max(400).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().trim().min(10).max(4000),
});

export const registerPushTokenSchema = z.object({
  token: z.string().trim().min(8).max(400),
  platform: z.enum(['ios', 'android', 'web']),
  deviceId: z.string().trim().max(120).optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80).optional(),
  email: emailSchema.nullable().optional(),
  pushOptIn: z.boolean().optional(),
  emailOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
});

export const deleteAccountSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  confirm: z.literal(true, { message: 'Account deletion must be confirmed' }),
});

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const adminChangePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});

export const idempotentActionSchema = z.object({
  idempotencyKey: idempotencyKeySchema.optional(),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type RefreshSessionInput = z.infer<typeof refreshSessionSchema>;
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminChangePasswordInput = z.infer<typeof adminChangePasswordSchema>;
