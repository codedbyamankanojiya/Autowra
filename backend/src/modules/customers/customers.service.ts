import { Injectable } from '@nestjs/common';
import type { CustomerProfile as PrismaCustomerProfile, User } from '@prisma/client';
import type { CustomerProfile } from '@autowra/shared-types';
import type { DeleteAccountInput, UpdateProfileInput } from '@autowra/validation';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Creates the profile row on first read so older accounts are never missing one. */
  async getProfile(userId: string): Promise<CustomerProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { customerProfile: true },
    });
    if (!user) throw AppError.notFound('Account not found.');

    const profile =
      user.customerProfile ??
      (await this.prisma.customerProfile.create({ data: { userId } }));

    return toProfileDto(profile, user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<CustomerProfile> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email ? input.email.toLowerCase() : null } : {}),
      },
    });

    const profile = await this.prisma.customerProfile.upsert({
      where: { userId },
      create: {
        userId,
        pushOptIn: input.pushOptIn ?? true,
        emailOptIn: input.emailOptIn ?? true,
        smsOptIn: input.smsOptIn ?? true,
      },
      update: {
        ...(input.pushOptIn !== undefined ? { pushOptIn: input.pushOptIn } : {}),
        ...(input.emailOptIn !== undefined ? { emailOptIn: input.emailOptIn } : {}),
        ...(input.smsOptIn !== undefined ? { smsOptIn: input.smsOptIn } : {}),
      },
    });

    return toProfileDto(profile, user);
  }

  async requestDeletion(
    userId: string,
    input: DeleteAccountInput,
    meta: RequestMeta = {},
  ): Promise<{ success: boolean; message: string }> {
    const openBookings = await this.prisma.booking.count({
      where: {
        customerId: userId,
        status: {
          in: ['PENDING_PAYMENT', 'CONFIRMED', 'ASSIGNED', 'PARTNER_ACCEPTED', 'TRAVELLING', 'ARRIVED', 'IN_PROGRESS'],
        },
      },
    });
    if (openBookings > 0) {
      throw AppError.conflict(
        'CONFLICT',
        'You have active bookings. Complete or cancel them before requesting account deletion.',
      );
    }

    await this.prisma.customerProfile.upsert({
      where: { userId },
      create: { userId, deletionRequestedAt: new Date() },
      update: { deletionRequestedAt: new Date() },
    });

    await this.audit.record({
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      action: 'UPDATE',
      entity: 'CustomerProfile',
      entityId: userId,
      summary: 'Customer requested account deletion',
      metadata: { reason: input.reason ?? null },
      ipAddress: meta.ipAddress ?? null,
    });

    return {
      success: true,
      message: 'Your deletion request has been recorded. Our team will process it within 7 working days.',
    };
  }
}

export function toProfileDto(
  profile: PrismaCustomerProfile,
  user: Pick<User, 'phone' | 'name' | 'email'>,
): CustomerProfile {
  return {
    id: profile.id,
    userId: profile.userId,
    phone: user.phone,
    name: user.name,
    email: user.email,
    defaultAddressId: profile.defaultAddressId,
    walletBalanceMinor: profile.walletBalanceMinor,
    lifetimeBookings: profile.lifetimeBookings,
    lifetimeSpendMinor: profile.lifetimeSpendMinor,
    pushOptIn: profile.pushOptIn,
    emailOptIn: profile.emailOptIn,
    smsOptIn: profile.smsOptIn,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
