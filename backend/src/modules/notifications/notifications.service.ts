import { Injectable, Logger } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import {
  NotificationChannel,
  NotificationType,
  type AppNotification,
  type Paginated,
} from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import { paginate, resolvePagination, type ResolvedPagination } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../messaging/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface NotifyInput {
  readonly userId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, string>;
  /** Skip the OS push when the user opted out but still record it in-app. */
  readonly sendPush?: boolean;
}

/**
 * Notification fan-out.
 *
 * Every notification is written to the database first (in-app fallback), then pushed if the
 * customer has not opted out and holds at least one registered device. Nothing sensitive is
 * placed in the push payload - only identifiers the app can use to fetch more detail.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async notify(input: NotifyInput): Promise<AppNotification> {
    const record = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        channel: NotificationChannel.IN_APP,
        title: input.title,
        body: input.body,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const dto = toAppNotification(record);
    // In-app live update regardless of push outcome.
    this.realtime.emitToUser(input.userId, 'notification', dto);

    if (input.sendPush !== false) {
      void this.deliverPush(input, record.id);
    }

    return dto;
  }

  /** Fan-out used by admin broadcasts; identical payload, many recipients. */
  async notifyMany(userIds: string[], input: Omit<NotifyInput, 'userId'>): Promise<number> {
    let sent = 0;
    for (const userId of userIds) {
      await this.notify({ ...input, userId });
      sent += 1;
    }
    return sent;
  }

  private async deliverPush(input: NotifyInput, notificationId: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: {
          role: true,
          pushTokens: { where: { isActive: true }, select: { token: true } },
          customerProfile: { select: { pushOptIn: true } },
        },
      });
      if (!user) return;
      if (user.customerProfile && !user.customerProfile.pushOptIn) return;

      const tokens = user.pushTokens.map((entry) => entry.token);
      if (tokens.length === 0) return;

      const result = await this.push.send(tokens, {
        title: input.title,
        body: input.body,
        data: input.data,
      });

      if (result.invalidTokens.length > 0) {
        await this.prisma.pushToken.updateMany({
          where: { token: { in: result.invalidTokens } },
          data: { isActive: false },
        });
      }

      await this.prisma.notification.update({
        where: { id: notificationId },
        data:
          result.delivered > 0
            ? { sentAt: new Date(), channel: NotificationChannel.PUSH }
            : { pushError: 'No device accepted the push notification.' },
      });
    } catch (error) {
      this.logger.error(`Push delivery failed for notification ${notificationId}`, error as Error);
      await this.prisma.notification
        .update({ where: { id: notificationId }, data: { pushError: 'Push delivery failed.' } })
        .catch(() => undefined);
    }
  }

  async listForUser(
    userId: string,
    query: { page?: number; pageSize?: number; unreadOnly?: boolean },
  ): Promise<Paginated<AppNotification>> {
    const paging = resolvePagination(query);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: paging.skip, take: paging.take }),
      this.prisma.notification.count({ where }),
    ]);
    return paginate(items.map(toAppNotification), total, paging);
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, notificationId: string): Promise<AppNotification> {
    const existing = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!existing) throw AppError.notFound('That notification was not found.');
    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: existing.readAt ?? new Date() },
    });
    return toAppNotification(updated);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async registerPushToken(
    userId: string,
    input: { token: string; platform: string; deviceId?: string | null },
  ): Promise<{ registered: boolean }> {
    // A device can change hands between accounts: rebind the token to the current user.
    await this.prisma.pushToken.upsert({
      where: { token: input.token },
      create: {
        userId,
        token: input.token,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
      },
      update: {
        userId,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        isActive: true,
        lastSeenAt: new Date(),
      },
    });
    return { registered: true };
  }

  async unregisterPushToken(userId: string, token: string): Promise<{ removed: boolean }> {
    const result = await this.prisma.pushToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });
    return { removed: result.count > 0 };
  }
}

export function toAppNotification(record: Notification): AppNotification {
  return {
    id: record.id,
    type: record.type as AppNotification['type'],
    channel: record.channel as AppNotification['channel'],
    title: record.title,
    body: record.body,
    data: (record.data as Record<string, string> | null) ?? null,
    readAt: record.readAt ? record.readAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

export type { ResolvedPagination };
