import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  refreshSessionSchema,
  registerPushTokenSchema,
  requestOtpSchema,
  verifyOtpSchema,
  type RefreshSessionInput,
  type RegisterPushTokenInput,
  type RequestOtpInput,
  type VerifyOtpInput,
} from '@autowra/validation';
import { CurrentUser, Public, RequestMeta } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Request a sign-in code for a mobile number' })
  login(
    @Body(new ZodValidationPipe<RequestOtpInput>(requestOtpSchema)) body: RequestOtpInput,
    @RequestMeta() meta: { ipAddress: string | null; userAgent: string | null },
  ) {
    return this.auth.requestOtp(body, meta);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-otp')
  @ApiOperation({ summary: 'Verify the code and open a session' })
  verifyOtp(
    @Body(new ZodValidationPipe<VerifyOtpInput>(verifyOtpSchema)) body: VerifyOtpInput,
    @RequestMeta() meta: { ipAddress: string | null; userAgent: string | null },
  ) {
    return this.auth.verifyOtp(body, meta);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new session' })
  refresh(
    @Body(new ZodValidationPipe<RefreshSessionInput>(refreshSessionSchema)) body: RefreshSessionInput,
    @RequestMeta() meta: { ipAddress: string | null; userAgent: string | null },
  ) {
    return this.auth.refresh(body, meta);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke the session behind a refresh token' })
  async logout(@Body(new ZodValidationPipe<RefreshSessionInput>(refreshSessionSchema)) body: RefreshSessionInput) {
    await this.auth.logoutByRefreshToken(body.refreshToken);
    return { success: true };
  }

  @ApiBearerAuth()
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.logoutAllDevices(user.id);
    return { success: true };
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.currentUser(user.id);
  }

  @ApiBearerAuth()
  @Post('push-token')
  async registerPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe<RegisterPushTokenInput>(registerPushTokenSchema)) body: RegisterPushTokenInput,
  ) {
    await this.auth.registerPushToken(user.id, body);
    return { success: true };
  }
}
