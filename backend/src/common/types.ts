import type { Prisma, PrismaClient } from '@prisma/client';
import type { AdminRole, UserRole } from '@autowra/shared-types';

/** Identity attached to the request by `JwtAuthGuard`. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly role: UserRole;
  readonly adminRole: AdminRole | null;
  readonly sessionId: string;
  readonly phone: string;
}

/**
 * A Prisma client, either the pooled one or a transaction handle.
 *
 * Money paths read and write through a single `Db` so that pricing, coupon and slot
 * decisions are all made inside the same transaction that persists the booking.
 */
export type Db = PrismaClient | Prisma.TransactionClient;
