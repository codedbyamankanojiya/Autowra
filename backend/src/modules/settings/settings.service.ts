import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { BusinessSettings } from '@autowra/shared-types';
import { AppConfigService } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';

const SETTINGS_KEY = 'business';

/**
 * Business settings live in the `BusinessSetting` key/value table so operations can change
 * pricing policy without a deploy. Values fall back to environment configuration, and every
 * money value is an integer in minor units.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async get(): Promise<BusinessSettings> {
    const row = await this.prisma.businessSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const stored = (row?.value ?? {}) as Partial<BusinessSettings>;
    return { ...this.defaults(), ...stored, currency: this.config.business.currency };
  }

  async update(patch: Partial<BusinessSettings>, actorUserId: string): Promise<BusinessSettings> {
    const current = await this.get();
    const next: BusinessSettings = { ...current, ...stripUndefined(patch) };
    // `BusinessSettings` has no index signature, so Prisma's JSON input type needs a cast.
    const value = next as unknown as Prisma.InputJsonValue;
    await this.prisma.businessSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value, updatedByUserId: actorUserId },
      update: { value, updatedByUserId: actorUserId },
    });
    return next;
  }

  defaults(): BusinessSettings {
    const business = this.config.business;
    return {
      currency: business.currency,
      taxPercent: business.defaultTaxPercent,
      platformCommissionPercent: business.platformCommissionPercent,
      platformFeeMinor: 0,
      visitFeeMinor: 0,
      cancellationWindowHours: 4,
      cancellationFeePercent: 0,
      rescheduleWindowHours: 2,
      maxReschedulesPerBooking: 2,
      assignmentOfferTtlSeconds: 120,
      maxConcurrentPartnerJobs: 2,
      supportPhone: '+91 1800 000 000',
      supportEmail: 'support@Autowra.example',
    };
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as Partial<T>;
}
