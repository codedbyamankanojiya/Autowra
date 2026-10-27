import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AddressesService, VehiclesService } from './customer-assets.service';
import { CustomersService } from './customers.service';
import { AddressesController, CustomersController, VehiclesController } from './customers.controller';

@Module({
  imports: [CatalogModule],
  controllers: [CustomersController, VehiclesController, AddressesController],
  providers: [CustomersService, VehiclesService, AddressesService],
  exports: [CustomersService, VehiclesService, AddressesService],
})
export class CustomersModule {}
