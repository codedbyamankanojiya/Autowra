import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ServiceAreasController, ServicesController } from './catalog.controller';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';

@Module({
  controllers: [ServicesController, ServiceAreasController, AvailabilityController],
  providers: [CatalogService, AvailabilityService],
  exports: [CatalogService, AvailabilityService],
})
export class CatalogModule {}
