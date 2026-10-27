import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminRole as AdminRoleType, UserRole as UserRoleType } from '@autowra/shared-types';
import type { Request } from 'express';
import type { AuthenticatedUser } from './types';

export const IS_PUBLIC_KEY = 'Autowra:isPublic';
export const ROLES_KEY = 'Autowra:roles';
export const ADMIN_ROLES_KEY = 'Autowra:adminRoles';

/** Marks a route as reachable without a session (sign-in, catalogue browsing, webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: UserRoleType[]) => SetMetadata(ROLES_KEY, roles);

/** Narrow an ADMIN session further, e.g. money actions restricted to SUPER_ADMIN/FINANCE. */
export const AdminRoles = (...roles: AdminRoleType[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error('CurrentUser used on a route that is not guarded by JwtAuthGuard');
    }
    return request.user;
  },
);

export const RequestMeta = createParamDecorator(
  (_data: unknown, context: ExecutionContext): { ipAddress: string | null; userAgent: string | null } => {
    const request = context.switchToHttp().getRequest<Request>();
    const forwarded = request.headers['x-forwarded-for'];
    const ipAddress = Array.isArray(forwarded)
      ? (forwarded[0] ?? null)
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0]!.trim()
        : (request.ip ?? null);
    return { ipAddress, userAgent: request.headers['user-agent'] ?? null };
  },
);
