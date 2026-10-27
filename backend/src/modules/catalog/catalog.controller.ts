import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { listServicesQuerySchema, type ListServicesQueryInput } from '@autowra/validation';
import { Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller('services')
export class ServicesController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  async categories(@Query('vehicleType') vehicleType?: 'CAR' | 'BIKE') {
    return { items: await this.catalog.listCategories(vehicleType) };
  }

  @Public()
  @Get()
  async list(@Query(new ZodValidationPipe<ListServicesQueryInput>(listServicesQuerySchema)) query: ListServicesQueryInput) {
    return this.catalog.catalog(query);
  }

  @Public()
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.catalog.getServiceDtoOrThrow(id);
  }
}

@ApiTags('service-areas')
@Controller('service-areas')
export class ServiceAreasController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  async list() {
    return { items: await this.catalog.listAreas() };
  }

  @Public()
  @Get('check')
  check(
    @Query('postalCode') postalCode?: string,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
  ) {
    return this.catalog.checkServiceability({
      postalCode: postalCode?.trim() || undefined,
      latitude: latitude !== undefined && latitude !== '' ? Number(latitude) : undefined,
      longitude: longitude !== undefined && longitude !== '' ? Number(longitude) : undefined,
    });
  }
}
