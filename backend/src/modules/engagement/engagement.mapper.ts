import type { Prisma } from '@prisma/client';
import type { Review, SupportTicket, SupportTicketMessage, UserRole } from '@autowra/shared-types';

/** Relations every review row needs, on the public list and the admin table alike. */
export const reviewInclude = {
  booking: { select: { reference: true } },
  customer: { select: { name: true } },
  partner: { select: { fullName: true } },
} satisfies Prisma.ReviewInclude;

export type ReviewRecord = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

export const ticketInclude = {
  createdByUser: { select: { name: true } },
  assignedToUser: { select: { name: true } },
  messages: {
    orderBy: { createdAt: 'asc' },
    include: { authorUser: { select: { name: true } } },
  },
} satisfies Prisma.SupportTicketInclude;

export type TicketRecord = Prisma.SupportTicketGetPayload<{ include: typeof ticketInclude }>;

export function toReview(record: ReviewRecord): Review {
  return {
    id: record.id,
    bookingId: record.bookingId,
    bookingReference: record.booking.reference,
    rating: record.rating,
    comment: record.comment,
    customerName: record.customer.name,
    partnerName: record.partner?.fullName ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * `SupportTicket.bookingId` is a plain column with no relation, so the caller looks the
 * booking reference up and passes it in.
 *
 * Internal notes are dropped unless the viewer is staff, which keeps a customer from ever
 * seeing what operations wrote about their case.
 */
export function toSupportTicket(
  record: TicketRecord,
  options: { includeInternal: boolean; bookingReference?: string | null },
): SupportTicket {
  return {
    id: record.id,
    reference: record.reference,
    category: record.category as SupportTicket['category'],
    status: record.status as SupportTicket['status'],
    subject: record.subject,
    description: record.description,
    bookingId: record.bookingId,
    bookingReference: options.bookingReference ?? null,
    createdByRole: record.createdByRole as UserRole,
    createdByName: record.createdByUser.name,
    assignedToName: record.assignedToUser?.name ?? null,
    messages: record.messages
      .filter((message) => options.includeInternal || !message.isInternal)
      .map(toTicketMessage),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toTicketMessage(record: TicketRecord['messages'][number]): SupportTicketMessage {
  return {
    id: record.id,
    authorRole: record.authorRole as UserRole,
    authorName: record.authorUser.name,
    body: record.body,
    createdAt: record.createdAt.toISOString(),
  };
}
