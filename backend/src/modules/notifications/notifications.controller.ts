import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { registerPushTokenSchema, type RegisterPushTokenInput } from '@autowra/validation';
import { CurrentUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: { page?: string; pageSize?: string; unreadOnly?: string },
  ) {
    return this.notifications.listForUser(user.id, {
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      unreadOnly: query.unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post('push-token')
  registerPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe<RegisterPushTokenInput>(registerPushTokenSchema)) body: RegisterPushTokenInput,
  ) {
    return this.notifications.registerPushToken(user.id, {
      token: body.token,
      platform: body.platform,
      deviceId: body.deviceId ?? null,
    });
  }

  @Post('push-token/remove')
  removePushToken(@CurrentUser() user: AuthenticatedUser, @Body() body: { token: string }) {
    return this.notifications.unregisterPushToken(user.id, body.token);
  }
}
