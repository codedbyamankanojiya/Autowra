import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AdminRole, UserRole } from '@autowra/shared-types';
import type { Request } from 'express';
import { AppError } from '../app-error';
import { IS_PUBLIC_KEY } from '../decorators';
import type { AuthenticatedUser } from '../types';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: UserRole;
  adminRole: AdminRole | null;
  phone: string;
  typ: 'access';
}

/**
 * Verifies the bearer access token and attaches the identity to the request.
 *
 * The signature and expiry are checked here; the session row is additionally validated by
 * `AuthService.assertSessionActive` on refresh so a revoked device cannot keep working.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw AppError.unauthenticated('Sign in to continue.');
    }

    const token = header.slice(7).trim();
    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw AppError.unauthenticated();
    }

    if (payload.typ !== 'access') throw AppError.unauthenticated();

    request.user = {
      id: payload.sub,
      role: payload.role,
      adminRole: payload.adminRole ?? null,
      sessionId: payload.sid,
      phone: payload.phone,
    };
    return true;
  }
}
