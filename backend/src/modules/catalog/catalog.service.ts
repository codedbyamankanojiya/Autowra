import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  Service as PrismaServiceRecord,
  ServiceAddon as PrismaAddon,
  ServiceCategory as PrismaCategory,
  ServiceSizePrice,
} from '@prisma/client';
import type {
  Service,
  ServiceAddon,
  ServiceArea,
  ServiceCatalogResponse,
  ServiceCategory,
  ServiceabilityResult,
  VehicleSize,
  VehicleType,
} from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import type { Db } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

type ServiceWithRelations = PrismaServiceRecord & {
  category: PrismaCategory;
  sizePrices: ServiceSizePrice[];
  addonLinks: Array<{ addon: PrismaAddon }>;
};

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(vehicleType?: VehicleType): Promise<ServiceCategory[]> {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { isActive: true, ...(vehicleType ? { vehicleType } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return categories.map(toCategoryDto);
  }

  async listServices(query: {
    vehicleType?: VehicleType;
    categorySlug?: string;
    popularOnly?: boolean;
    includeInactive?: boolean;
  }): Promise<Service[]> {
    const services = await this.prisma.service.findMany({
      where: {
        ...(query.includeInactive ? {} : { isActive: true }),
        ...(query.vehicleType ? { vehicleType: query.vehicleType } : {}),
        ...(query.popularOnly ? { isPopular: true } : {}),
        ...(query.categorySlug ? { category: { slug: query.categorySlug } } : {}),
      },
      include: { category: true, sizePrices: true, addonLinks: { include: { addon: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return services.map((service) => toServiceDto(service as ServiceWithRelations));
  }

  async catalog(query: {
    vehicleType?: VehicleType;
    categorySlug?: string;
    popularOnly?: boolean;
  }): Promise<ServiceCatalogResponse> {
    const [categories, services] = await Promise.all([
      this.listCategories(query.vehicleType),
      this.listServices(query),
    ]);
    const addonMap = new Map<string, ServiceAddon>();
    for (const service of services) {
      for (const addon of service.addons) addonMap.set(addon.id, addon);
    }
    return {
      categories,
      services,
      addons: [...addonMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      source: 'database',
    };
  }

  async getServiceOrThrow(serviceId: string, db: Db = this.prisma): Promise<ServiceWithRelations> {
    const service = await db.service.findUnique({
      where: { id: serviceId },
      include: { category: true, sizePrices: true, addonLinks: { include: { addon: true } } },
    });
    if (!service) throw AppError.notFound('That service is no longer available.');
    if (!service.isActive) throw AppError.badRequest('SERVICE_NOT_ELIGIBLE', 'That service is currently unavailable.');
    return service as ServiceWithRelations;
  }

  async getServiceDtoOrThrow(serviceId: string): Promise<Service> {
    return toServiceDto(await this.getServiceOrThrow(serviceId));
  }

  /** Price for a specific vehicle size, falling back to the base price. */
  priceForSize(service: ServiceWithRelations, size: VehicleSize): number {
    const exact = service.sizePrices.find((entry) => entry.vehicleSize === size);
    return exact?.priceMinor ?? service.basePriceMinor;
  }

  resolveAddons(service: ServiceWithRelations, addonIds: string[]): ServiceAddon[] {
    if (addonIds.length === 0) return [];
    const available = new Map(service.addonLinks.map((link) => [link.addon.id, link.addon]));
    const resolved: ServiceAddon[] = [];
    for (const addonId of new Set(addonIds)) {
      const addon = available.get(addonId);
      if (!addon) {
        throw AppError.badRequest(
          'VALIDATION_FAILED',
          'One of the selected add-ons is not available for this service.',
        );
      }
      if (!addon.isActive) {
        throw AppError.badRequest('VALIDATION_FAILED', `The add-on "${addon.name}" is currently unavailable.`);
      }
      resolved.push(toAddonDto(addon));
    }
    return resolved;
  }

  /* ------------------------------------------------------------------ */
  /* Service areas & serviceability                                      */
  /* ------------------------------------------------------------------ */

  async listAreas(): Promise<ServiceArea[]> {
    const areas = await this.prisma.serviceArea.findMany({ orderBy: { name: 'asc' } });
    return areas.map(toAreaDto);
  }

  async getAreaOrThrow(areaId: string): Promise<ServiceArea> {
    const area = await this.prisma.serviceArea.findUnique({ where: { id: areaId } });
    if (!area) throw AppError.notFound('That service area was not found.');
    return toAreaDto(area);
  }

  /**
   * Answers whether we can serve a postal code and/or coordinate.
   * An INACTIVE area is treated as unserviceable so operations can pause a zone instantly.
   */
  async checkServiceability(
    input: {
      postalCode?: string;
      latitude?: number;
      longitude?: number;
    },
    db: Db = this.prisma,
  ): Promise<ServiceabilityResult> {
    if (!input.postalCode && (input.latitude === undefined || input.longitude === undefined)) {
      throw AppError.badRequest('VALIDATION_FAILED', 'Provide a postal code or a set of coordinates.');
    }

    if (input.postalCode) {
      const byPostal = await db.serviceArea.findFirst({
        where: { postalCodes: { has: input.postalCode } },
      });
      if (byPostal) return areaResult(byPostal);
    }

    // Fall back to the nearest active area using a bounding-box query, then refine.
    if (input.latitude !== undefined && input.longitude !== undefined) {
      const candidates = await db.serviceArea.findMany({ where: { status: 'ACTIVE' } });
      const withDistance = candidates
        .map((area) => ({ area, distanceKm: distanceToAreaKm(area, input.latitude!, input.longitude!) }))
        .filter((entry) => entry.distanceKm !== null)
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

      const nearest = withDistance[0];
      if (nearest && (nearest.distanceKm ?? Number.POSITIVE_INFINITY) <= 12) {
        return areaResult(nearest.area);
      }
    }

    return {
      serviceable: false,
      area: null,
      reason: 'OUTSIDE_SERVICE_AREA',
      message:
        'Autowra does not serve this location yet. Try another address or contact support to request your area.',
    };
  }

  async findAreaForAddress(
    input: { postalCode: string; latitude: number; longitude: number },
    db: Db = this.prisma,
  ): Promise<ServiceArea | null> {
    const byPostal = await db.serviceArea.findFirst({
      where: { postalCodes: { has: input.postalCode }, status: 'ACTIVE' },
    });
    if (byPostal) return toAreaDto(byPostal);

    const active = await db.serviceArea.findMany({ where: { status: 'ACTIVE' } });
    const nearest = active
      .map((area) => ({ area, distanceKm: distanceToAreaKm(area, input.latitude, input.longitude) }))
      .filter((entry) => entry.distanceKm !== null && entry.distanceKm <= 12)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))[0];
    return nearest ? toAreaDto(nearest.area) : null;
  }
}

/* -------------------------------------------------------------------- */
/* Mappers                                                               */
/* -------------------------------------------------------------------- */

export function toCategoryDto(category: PrismaCategory): ServiceCategory {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    vehicleType: category.vehicleType as VehicleType,
    iconKey: category.iconKey,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  };
}

export function toAddonDto(addon: PrismaAddon): ServiceAddon {
  return {
    id: addon.id,
    slug: addon.slug,
    name: addon.name,
    description: addon.description,
    priceMinor: addon.priceMinor,
    durationMinutes: addon.durationMinutes,
    isActive: addon.isActive,
  };
}

export function toServiceDto(service: ServiceWithRelations): Service {
  return {
    id: service.id,
    categoryId: service.categoryId,
    categorySlug: service.category.slug,
    categoryName: service.category.name,
    slug: service.slug,
    name: service.name,
    shortDescription: service.shortDescription,
    description: service.description,
    vehicleType: service.vehicleType as VehicleType,
    eligibleVehicleSizes: service.eligibleVehicleSizes as VehicleSize[],
    includedTasks: service.includedTasks,
    basePriceMinor: service.basePriceMinor,
    durationMinutes: service.durationMinutes,
    sizePrices: service.sizePrices.map((entry) => ({
      vehicleSize: entry.vehicleSize as VehicleSize,
      priceMinor: entry.priceMinor,
    })),
    addons: service.addonLinks
      .map((link) => toAddonDto(link.addon))
      .filter((addon) => addon.isActive)
      .sort((a, b) => a.name.localeCompare(b.name)),
    taxPercent: service.taxPercent,
    isPopular: service.isPopular,
    isActive: service.isActive,
    sortOrder: service.sortOrder,
    imageUrl: service.imageUrl,
  };
}

export function toAreaDto(area: {
  id: string;
  name: string;
  city: string;
  state: string;
  postalCodes: string[];
  status: string;
}): ServiceArea {
  return {
    id: area.id,
    name: area.name,
    city: area.city,
    state: area.state,
    postalCodes: area.postalCodes,
    isActive: area.status === 'ACTIVE',
  };
}

function areaResult(
  area: { id: string; name: string; city: string; state: string; postalCodes: string[]; status: string },
): ServiceabilityResult {
  if (area.status !== 'ACTIVE') {
    return {
      serviceable: false,
      area: toAreaDto(area),
      reason: 'AREA_PAUSED',
      message: `${area.name} is temporarily paused. Please check back soon or contact support.`,
    };
  }
  return {
    serviceable: true,
    area: toAreaDto(area),
    reason: null,
    message: `Good news - we serve ${area.name}.`,
  };
}

function distanceToAreaKm(
  area: { boundary: Prisma.JsonValue | null; city: string },
  latitude: number,
  longitude: number,
): number | null {
  const boundary = area.boundary;
  if (!Array.isArray(boundary) || boundary.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  for (const point of boundary) {
    if (typeof point !== 'object' || point === null) continue;
    const lat = (point as { latitude?: unknown }).latitude;
    const lng = (point as { longitude?: unknown }).longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    min = Math.min(min, haversineKm(latitude, longitude, lat, lng));
  }
  return Number.isFinite(min) ? min : null;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}
