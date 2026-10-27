import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

/** Shape produced by `configuration()` and loaded into `ConfigService`. */
export interface AppConfiguration {
  app: {
    env: Env['NODE_ENV'];
    port: number;
    publicUrl: string;
    isProduction: boolean;
    isDevelopment: boolean;
    corsAllowedOrigins: string[];
  };
  database: { url: string };
  auth: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    devAuthEnabled: boolean;
    devOtp: string;
  };
  otp: {
    ttlSeconds: number;
    maxAttempts: number;
    requestCooldownSeconds: number;
  };
  security: { dataEncryptionKey: string };
  storage: {
    driver: Env['STORAGE_DRIVER'];
    localDir: string;
    s3: {
      endpoint?: string;
      region?: string;
      bucket?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle: boolean;
    };
  };
  payments: {
    provider: Env['PAYMENT_PROVIDER'];
    razorpay: { keyId?: string; keySecret?: string; webhookSecret?: string };
  };
  sms: { provider: Env['SMS_PROVIDER']; apiKey?: string; senderId: string; templateId?: string };
  email: {
    provider: Env['EMAIL_PROVIDER'];
    host?: string;
    port: number;
    user?: string;
    password?: string;
    from: string;
  };
  push: { provider: Env['PUSH_PROVIDER']; accessToken?: string };
  maps: { googleApiKey?: string };
  business: {
    currency: string;
    defaultTaxPercent: number;
    platformCommissionPercent: number;
  };
}

export function configuration(): AppConfiguration {
  // `validateEnv` already normalised and type-checked `process.env`; reparse the few values
  // that ConfigService would otherwise hand back as strings.
  const env = process.env as unknown as Record<string, string | undefined>;
  const nodeEnv = (env.NODE_ENV ?? 'development') as Env['NODE_ENV'];

  return {
    app: {
      env: nodeEnv,
      port: Number(env.BACKEND_PORT ?? 4000),
      publicUrl: env.API_PUBLIC_URL ?? 'http://localhost:4000',
      isProduction: nodeEnv === 'production',
      isDevelopment: nodeEnv === 'development',
      corsAllowedOrigins: (env.CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    },
    database: { url: env.DATABASE_URL ?? '' },
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET ?? '',
      refreshSecret: env.JWT_REFRESH_SECRET ?? '',
      accessTtlSeconds: Number(env.JWT_ACCESS_TTL ?? 900),
      refreshTtlSeconds: Number(env.JWT_REFRESH_TTL ?? 2_592_000),
      devAuthEnabled: env.DEV_AUTH_ENABLED !== 'false' && nodeEnv !== 'production',
      devOtp: env.DEV_AUTH_OTP ?? '123456',
    },
    otp: {
      ttlSeconds: Number(env.OTP_TTL_SECONDS ?? 300),
      maxAttempts: Number(env.OTP_MAX_ATTEMPTS ?? 5),
      requestCooldownSeconds: Number(env.OTP_REQUEST_COOLDOWN_SECONDS ?? 30),
    },
    security: { dataEncryptionKey: env.DATA_ENCRYPTION_KEY ?? 'dev-only-data-key-change-me' },
    storage: {
      driver: (env.STORAGE_DRIVER ?? 'local') as Env['STORAGE_DRIVER'],
      localDir: env.STORAGE_LOCAL_DIR ?? './storage',
      s3: {
        endpoint: emptyToUndefined(env.S3_ENDPOINT),
        region: emptyToUndefined(env.S3_REGION),
        bucket: emptyToUndefined(env.S3_BUCKET),
        accessKeyId: emptyToUndefined(env.S3_ACCESS_KEY_ID),
        secretAccessKey: emptyToUndefined(env.S3_SECRET_ACCESS_KEY),
        forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      },
    },
    payments: {
      provider: (env.PAYMENT_PROVIDER ?? 'mock') as Env['PAYMENT_PROVIDER'],
      razorpay: {
        keyId: emptyToUndefined(env.RAZORPAY_KEY_ID),
        keySecret: emptyToUndefined(env.RAZORPAY_KEY_SECRET),
        webhookSecret: emptyToUndefined(env.RAZORPAY_WEBHOOK_SECRET),
      },
    },
    sms: {
      provider: (env.SMS_PROVIDER ?? 'console') as Env['SMS_PROVIDER'],
      apiKey: emptyToUndefined(env.SMS_API_KEY),
      senderId: env.SMS_SENDER_ID ?? 'AUTOGLW',
      templateId: emptyToUndefined(env.SMS_TEMPLATE_ID),
    },
    email: {
      provider: (env.EMAIL_PROVIDER ?? 'console') as Env['EMAIL_PROVIDER'],
      host: emptyToUndefined(env.SMTP_HOST),
      port: Number(env.SMTP_PORT ?? 587),
      user: emptyToUndefined(env.SMTP_USER),
      password: emptyToUndefined(env.SMTP_PASSWORD),
      from: env.EMAIL_FROM ?? 'no-reply@Autowra.example',
    },
    push: {
      provider: (env.PUSH_PROVIDER ?? 'expo') as Env['PUSH_PROVIDER'],
      accessToken: emptyToUndefined(env.EXPO_ACCESS_TOKEN),
    },
    maps: { googleApiKey: emptyToUndefined(env.GOOGLE_MAPS_API_KEY) },
    business: {
      currency: env.DEFAULT_CURRENCY ?? 'INR',
      defaultTaxPercent: Number(env.DEFAULT_TAX_PERCENT ?? 18),
      platformCommissionPercent: Number(env.PLATFORM_COMMISSION_PERCENT ?? 20),
    },
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Thin typed wrapper over `ConfigService` so the rest of the codebase never deals with
 * stringly-typed lookups.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}

  get<K extends keyof AppConfiguration>(key: K): AppConfiguration[K] {
    return this.config.get(key, { infer: true });
  }

  get app() {
    return this.get('app');
  }
  get database() {
    return this.get('database');
  }
  get auth() {
    return this.get('auth');
  }
  get otp() {
    return this.get('otp');
  }
  get security() {
    return this.get('security');
  }
  get storage() {
    return this.get('storage');
  }
  get payments() {
    return this.get('payments');
  }
  get sms() {
    return this.get('sms');
  }
  get email() {
    return this.get('email');
  }
  get push() {
    return this.get('push');
  }
  get maps() {
    return this.get('maps');
  }
  get business() {
    return this.get('business');
  }
}
