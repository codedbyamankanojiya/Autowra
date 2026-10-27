import { Injectable } from '@nestjs/common';
import type { AvailabilitySlot as PrismaSlot, Prisma } from '@prisma/client';
import type { AvailabilityDay, AvailabilityResponse, AvailabilitySlot } from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import type { Db } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const AVAILABILITY_WINDOW_DAYS = 7;
const DEFAULT_SLOT_MINUTES = 60;

export interface AvailabilityRequest {
  readonly serviceId: string;
  readonly date: string;
  readonly addressId?: string;
  readonly postalCode?: string;
  readonly customerId?: string;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  /**
   * Availability is always computed from the slot rows, never from cached counters, so a
   * slot that filled up a second ago is reported as unavailable.
   */
  async getAvailability(request: AvailabilityRequest): Promise<AvailabilityResponse> {
    const areaId = await this.resolveAreaId(request);
    if (!areaId) {
      return {
        date: request.date,
        slotMinutes: DEFAULT_SLOT_MINUTES,
        days: [],
        timezone: 'Asia/Kolkata',
        message: 'We do not serve this location yet, so no time slots are available.',
      };
    }

    // The service must exist and be active before we show any slots.
    await this.catalog.getServiceOrThrow(request.serviceId);

    const from = startOfDay(new Date(`${request.date}T00:00:00+05:30`));
    const to = addDays(from, AVAILABILITY_WINDOW_DAYS);

    const slots = await this.prisma.availabilitySlot.findMany({
      where: { serviceAreaId: areaId, isActive: true, startTime: { gte: from, lt: to } },
      orderBy: { startTime: 'asc' },
    });

    const days = groupByDay(slots);
    const hasAnySlot = days.some((day) => day.slots.some((slot) => slot.available));

    return {
      date: request.date,
      slotMinutes: slots[0] ? minutesBetween(slots[0].startTime, slots[0].endTime) : DEFAULT_SLOT_MINUTES,
      days,
      timezone: 'Asia/Kolkata',
      message: hasAnySlot ? null : 'No slots are open in this window. Try another date or area.',
    };
  }

  /**
   * Resolves the service area for a booking request from either a saved address or a PIN code.
   * Booking creation and slot claiming must agree on the area, so both call this.
   */
  async resolveAreaId(
    input: { addressId?: string; postalCode?: string; customerId?: string },
    db: Db = this.prisma,
  ): Promise<string | null> {
    if (input.addressId) {
      const address = await db.address.findFirst({
        where: { id: input.addressId, ...(input.customerId ? { customerId: input.customerId } : {}) },
      });
      if (!address) throw AppError.notFound('That address was not found.');
      if (address.serviceAreaId) {
        const area = await db.serviceArea.findUnique({ where: { id: address.serviceAreaId } });
        if (area?.status === 'ACTIVE') return area.id;
      }
      const resolved = await this.catalog.findAreaForAddress(
        {
          postalCode: address.postalCode,
          latitude: address.latitude,
          longitude: address.longitude,
        },
        db,
      );
      return resolved?.id ?? null;
    }

    if (input.postalCode) {
      const result = await this.catalog.checkServiceability({ postalCode: input.postalCode }, db);
      return result.serviceable ? (result.area?.id ?? null) : null;
    }

    return null;
  }

  /** Returns the slot for a requested start time, rejecting times that are not offered. */
  async findSlotForStart(areaId: string, scheduledStart: Date, db: Db = this.prisma): Promise<PrismaSlot | null> {
    return db.availabilitySlot.findUnique({
      where: { serviceAreaId_startTime: { serviceAreaId: areaId, startTime: scheduledStart } },
    });
  }

  /**
   * Atomically reserves one unit of capacity.
   *
   * The `booked < capacity` predicate is applied by the database inside the update, so two
   * concurrent requests can never both succeed for the last seat of a slot.
   */
  async claimSlot(tx: Prisma.TransactionClient, slotId: string): Promise<void> {
    // Compare-and-set in one statement: PostgreSQL evaluates `booked < capacity` while the
    // row is locked, so two concurrent bookings cannot both take the last seat.
    const affected = await tx.$executeRaw`
      UPDATE "AvailabilitySlot"
      SET "booked" = "booked" + 1, "updatedAt" = NOW()
      WHERE "id" = ${slotId} AND "isActive" = true AND "booked" < "capacity"
    `;
    if (affected === 0) {
      throw AppError.conflict('SLOT_UNAVAILABLE', 'That time slot was just taken. Please pick another slot.');
    }
  }

  /** Releases capacity when a booking is cancelled or rescheduled away from a slot. */
  async releaseSlot(tx: Prisma.TransactionClient, slotId: string): Promise<void> {
    await tx.availabilitySlot.updateMany({
      where: { id: slotId, booked: { gt: 0 } },
      data: { booked: { decrement: 1 } },
    });
  }

  /** Creates the slot grid for an area; used by the seed script and the admin dashboard. */
  async generateSlots(
    areaId: string,
    options: { days?: number; startHour?: number; endHour?: number; capacity?: number; slotMinutes?: number } = {},
  ): Promise<{ created: number; skipped: number }> {
    const days = options.days ?? 14;
    const startHour = options.startHour ?? 8;
    const endHour = options.endHour ?? 20;
    const capacity = options.capacity ?? 4;
    const slotMinutes = options.slotMinutes ?? DEFAULT_SLOT_MINUTES;

    let created = 0;
    let skipped = 0;

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const dayStart = startOfDay(addDays(new Date(), dayOffset));
      for (let minutes = startHour * 60; minutes + slotMinutes <= endHour * 60; minutes += slotMinutes) {
        const startTime = new Date(dayStart.getTime() + minutes * 60_000);
        const endTime = new Date(startTime.getTime() + slotMinutes * 60_000);
        const existing = await this.prisma.availabilitySlot.findUnique({
          where: { serviceAreaId_startTime: { serviceAreaId: areaId, startTime } },
        });
        if (existing) {
          skipped += 1;
          continue;
        }
        await this.prisma.availabilitySlot.create({
          data: { serviceAreaId: areaId, startTime, endTime, capacity },
        });
        created += 1;
      }
    }

    return { created, skipped };
  }
}

function groupByDay(slots: PrismaSlot[]): AvailabilityDay[] {
  const map = new Map<string, AvailabilitySlot[]>();
  for (const slot of slots) {
    const key = toDateKey(slot.startTime);
    const entry: AvailabilitySlot = {
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      capacity: slot.capacity,
      booked: slot.booked,
      available: slot.isActive && slot.booked < slot.capacity && slot.startTime.getTime() > Date.now(),
    };
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySlots]) => ({
      date,
      slots: daySlots.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }));
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
}

/** IST calendar key so a slot at 23:30 local time is grouped on the correct day. */
function toDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}
