import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Subscription plans and customer entitlements.
 *
 * `PaymentsModule` owns the charge and flips a pending purchase to active; this module owns
 * the entitlement itself. The booking flow consumes visits through the pricing engine, so
 * there is no separate usage endpoint that could be played against it.
 */
@Module({
  imports: [CustomersModule, PaymentsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
