import type { Prisma } from '@prisma/client';
import {
  type AddressLabel,
  type AssignmentStatus,
  type BookingAddressSummary,
  type BookingItem,
  type BookingStatus,
  type BookingStatusEvent,
  type BookingVehicleSummary,
  type CompletionPhoto,
  type DocumentStatus,
  type DocumentType,
  type IsoDateTime,
  type PartnerDocument,
  type PartnerJobDetail,
  type PartnerJobSummary,
  type PartnerProfile,
  type PartnerTrainingItem,
  type UserRole,
  type VehicleSize,
  type VehicleType,
  type BookingAddonSelection,
} from '@autowra/shared-types';

/** Everything the partner profile screen, document review and admin verification need. */
export const partnerProfileInclude = {
  user: { select: { phone: true } },
  documents: { orderBy: { createdAt: 'asc' } },
  serviceAreas: { include: { serviceArea: { select: { id: true, name: true } } } },
} satisfies Prisma.PartnerProfileInclude;

export type PartnerProfileRecord = Prisma.PartnerProfileGetPayload<{ include: typeof partnerProfileInclude }>;

/** Assignment plus the booking slice a partner job screen shows. */
export const partnerJobInclude = {
  partner: { include: { user: { select: { phone: true } } } },
  booking: {
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      vehicle: true,
      address: true,
      customer: { select: { name: true, phone: true } },
      statusHistory: { orderBy: { createdAt: 'asc' } },
      photos: { orderBy: { createdAt: 'asc' }, include: { uploadedByUser: { select: { role: true } } } },
    },
  },
} satisfies Prisma.PartnerAssignmentInclude;

export type PartnerJobRecord = Prisma.PartnerAssignmentGetPayload<{ include: typeof partnerJobInclude }>;

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function toPartnerProfile(record: PartnerProfileRecord): PartnerProfile {
  return {
    id: record.id,
    userId: record.userId,
    phone: record.user.phone,
    fullName: record.fullName,
    email: record.email,
    status: record.status as PartnerProfile['status'],
    isOnline: record.isOnline,
    rating: record.ratingCount > 0 ? round1(record.rating) : 0,
    completedJobs: record.completedJobs,
    cancelledJobs: record.cancelledJobs,
    skills: record.skills,
    experienceYears: record.experienceYears,
    vehicleLabel: record.vehicleLabel,
    serviceAreaIds: record.serviceAreas.map((entry) => entry.serviceAreaId),
    serviceAreaNames: record.serviceAreas.map((entry) => entry.serviceArea.name),
    documents: record.documents.map(toPartnerDocument),
    trainingChecklist: toTrainingChecklist(record.trainingChecklist),
    rejectionReason: record.rejectionReason,
    approvedAt: record.approvedAt ? iso(record.approvedAt) : null,
    // The full account number is never returned to the client, only the masked tail.
    maskedBankAccount: record.bankAccountMasked,
    upiId: record.upiId,
    createdAt: iso(record.createdAt),
  };
}

function toPartnerDocument(document: {
  id: string;
  type: string;
  status: string;
  fileName: string;
  reviewNote: string | null;
  createdAt: Date;
}): PartnerDocument {
  return {
    id: document.id,
    type: document.type as DocumentType,
    status: document.status as DocumentStatus,
    fileName: document.fileName,
    // Private: served only through the authenticated partner download route, never the
    // public file route.
    url: `/api/v1/partner/documents/${document.id}`,
    reviewNote: document.reviewNote,
    uploadedAt: iso(document.createdAt),
  };
}

/**
 * The checklist column is free-form JSON written by seeds and admins alike, so entries are
 * normalised here rather than trusted to already match the shared contract.
 */
export function toTrainingChecklist(value: Prisma.JsonValue | null): PartnerTrainingItem[] {
  if (!Array.isArray(value)) return [];
  const items: PartnerTrainingItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const key = typeof raw['key'] === 'string' ? raw['key'] : null;
    if (!key) continue;
    items.push({
      key,
      label: typeof raw['label'] === 'string' ? raw['label'] : key,
      completed: raw['completed'] === true || raw['done'] === true,
      required: raw['required'] === true,
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

/**
 * A job summary hides who the customer is and where exactly they live until the partner has
 * accepted the offer. `revealExact` is derived from the assignment status, never from input.
 */
export function toPartnerJobSummary(record: PartnerJobRecord, commissionPercent: number): PartnerJobSummary {
  const booking = record.booking;
  const accepted = record.status === 'ACCEPTED' || record.status === 'COMPLETED';
  const payoutNetMinor = record.payoutNetMinor ?? estimateNetMinor(booking.taxableAmountMinor, commissionPercent);

  return {
    assignmentId: record.id,
    bookingId: booking.id,
    reference: booking.reference,
    status: booking.status as BookingStatus,
    assignmentStatus: record.status as AssignmentStatus,
    scheduledStart: iso(booking.scheduledStart),
    scheduledEnd: iso(booking.scheduledEnd),
    serviceNames: booking.items.map((item) => item.serviceName),
    vehicleLabel: `${booking.vehicle.make} ${booking.vehicle.model}`,
    areaName: booking.address.city,
    approximateAddress: `${booking.address.line2 ?? booking.address.city}, ${booking.address.city}`,
    distanceKm: record.distanceKm,
    payoutMinor: payoutNetMinor,
    offerExpiresAt: record.expiresAt ? iso(record.expiresAt) : null,
    customerName: accepted ? (booking.customer.name ?? 'Autowra customer') : null,
    customerPhone: accepted ? booking.customer.phone : null,
  };
}

/**
 * `issueReport` is passed in by the service because `SupportTicket.bookingId` is a plain
 * column with no relation field, so it cannot be eager-loaded with the assignment.
 */
export function toPartnerJobDetail(
  record: PartnerJobRecord,
  commissionPercent: number,
  issueReport: PartnerJobDetail['issueReport'] = null,
): PartnerJobDetail {
  const booking = record.booking;
  const accepted = record.status === 'ACCEPTED' || record.status === 'COMPLETED';
  const summary = toPartnerJobSummary(record, commissionPercent);
  const grossMinor = record.payoutGrossMinor ?? Math.max(0, booking.taxableAmountMinor);
  const commissionMinor = record.payoutCommissionMinor ?? percentAmount(grossMinor, commissionPercent);
  const incentiveMinor = record.payoutIncentiveMinor ?? 0;
  const netMinor = record.payoutNetMinor ?? Math.max(0, grossMinor - commissionMinor) + incentiveMinor;

  return {
    ...summary,
    exactAddress: accepted ? toAddressSummary(booking.address) : redactAddress(booking.address),
    addressInstructions: accepted ? booking.notes : null,
    items: accepted ? booking.items.map(toJobItem) : [],
    vehicle: accepted ? toVehicleSummary(booking.vehicle) : null,
    payoutBreakdown: {
      grossMinor,
      commissionMinor,
      incentiveMinor,
      netMinor,
      commissionPercent: record.commissionPercent ?? commissionPercent,
    },
    statusHistory: booking.statusHistory.map(toStatusEvent),
    photos: booking.photos.map(toCompletionPhoto),
    issueReport,
  };
}

function toAddressSummary(address: {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}): BookingAddressSummary {
  return {
    id: address.id,
    label: address.label as AddressLabel,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    latitude: address.latitude,
    longitude: address.longitude,
  };
}

/** The neighbourhood, not the door: what a partner needs to judge an offer before accepting. */
function redactAddress(address: {
  id: string;
  label: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  line2: string | null;
}): BookingAddressSummary {
  return {
    id: address.id,
    label: address.label as AddressLabel,
    line1: address.line2 ?? address.city,
    line2: null,
    landmark: null,
    city: address.city,
    state: address.state,
    postalCode: `${address.postalCode.slice(0, 3)}***`,
    // Rounded to roughly a 1 km grid so the offer cannot be pinpointed before acceptance.
    latitude: round2(address.latitude),
    longitude: round2(address.longitude),
  };
}

function toJobItem(item: {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  vehicleSize: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  durationMinutes: number;
  includedTasks: string[];
  addons: Prisma.JsonValue;
}): BookingItem {
  return {
    id: item.id,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    serviceSlug: item.serviceSlug,
    vehicleSize: item.vehicleSize as VehicleSize,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    totalMinor: item.totalMinor,
    durationMinutes: item.durationMinutes,
    addons: (item.addons as unknown as BookingAddonSelection[]) ?? [],
    includedTasks: item.includedTasks,
  };
}

function toVehicleSummary(vehicle: {
  id: string;
  type: string;
  size: string;
  make: string;
  model: string;
  registrationNumber: string | null;
  nickname: string | null;
}): BookingVehicleSummary {
  return {
    id: vehicle.id,
    type: vehicle.type as VehicleType,
    size: vehicle.size as VehicleSize,
    make: vehicle.make,
    model: vehicle.model,
    registrationNumber: vehicle.registrationNumber,
    nickname: vehicle.nickname,
  };
}

function toStatusEvent(entry: {
  id: string;
  status: string;
  note: string | null;
  actorRole: string;
  createdAt: Date;
}): BookingStatusEvent {
  return {
    id: entry.id,
    status: entry.status as BookingStatus,
    note: entry.note,
    actorRole: entry.actorRole as UserRole | 'SYSTEM',
    createdAt: iso(entry.createdAt),
  };
}

function toCompletionPhoto(photo: {
  id: string;
  kind: string;
  url: string;
  createdAt: Date;
  uploadedByUser: { role: string } | null;
}): CompletionPhoto {
  return {
    id: photo.id,
    kind: photo.kind as CompletionPhoto['kind'],
    url: photo.url,
    uploadedByRole: (photo.uploadedByUser?.role as UserRole) ?? 'PARTNER',
    createdAt: iso(photo.createdAt),
  };
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

function iso(value: Date): IsoDateTime {
  return value.toISOString();
}

function estimateNetMinor(taxableAmountMinor: number, commissionPercent: number): number {
  const gross = Math.max(0, taxableAmountMinor);
  return Math.max(0, gross - percentAmount(gross, commissionPercent));
}

function percentAmount(amountMinor: number, percent: number): number {
  return Math.round((amountMinor * percent) / 100);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
