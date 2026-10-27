import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createAddressSchema,
  createVehicleSchema,
  deleteAccountSchema,
  updateAddressSchema,
  updateProfileSchema,
  updateVehicleSchema,
  type CreateAddressInput,
  type CreateVehicleInput,
  type DeleteAccountInput,
  type UpdateAddressInput,
  type UpdateProfileInput,
  type UpdateVehicleInput,
} from '@autowra/validation';
import { CurrentUser, RequestMeta, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AddressesService, VehiclesService } from './customer-assets.service';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@Roles('CUSTOMER')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.customers.getProfile(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe<UpdateProfileInput>(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.customers.updateProfile(user.id, body);
  }

  @Post('me/delete-request')
  requestDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe<DeleteAccountInput>(deleteAccountSchema)) body: DeleteAccountInput,
    @RequestMeta() meta: { ipAddress: string | null; userAgent: string | null },
  ) {
    return this.customers.requestDeletion(user.id, body, meta);
  }
}

@ApiTags('vehicles')
@ApiBearerAuth()
@Roles('CUSTOMER')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { items: await this.vehicles.list(user.id) };
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe<CreateVehicleInput>(createVehicleSchema)) body: CreateVehicleInput,
  ) {
    return this.vehicles.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe<UpdateVehicleInput>(updateVehicleSchema)) body: UpdateVehicleInput,
  ) {
    return this.vehicles.update(user.id, id, body);
  }

  @Post(':id/default')
  setDefault(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.vehicles.setDefault(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.vehicles.remove(user.id, id);
  }
}

@ApiTags('addresses')
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { items: await this.addresses.list(user.id) };
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe<CreateAddressInput>(createAddressSchema)) body: CreateAddressInput,
  ) {
    return this.addresses.create(user.id, body);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe<UpdateAddressInput>(updateAddressSchema)) body: UpdateAddressInput,
  ) {
    return this.addresses.update(user.id, id, body);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.addresses.remove(user.id, id);
  }
}
