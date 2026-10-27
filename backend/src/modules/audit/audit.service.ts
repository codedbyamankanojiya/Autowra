import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditAction, UserRole } from '@autowra/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditInput {
  readonly actorUserId?: string | null;
  readonly actorRole?: UserRole | string | null;
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId?: string | null;
  readonly summary: string;
  readonly metadata?: Record<string, unknown> | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

/**
 * Append-only audit trail. Writes never throw into the caller's request: an audit failure
 * must not roll back a completed business operation, so errors are logged instead.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          actorUserId: input.actorUserId ?? null,
          actorRole: input.actorRole ? String(input.actorRole) : null,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId ?? null,
          summary: input.summary,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for ${input.entity}:${input.entityId ?? '-'}`, error as Error);
    }
  }
}
