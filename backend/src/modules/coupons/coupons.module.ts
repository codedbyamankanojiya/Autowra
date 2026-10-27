import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service';

/**
 * Coupon rules and evaluation. The HTTP surface for coupons is registered in
 * `PricingModule`, because validating a code requires the full pricing context
 * (service eligibility, vehicle size, add-ons) and that would otherwise create a
 * circular dependency between the two modules.
 */
@Module({
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
