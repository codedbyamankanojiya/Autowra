import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { availabilityQuerySchema, type AvailabilityQueryInput } from '@autowra/validation';
import { CurrentUser } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AvailabilityService } from './availability.service';

@ApiTags('availability')
@ApiBearerAuth()
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  getAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe<AvailabilityQueryInput>(availabilityQuerySchema)) query: AvailabilityQueryInput,
  ) {
    return this.availability.getAvailability({
      serviceId: query.serviceId,
      date: query.date,
      addressId: query.addressId,
      postalCode: query.postalCode,
      // Scoping to the caller keeps one customer from probing another customer's address.
      customerId: user.role === 'CUSTOMER' ? user.id : undefined,
    });
  }
}
