import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CustomerSubscription, SubscriptionPlan } from '@autowra/shared-types';
import { subscribeSchema, type SubscribeInput } from '@autowra/validation';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { zodBody } from '../../common/zod-validation.pipe';
import { SubscriptionsService, type SubscribeResult } from './subscriptions.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** Public price list; the home screen shows plans before a customer signs in. */
  @Public()
  @Get('plans')
  plans(): Promise<{ items: SubscriptionPlan[] }> {
    return this.subscriptions.listPlans();
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser): Promise<{ items: CustomerSubscription[] }> {
    return this.subscriptions.listMine(user.id);
  }

  /** Buys a plan. The plan only becomes usable once the payment is confirmed. */
  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Post()
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(subscribeSchema)) input: SubscribeInput,
  ): Promise<SubscribeResult> {
    return this.subscriptions.subscribe(user.id, input);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') subscriptionId: string,
  ): Promise<CustomerSubscription> {
    return this.subscriptions.cancel(user.id, subscriptionId);
  }
}
