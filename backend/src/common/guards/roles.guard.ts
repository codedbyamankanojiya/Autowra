import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiErrorCode, type AdminRole, type UserRole } from '@autowra/shared-types';
import type { Request } from 'express';
import { AppError } from '../app-error';
import { ADMIN_ROLES_KEY, IS_PUBLIC_KEY, ROLES_KEY } from '../decorators';
import type { AuthenticatedUser } from '../types';

/**
 * Enforces the `@Roles()` / `@AdminRoles()` metadata for the current session.
 *
 * Authentication itself happens in `JwtAuthGuard`; this guard answers "may this identity
 * use this route". Object-level authorisation (does this booking belong to this customer)
 * is enforced in the services, never by the guard alone.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw AppError.unauthenticated();

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
      throw AppError.forbidden('This area is not available for your account type.');
    }

    const requiredAdminRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredAdminRoles && requiredAdminRoles.length > 0) {
      if (user.role !== 'ADMIN' || !user.adminRole || !requiredAdminRoles.includes(user.adminRole)) {
        throw new AppError(
          ApiErrorCode.FORBIDDEN,
          'Your role does not allow this action. Ask an administrator for access.',
          403,
        );
      }
    }

    return true;
  }
}
