import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CouponsModule } from '../coupons/coupons.module';
import { CustomersModule } from '../customers/customers.module';
import { CouponsController } from './coupons.controller';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [CatalogModule, CustomersModule, CouponsModule],
  controllers: [PricingController, CouponsController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
