import { z } from 'zod';

/**
 * Environment contract for the Autowra backend.
 *
 * Every optional integration has a development default so the project runs out of the box,
 * but production is held to a stricter standard (see `superRefine` at the bottom).
 */

const boolish = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      const normalised = value.trim().toLowerCase();
      return normalised === 'true' || normalised === '1' || normalised === 'yes';
    });

const int = (defaultValue: number) => z.coerce.number().int().default(defaultValue);

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    BACKEND_PORT: int(4000),
    API_PUBLIC_URL: z.string().default('http://localhost:4000'),
    /** Comma-separated browser origins allowed to call the API (dashboard, docs). */
    CORS_ALLOWED_ORIGINS: optionalString,

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me'),
    JWT_REFRESH_SECRET: z.string().min(16).default('dev-only-refresh-secret-change-me'),
    JWT_ACCESS_TTL: int(900),
    JWT_REFRESH_TTL: int(2_592_000),

    /** Encrypts values that must be recoverable server side, e.g. partner payout accounts. */
    DATA_ENCRYPTION_KEY: z.string().min(16).default('dev-only-data-key-change-me'),

    OTP_TTL_SECONDS: int(300),
    OTP_MAX_ATTEMPTS: int(5),
    OTP_REQUEST_COOLDOWN_SECONDS: int(30),

    DEV_AUTH_ENABLED: boolish(true),
    DEV_AUTH_OTP: z.string().default('123456'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    S3_ENDPOINT: optionalString,
    S3_REGION: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: boolish(true),

    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
    RAZORPAY_KEY_ID: optionalString,
    RAZORPAY_KEY_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET: optionalString,

    SMS_PROVIDER: z.enum(['console', 'http']).default('console'),
    SMS_API_KEY: optionalString,
    SMS_SENDER_ID: z.string().default('AUTOGLW'),
    SMS_TEMPLATE_ID: optionalString,

    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    SMTP_HOST: optionalString,
    SMTP_PORT: int(587),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    EMAIL_FROM: z.string().default('no-reply@Autowra.example'),

    PUSH_PROVIDER: z.enum(['expo', 'console']).default('expo'),
    EXPO_ACCESS_TOKEN: optionalString,

    GOOGLE_MAPS_API_KEY: optionalString,

    DEFAULT_CURRENCY: z.string().default('INR'),
    DEFAULT_TAX_PERCENT: z.coerce.number().min(0).max(100).default(18),
    PLATFORM_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(20),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.DEV_AUTH_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_AUTH_ENABLED'],
        message: 'DEV_AUTH_ENABLED must be false in production',
      });
    }
    if (env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'The mock payment provider cannot be used in production',
      });
    }
    if (env.JWT_ACCESS_SECRET.startsWith('dev-only') || env.JWT_REFRESH_SECRET.startsWith('dev-only')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT secrets must be generated for production (openssl rand -hex 32)',
      });
    }
    if (env.DATA_ENCRYPTION_KEY.startsWith('dev-only')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY'],
        message: 'DATA_ENCRYPTION_KEY must be generated for production (openssl rand -hex 32)',
      });
    }
    if (env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'Local disk storage is development-only; configure S3 credentials for production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Used by `ConfigModule.forRoot({ validate })`. Throws a readable error on a bad environment. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}
