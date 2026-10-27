import {
  BookingStatus,
  bookingStatusPresentation,
  type BookingStatus as BookingStatusType,
  type UserRole,
} from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
import type { Db } from '../../common/types';

/**
 * The only edges a booking lifecycle may take.
 *
 * Every status write in the backend goes through `assertTransition`, so an invalid jump -
 * for example COMPLETED straight from PENDING_PAYMENT - cannot be persisted regardless of
 * which role or endpoint triggered it. Partner, admin and payment flows all share this map.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatusType, readonly BookingStatusType[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ASSIGNED', 'CANCELLED', 'NO_PARTNER_FOUND'],
  ASSIGNED: ['PARTNER_ACCEPTED', 'CANCELLED', 'NO_PARTNER_FOUND'],
  PARTNER_ACCEPTED: ['TRAVELLING', 'ASSIGNED', 'CANCELLED'],
  TRAVELLING: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_PARTNER_FOUND: ['CANCELLED'],
};

/** Statuses a partner can still act on. */
export const PARTNER_ACTIONABLE_STATUSES: readonly BookingStatusType[] = [
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
  BookingStatus.TRAVELLING,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

/** Statuses that still occupy capacity and count as an open booking. */
export const OPEN_BOOKING_STATUSES: readonly BookingStatusType[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
  BookingStatus.TRAVELLING,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

/** Statuses a customer may cancel from, before the partner has started work. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly BookingStatusType[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.ASSIGNED,
  BookingStatus.PARTNER_ACCEPTED,
];

export function isTerminalStatus(status: BookingStatusType): boolean {
  return BOOKING_TRANSITIONS[status].length === 0;
}

export function nextExpectedStatuses(status: BookingStatusType): BookingStatusType[] {
  return [...BOOKING_TRANSITIONS[status]];
}

export function statusLabel(status: BookingStatusType): string {
  return bookingStatusPresentation[status].label;
}

export function assertTransition(from: BookingStatusType, to: BookingStatusType): void {
  if (!BOOKING_TRANSITIONS[from].includes(to)) {
    throw AppError.conflict(
      'INVALID_STATUS_TRANSITION',
      `A booking that is "${statusLabel(from)}" cannot move to "${statusLabel(to)}".`,
    );
  }
}

export interface StatusHistoryInput {
  readonly bookingId: string;
  readonly status: BookingStatusType;
  readonly actorRole: UserRole | 'SYSTEM';
  readonly actorUserId?: string | null;
  readonly note?: string | null;
}

/**
 * Appends to the booking status trail. Called with the surrounding transaction so the
 * history row can never exist without the booking change it describes.
 */
export async function writeStatusHistory(db: Db, input: StatusHistoryInput): Promise<void> {
  await db.bookingStatusHistory.create({
    data: {
      bookingId: input.bookingId,
      status: input.status,
      actorRole: String(input.actorRole),
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? null,
    },
  });
}
