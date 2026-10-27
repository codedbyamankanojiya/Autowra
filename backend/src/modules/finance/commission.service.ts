import { Injectable } from '@nestjs/common';
import { CommissionScope } from '@autowra/shared-types';
import { AppConfigService } from '../../config/configuration';
import type { Db } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

export interface CommissionContext {
  readonly serviceId?: string | null;
  readonly serviceAreaId?: string | null;
  readonly partnerId?: string | null;
}

export interface CommissionResolution {
  /** `null` when no configured rule applies and the platform default was used. */
  readonly ruleId: string | null;
  readonly scope: CommissionScope;
  readonly percent: number;
  readonly flatMinor: number;
}

/** A more specific rule always beats a broader one, whatever the priorities say. */
const SCOPE_WEIGHT: Record<CommissionScope, number> = {
  PARTNER: 4,
  SERVICE: 3,
  AREA: 2,
  GLOBAL: 1,
};

function scopeWeight(scope: CommissionScope): number {
  return SCOPE_WEIGHT[scope] ?? 0;
}

/**
 * Resolves the platform commission for a job.
 *
 * Rules are stored in `CommissionRule` so operations can target a partner, a service, a
 * service area or everything, with an optional validity window. Money decisions are always
 * made here on the server: the partner app only ever displays the resolved numbers.
 */
@Injectable()
export class CommissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async resolve(context: CommissionContext, db: Db = this.prisma): Promise<CommissionResolution> {
    const now = new Date();
    const rules = await db.commissionRule.findMany({
      where: {
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
    });

    const matches = rules.filter((rule) => ruleMatches(rule, context));
    matches.sort((a, b) => {
      const specificity =
        scopeWeight(b.scope as CommissionScope) - scopeWeight(a.scope as CommissionScope);
      if (specificity !== 0) return specificity;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const best = matches[0];
    if (best) {
      return {
        ruleId: best.id,
        scope: best.scope as CommissionScope,
        percent: best.percent,
        flatMinor: best.flatMinor,
      };
    }

    return {
      ruleId: null,
      scope: CommissionScope.GLOBAL,
      percent: this.config.business.platformCommissionPercent,
      flatMinor: 0,
    };
  }

  async percentFor(context: CommissionContext, db: Db = this.prisma): Promise<number> {
    return (await this.resolve(context, db)).percent;
  }
}

function ruleMatches(
  rule: { scope: string; serviceId: string | null; serviceAreaId: string | null; partnerId: string | null },
  context: CommissionContext,
): boolean {
  switch (rule.scope) {
    case 'PARTNER':
      return Boolean(context.partnerId) && rule.partnerId === context.partnerId;
    case 'SERVICE':
      return Boolean(context.serviceId) && rule.serviceId === context.serviceId;
    case 'AREA':
      return Boolean(context.serviceAreaId) && rule.serviceAreaId === context.serviceAreaId;
    case 'GLOBAL':
      return true;
    default:
      return false;
  }
}
