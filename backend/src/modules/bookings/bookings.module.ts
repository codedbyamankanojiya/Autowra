import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CouponsModule } from '../coupons/coupons.module';
import { CustomersModule } from '../customers/customers.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

/**
 * Booking lifecycle.
 *
 * `PaymentsModule` is imported rather than the other way around: booking creation opens the
 * gateway order through `PaymentsService`, and the payment module needs nothing from here, so
 * the dependency stays one-directional.
 */
@Module({
  imports: [CatalogModule, CouponsModule, CustomersModule, PricingModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
