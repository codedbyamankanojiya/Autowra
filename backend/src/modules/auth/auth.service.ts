import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AdminRole,
  AuthSession,
  AuthUser,
  PartnerStatus,
  RequestOtpResponse,
  UserRole,
} from '@autowra/shared-types';
import { ApiErrorCode } from '@autowra/shared-types';
import type {
  AdminLoginInput,
  DeleteAccountInput,
  RefreshSessionInput,
  RegisterPushTokenInput,
  RequestOtpInput,
  UpdateProfileInput,
  VerifyOtpInput,
} from '@autowra/validation';
import * as bcrypt from 'bcryptjs';
import { AppError } from '../../common/app-error';
import { generateOtpCode, normalisePhone, randomToken } from '../../common/identifiers';
import { AppConfigService } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SmsService } from '../messaging/sms.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';

export interface RequestMeta {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

interface RefreshTokenPayload {
  sub: string;
  sid: string;
  typ: 'refresh';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* OTP                                                                 */
  /* ------------------------------------------------------------------ */

  async requestOtp(input: RequestOtpInput, meta: RequestMeta = {}): Promise<RequestOtpResponse> {
    const phone = normalisePhone(input.phone);
    const role: UserRole = input.role ?? 'CUSTOMER';
    const { ttlSeconds, requestCooldownSeconds } = this.config.otp;

    const recent = await this.prisma.otpRequest.findFirst({
      where: { phone, createdAt: { gt: new Date(Date.now() - requestCooldownSeconds * 1000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      const waitSeconds = Math.max(
        1,
        requestCooldownSeconds - Math.floor((Date.now() - recent.createdAt.getTime()) / 1000),
      );
      throw new AppError(
        ApiErrorCode.RATE_LIMITED,
        `Please wait ${waitSeconds}s before requesting another code.`,
        429,
      );
    }

    // In development the OTP is the fixed configured value so testers can sign in reliably.
    const code = this.config.auth.devAuthEnabled ? this.config.auth.devOtp : generateOtpCode(6);

    await this.prisma.otpRequest.create({
      data: {
        phone,
        role: role as never,
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        ipAddress: meta.ipAddress ?? null,
      },
    });

    const delivery = this.config.auth.devAuthEnabled
      ? { delivered: false, channel: 'console' as const, message: 'Development mode: the code is shown below.' }
      : await this.sms.sendOtp(phone, code);

    return {
      requestId: randomToken(12),
      phone,
      expiresInSeconds: ttlSeconds,
      deliveryChannel: delivery.channel,
      devCode: this.config.auth.devAuthEnabled ? code : null,
      message: delivery.message,
    };
  }

  async verifyOtp(input: VerifyOtpInput, meta: RequestMeta = {}): Promise<AuthSession> {
    const phone = normalisePhone(input.phone);
    const role: UserRole = input.role ?? 'CUSTOMER';

    const otp = await this.prisma.otpRequest.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw AppError.badRequest(ApiErrorCode.OTP_EXPIRED, 'That code has expired. Request a new one.');
    }
    if (otp.attempts >= this.config.otp.maxAttempts) {
      throw AppError.badRequest(ApiErrorCode.OTP_TOO_MANY_ATTEMPTS, 'Too many incorrect attempts. Request a new code.');
    }

    const matchesDevCode = this.config.auth.devAuthEnabled && input.code === this.config.auth.devOtp;
    if (!matchesDevCode && hashOtp(input.code) !== otp.codeHash) {
      await this.prisma.otpRequest.update({ where: { id: otp.id }, data: { attempts: otp.attempts + 1 } });
      const remaining = Math.max(0, this.config.otp.maxAttempts - (otp.attempts + 1));
      throw AppError.badRequest(
        ApiErrorCode.OTP_INVALID,
        remaining > 0 ? `That code is not correct. ${remaining} attempt(s) left.` : 'That code is not correct.',
      );
    }

    await this.prisma.otpRequest.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const user = await this.findOrCreateUser(phone, role);
    const session = await this.createSession(user.id, {
      deviceId: input.deviceId ?? null,
      platform: input.platform ?? null,
      ipAddress: meta.ipAddress ?? null,
    });

    if (input.pushToken) {
      await this.notifications.registerPushToken(user.id, {
        token: input.pushToken,
        platform: input.platform ?? 'android',
        deviceId: input.deviceId ?? null,
      });
    }

    await this.audit.record({
      actorUserId: user.id,
      actorRole: role,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      summary: `${role.toLowerCase()} signed in with an OTP`,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.buildSession(user.id, session.sessionId, session.refreshToken);
  }

  /* ------------------------------------------------------------------ */
  /* Admin password sign-in                                              */
  /* ------------------------------------------------------------------ */

  async adminLogin(input: AdminLoginInput, meta: RequestMeta = {}): Promise<AuthSession> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email.toLowerCase() }, { phone: normalisePhone(input.email) }] },
    });
    const genericFailure = AppError.badRequest(ApiErrorCode.UNAUTHENTICATED, 'Incorrect email or password.');

    if (!user || user.role !== 'ADMIN' || !user.passwordHash) throw genericFailure;
    if (!user.isActive) throw new AppError(ApiErrorCode.ACCOUNT_SUSPENDED, 'This account has been disabled.', 403);

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) throw genericFailure;

    const session = await this.createSession(user.id, {
      deviceId: 'admin-web',
      platform: 'web',
      ipAddress: meta.ipAddress ?? null,
    });

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: 'ADMIN',
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      summary: 'Administrator signed in',
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return this.buildSession(user.id, session.sessionId, session.refreshToken);
  }

  async adminChangePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ changed: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw AppError.notFound('Account not found.');
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw AppError.badRequest(ApiErrorCode.VALIDATION_FAILED, 'Your current password is not correct.');

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    await this.audit.record({
      actorUserId: userId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entity: 'User',
      entityId: userId,
      summary: 'Administrator changed their password',
    });
    return { changed: true };
  }

  /* ------------------------------------------------------------------ */
  /* Sessions                                                            */
  /* ------------------------------------------------------------------ */

  async refresh(input: RefreshSessionInput, meta: RequestMeta = {}): Promise<AuthSession> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwt.verify<RefreshTokenPayload>(input.refreshToken, {
        secret: this.config.auth.refreshSecret,
      });
    } catch {
      throw AppError.unauthenticated('Your session has expired. Please sign in again.');
    }
    if (payload.typ !== 'refresh') throw AppError.unauthenticated();

    const session = await this.prisma.authSession.findUnique({ where: { tokenHash: hashToken(input.refreshToken) } });
    if (!session || session.id !== payload.sid || session.revokedAt || session.expiresAt < new Date()) {
      throw AppError.unauthenticated('Your session has expired. Please sign in again.');
    }

    // Rotate: the presented refresh token can never be replayed.
    const nextRefreshToken = await this.rotateSession(session.id, payload.sub, {
      deviceId: session.deviceId,
      platform: session.platform,
      ipAddress: meta.ipAddress ?? session.ipAddress,
    });

    return this.buildSession(payload.sub, session.id, nextRefreshToken);
  }

  async logout(userId: string, sessionId: string): Promise<{ loggedOut: boolean }> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'LOGOUT',
      entity: 'AuthSession',
      entityId: sessionId,
      summary: 'Signed out',
    });
    return { loggedOut: true };
  }

  /**
   * Sign-out from the client only carries the refresh token, so the session is located by
   * its hash. An unknown or already revoked token is treated as success - the client's goal
   * (no usable session) is met either way.
   */
  async logoutByRefreshToken(refreshToken: string): Promise<{ loggedOut: boolean }> {
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (!session) return { loggedOut: true };

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: session.revokedAt ?? new Date() },
    });
    await this.audit.record({
      actorUserId: session.userId,
      action: 'LOGOUT',
      entity: 'AuthSession',
      entityId: session.id,
      summary: 'Signed out',
    });
    return { loggedOut: true };
  }

  async logoutAllDevices(userId: string): Promise<{ revoked: number }> {
    const result = await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count };
  }

  async assertSessionActive(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) throw AppError.unauthenticated('Your session has expired. Please sign in again.');
  }

  /* ------------------------------------------------------------------ */
  /* Profile                                                             */
  /* ------------------------------------------------------------------ */

  async currentUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { partnerProfile: { select: { status: true } } },
    });
    if (!user) throw AppError.unauthenticated();
    return toAuthUser(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<AuthUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email ? input.email.toLowerCase() : null } : {}),
      },
      include: { partnerProfile: { select: { status: true } } },
    });

    if (
      input.pushOptIn !== undefined ||
      input.emailOptIn !== undefined ||
      input.smsOptIn !== undefined
    ) {
      await this.prisma.customerProfile.upsert({
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
    }

    return toAuthUser(user);
  }

  /**
   * Records a deletion request. Data is anonymised by an administrator after any open
   * bookings settle - we never hard-delete financial records on the customer's request.
   */
  async requestAccountDeletion(userId: string, input: DeleteAccountInput): Promise<{ requested: boolean; message: string }> {
    const openBookings = await this.prisma.booking.count({
      where: {
        customerId: userId,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'ASSIGNED', 'PARTNER_ACCEPTED', 'TRAVELLING', 'ARRIVED', 'IN_PROGRESS'] },
      },
    });
    if (openBookings > 0) {
      throw AppError.conflict(
        ApiErrorCode.CONFLICT,
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
    });

    return {
      requested: true,
      message: 'Your deletion request has been recorded and our team will process it within 7 working days.',
    };
  }

  async registerPushToken(
    userId: string,
    input: RegisterPushTokenInput,
  ): Promise<{ registered: boolean }> {
    return this.notifications.registerPushToken(userId, {
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  private async findOrCreateUser(phone: string, role: UserRole) {
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      if (!existing.isActive) {
        throw new AppError(ApiErrorCode.ACCOUNT_SUSPENDED, 'This account has been suspended. Contact support.', 403);
      }
      if (existing.deletedAt) {
        throw new AppError(ApiErrorCode.ACCOUNT_SUSPENDED, 'This account is no longer available.', 403);
      }
      return existing;
    }

    const created = await this.prisma.user.create({
      data: {
        phone,
        role: role as never,
        ...(role === 'CUSTOMER' ? { customerProfile: { create: {} } } : {}),
        ...(role === 'PARTNER' ? { partnerProfile: { create: { fullName: 'New partner', skills: [] } } } : {}),
      },
    });
    return created;
  }

  private async createSession(
    userId: string,
    meta: { deviceId: string | null; platform: string | null; ipAddress: string | null },
  ): Promise<{ sessionId: string; refreshToken: string }> {
    // The refresh token is generated before the row exists so only its hash is stored.
    const sessionId = randomUUID();
    const refreshToken = this.signRefreshToken(userId, sessionId);

    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: hashToken(refreshToken),
        deviceId: meta.deviceId,
        platform: meta.platform,
        ipAddress: meta.ipAddress,
        expiresAt: new Date(Date.now() + this.config.auth.refreshTtlSeconds * 1000),
      },
    });

    return { sessionId, refreshToken };
  }

  private async rotateSession(
    sessionId: string,
    userId: string,
    meta: { deviceId: string | null; platform: string | null; ipAddress: string | null },
  ): Promise<string> {
    const refreshToken = this.signRefreshToken(userId, sessionId);
    await this.prisma.authSession.update({
      where: { id: sessionId },
      data: {
        tokenHash: hashToken(refreshToken),
        deviceId: meta.deviceId,
        platform: meta.platform,
        ipAddress: meta.ipAddress,
        expiresAt: new Date(Date.now() + this.config.auth.refreshTtlSeconds * 1000),
      },
    });
    return refreshToken;
  }

  private signRefreshToken(userId: string, sessionId: string): string {
    const payload: RefreshTokenPayload = { sub: userId, sid: sessionId, typ: 'refresh' };
    return this.jwt.sign(payload, {
      secret: this.config.auth.refreshSecret,
      expiresIn: this.config.auth.refreshTtlSeconds,
    });
  }

  private async buildSession(userId: string, sessionId: string, refreshToken: string): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { partnerProfile: { select: { status: true } } },
    });
    if (!user) throw AppError.unauthenticated();

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      sid: sessionId,
      role: user.role as UserRole,
      adminRole: (user.adminRole as AdminRole | null) ?? null,
      phone: user.phone,
      typ: 'access',
    };

    return {
      accessToken: this.jwt.sign(accessPayload, {
        secret: this.config.auth.accessSecret,
        expiresIn: this.config.auth.accessTtlSeconds,
      }),
      refreshToken,
      expiresIn: this.config.auth.accessTtlSeconds,
      user: toAuthUser(user),
    };
  }
}

function hashOtp(code: string): string {
  return createHash('sha256').update(`otp:${code}`).digest('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toAuthUser(user: {
  id: string;
  role: string;
  phone: string;
  name: string | null;
  email: string | null;
  adminRole: string | null;
  createdAt: Date;
  partnerProfile?: { status: string } | null;
}): AuthUser {
  return {
    id: user.id,
    role: user.role as UserRole,
    phone: user.phone,
    name: user.name,
    email: user.email,
    adminRole: (user.adminRole as AdminRole | null) ?? null,
    partnerStatus: (user.partnerProfile?.status as PartnerStatus | undefined) ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
