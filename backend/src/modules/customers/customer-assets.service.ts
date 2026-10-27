import { Injectable } from '@nestjs/common';
import type { Address as PrismaAddress, Vehicle as PrismaVehicle } from '@prisma/client';
import type { Address, ServiceabilityResult, Vehicle, VehicleSize, VehicleType } from '@autowra/shared-types';
import type { CreateAddressInput, CreateVehicleInput, UpdateAddressInput, UpdateVehicleInput } from '@autowra/validation';
import { AppError } from '../../common/app-error';
import type { Db } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: string): Promise<Vehicle[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return vehicles.map(toVehicleDto);
  }

  async getOrThrow(customerId: string, vehicleId: string, db: Db = this.prisma): Promise<PrismaVehicle> {
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, customerId } });
    if (!vehicle) {
      // Object level authorisation: another customer's vehicle is indistinguishable from
      // a missing one, so we never leak the existence of someone else's record.
      throw AppError.notFound('That vehicle was not found in your garage.');
    }
    return vehicle;
  }

  async create(customerId: string, input: CreateVehicleInput): Promise<Vehicle> {
    const existingCount = await this.prisma.vehicle.count({ where: { customerId } });
    const shouldBeDefault = input.isDefault === true || existingCount === 0;

    const vehicle = await this.prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.vehicle.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      return tx.vehicle.create({
        data: {
          customerId,
          type: input.type,
          size: input.size,
          make: input.make,
          model: input.model,
          registrationNumber: input.registrationNumber ?? null,
          nickname: input.nickname ?? null,
          color: input.color ?? null,
          isDefault: shouldBeDefault,
        },
      });
    });

    return toVehicleDto(vehicle);
  }

  async update(customerId: string, vehicleId: string, input: UpdateVehicleInput): Promise<Vehicle> {
    await this.getOrThrow(customerId, vehicleId);

    const vehicle = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.vehicle.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      return tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.size !== undefined ? { size: input.size } : {}),
          ...(input.make !== undefined ? { make: input.make } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.registrationNumber !== undefined ? { registrationNumber: input.registrationNumber ?? null } : {}),
          ...(input.nickname !== undefined ? { nickname: input.nickname ?? null } : {}),
          ...(input.color !== undefined ? { color: input.color ?? null } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        },
      });
    });

    return toVehicleDto(vehicle);
  }

  async remove(customerId: string, vehicleId: string): Promise<{ removed: boolean }> {
    await this.getOrThrow(customerId, vehicleId);

    const upcoming = await this.prisma.booking.count({
      where: {
        vehicleId,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'ASSIGNED', 'PARTNER_ACCEPTED', 'TRAVELLING', 'ARRIVED', 'IN_PROGRESS'] },
      },
    });
    if (upcoming > 0) {
      throw AppError.conflict('CONFLICT', 'This vehicle has an active booking and cannot be removed yet.');
    }

    await this.prisma.vehicle.delete({ where: { id: vehicleId } });
    return { removed: true };
  }

  async setDefault(customerId: string, vehicleId: string): Promise<Vehicle> {
    await this.getOrThrow(customerId, vehicleId);
    const vehicle = await this.prisma.$transaction(async (tx) => {
      await tx.vehicle.updateMany({ where: { customerId }, data: { isDefault: false } });
      return tx.vehicle.update({ where: { id: vehicleId }, data: { isDefault: true } });
    });
    return toVehicleDto(vehicle);
  }
}

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async list(customerId: string): Promise<Address[]> {
    const addresses = await this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return addresses.map((address) => toAddressDto(address));
  }

  async getOrThrow(customerId: string, addressId: string, db: Db = this.prisma): Promise<PrismaAddress> {
    const address = await db.address.findFirst({ where: { id: addressId, customerId } });
    if (!address) throw AppError.notFound('That address was not found.');
    return address;
  }

  async create(customerId: string, input: CreateAddressInput): Promise<Address> {
    const area = await this.catalog.findAreaForAddress({
      postalCode: input.postalCode,
      latitude: input.latitude,
      longitude: input.longitude,
    });

    const existingCount = await this.prisma.address.count({ where: { customerId } });
    const shouldBeDefault = input.isDefault === true || existingCount === 0;

    const address = await this.prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      const created = await tx.address.create({
        data: {
          customerId,
          label: input.label,
          nickname: input.nickname ?? null,
          line1: input.line1,
          line2: input.line2 ?? null,
          landmark: input.landmark ?? null,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          latitude: input.latitude,
          longitude: input.longitude,
          isDefault: shouldBeDefault,
          serviceAreaId: area?.id ?? null,
        },
      });
      if (shouldBeDefault) {
        await tx.customerProfile.upsert({
          where: { userId: customerId },
          create: { userId: customerId, defaultAddressId: created.id },
          update: { defaultAddressId: created.id },
        });
      }
      return created;
    });

    return toAddressDto(address, area?.id ?? null);
  }

  async update(customerId: string, addressId: string, input: UpdateAddressInput): Promise<Address> {
    const current = await this.getOrThrow(customerId, addressId);

    const postalCode = input.postalCode ?? current.postalCode;
    const latitude = input.latitude ?? current.latitude;
    const longitude = input.longitude ?? current.longitude;
    const locationChanged =
      postalCode !== current.postalCode || latitude !== current.latitude || longitude !== current.longitude;

    const area = locationChanged
      ? await this.catalog.findAreaForAddress({ postalCode, latitude, longitude })
      : null;

    const address = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
        await tx.customerProfile.upsert({
          where: { userId: customerId },
          create: { userId: customerId, defaultAddressId: addressId },
          update: { defaultAddressId: addressId },
        });
      }
      return tx.address.update({
        where: { id: addressId },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.nickname !== undefined ? { nickname: input.nickname ?? null } : {}),
          ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
          ...(input.line2 !== undefined ? { line2: input.line2 ?? null } : {}),
          ...(input.landmark !== undefined ? { landmark: input.landmark ?? null } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(locationChanged ? { serviceAreaId: area?.id ?? null } : {}),
        },
      });
    });

    return toAddressDto(address, address.serviceAreaId);
  }

  async remove(customerId: string, addressId: string): Promise<{ removed: boolean }> {
    await this.getOrThrow(customerId, addressId);

    const upcoming = await this.prisma.booking.count({
      where: {
        addressId,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'ASSIGNED', 'PARTNER_ACCEPTED', 'TRAVELLING', 'ARRIVED', 'IN_PROGRESS'] },
      },
    });
    if (upcoming > 0) {
      throw AppError.conflict('CONFLICT', 'This address is used by an active booking and cannot be removed yet.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: addressId } });
      const profile = await tx.customerProfile.findUnique({ where: { userId: customerId } });
      if (profile?.defaultAddressId === addressId) {
        const nextDefault = await tx.address.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'asc' },
        });
        if (nextDefault) {
          await tx.address.update({ where: { id: nextDefault.id }, data: { isDefault: true } });
        }
        await tx.customerProfile.update({
          where: { userId: customerId },
          data: { defaultAddressId: nextDefault?.id ?? null },
        });
      }
    });

    return { removed: true };
  }

  async checkServiceability(input: {
    postalCode?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<ServiceabilityResult> {
    return this.catalog.checkServiceability(input);
  }
}

export function toVehicleDto(vehicle: PrismaVehicle): Vehicle {
  return {
    id: vehicle.id,
    customerId: vehicle.customerId,
    type: vehicle.type as VehicleType,
    size: vehicle.size as VehicleSize,
    make: vehicle.make,
    model: vehicle.model,
    registrationNumber: vehicle.registrationNumber,
    nickname: vehicle.nickname,
    color: vehicle.color,
    isDefault: vehicle.isDefault,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}

export function toAddressDto(address: PrismaAddress, resolvedAreaId?: string | null): Address {
  const serviceAreaId = resolvedAreaId ?? address.serviceAreaId;
  return {
    id: address.id,
    customerId: address.customerId,
    label: address.label as Address['label'],
    nickname: address.nickname,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
    serviceAreaId: serviceAreaId ?? null,
    serviceable: Boolean(serviceAreaId),
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}
