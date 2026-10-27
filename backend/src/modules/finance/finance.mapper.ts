import type { Prisma } from '@prisma/client';
import {
  type IsoDateTime,
  type LedgerEntry,
  type LedgerEntryType,
  type PartnerPayout,
  type PayoutStatus,
} from '@autowra/shared-types';

/** Ledger rows always resolve the booking reference so the partner can read the entry. */
export const ledgerEntryInclude = {
  booking: { select: { reference: true } },
} satisfies Prisma.PartnerLedgerEntryInclude;

export type LedgerEntryRecord = Prisma.PartnerLedgerEntryGetPayload<{ include: typeof ledgerEntryInclude }>;

export function toLedgerEntry(entry: LedgerEntryRecord): LedgerEntry {
  return {
    id: entry.id,
    type: entry.type as LedgerEntryType,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    description: entry.description,
    bookingId: entry.bookingId,
    bookingReference: entry.booking?.reference ?? null,
    payoutId: entry.payoutId,
    balanceAfterMinor: entry.balanceAfterMinor,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function toPartnerPayout(payout: {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  reference: string | null;
  paidAt: Date | null;
  note: string | null;
  entryCount: number;
}): PartnerPayout {
  return {
    id: payout.id,
    status: payout.status as PayoutStatus,
    amountMinor: payout.amountMinor,
    currency: payout.currency,
    periodStart: payout.periodStart.toISOString() as IsoDateTime,
    periodEnd: payout.periodEnd.toISOString() as IsoDateTime,
    reference: payout.reference,
    paidAt: payout.paidAt ? payout.paidAt.toISOString() : null,
    note: payout.note,
    entryCount: payout.entryCount,
  };
}
