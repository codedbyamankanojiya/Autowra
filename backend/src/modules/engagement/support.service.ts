import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  NotificationType,
  SupportTicketStatus,
  type Paginated,
  type SupportTicket,
} from '@autowra/shared-types';
import type {
  AddTicketMessageInput,
  CreateSupportTicketInput,
  ListTicketsQueryInput,
} from '@autowra/validation';
import { AppError } from '../../common/app-error';
import { generateTicketReference } from '../../common/identifiers';
import { paginate, resolvePagination } from '../../common/pagination';
import type { AuthenticatedUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ticketInclude, toSupportTicket, type TicketRecord } from './engagement.mapper';

/**
 * Support tickets.
 *
 * Visibility is scoped in the database rather than in the UI: a customer or partner only ever
 * loads tickets they raised, and only staff can see internal notes. A ticket may reference a
 * booking, and that reference is checked against the caller's own bookings before it is
 * attached, so a ticket can never be used to probe someone else's order.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(user: AuthenticatedUser, input: CreateSupportTicketInput): Promise<SupportTicket> {
    const bookingId = input.bookingId ?? null;
    if (bookingId) await this.assertBookingAccess(user, bookingId);

    const ticket = await this.prisma.supportTicket.create({
      data: {
        reference: generateTicketReference(),
        category: input.category,
        status: SupportTicketStatus.OPEN,
        subject: input.subject,
        description: input.description,
        bookingId,
        createdByUserId: user.id,
        createdByRole: user.role,
        // The opening description is also the first message so the thread reads top to bottom.
        messages: {
          create: { authorUserId: user.id, authorRole: user.role, body: input.description },
        },
      },
      include: ticketInclude,
    });

    await this.notifications.notify({
      userId: user.id,
      type: NotificationType.SUPPORT_TICKET_UPDATE,
      title: 'We received your request',
      body: `Ticket ${ticket.reference} is open. Our support team will reply shortly.`,
      data: { ticketId: ticket.id, reference: ticket.reference },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'CREATE',
      entity: 'SupportTicket',
      entityId: ticket.id,
      summary: `${user.role} raised ticket ${ticket.reference} (${input.category}).`,
    });

    return toSupportTicket(ticket as TicketRecord, {
      includeInternal: user.role === 'ADMIN',
      bookingReference: bookingId ? await this.bookingReference(bookingId) : null,
    });
  }

  /** Staff see the whole queue; everyone else sees only what they raised. */
  async list(user: AuthenticatedUser, query: ListTicketsQueryInput): Promise<Paginated<SupportTicket>> {
    const paging = resolvePagination(query);
    const where: Prisma.SupportTicketWhereInput = {
      ...(user.role === 'ADMIN' ? {} : { createdByUserId: user.id }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: ticketInclude,
        orderBy: { createdAt: 'desc' },
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    const references = await this.bookingReferences(
      records.map((record) => record.bookingId).filter((id): id is string => id !== null),
    );
    const includeInternal = user.role === 'ADMIN';

    return paginate(
      records.map((record) =>
        toSupportTicket(record as TicketRecord, {
          includeInternal,
          bookingReference: record.bookingId ? (references.get(record.bookingId) ?? null) : null,
        }),
      ),
      total,
      paging,
    );
  }

  async get(user: AuthenticatedUser, ticketId: string): Promise<SupportTicket> {
    const ticket = await this.requireTicket(ticketId);
    if (user.role !== 'ADMIN' && ticket.createdByUserId !== user.id) {
      // The same not-found answer as a missing ticket: a stranger learns nothing either way.
      throw AppError.notFound('That support ticket was not found.');
    }

    return toSupportTicket(ticket, {
      includeInternal: user.role === 'ADMIN',
      bookingReference: ticket.bookingId ? await this.bookingReference(ticket.bookingId) : null,
    });
  }

  async addMessage(
    user: AuthenticatedUser,
    ticketId: string,
    input: AddTicketMessageInput,
  ): Promise<SupportTicket> {
    const ticket = await this.requireTicket(ticketId);
    const isStaff = user.role === 'ADMIN';
    if (!isStaff && ticket.createdByUserId !== user.id) {
      throw AppError.notFound('That support ticket was not found.');
    }
    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw AppError.conflict(
        'INVALID_STATUS_TRANSITION',
        'This ticket is closed. Please raise a new request so we can help.',
      );
    }

    await this.prisma.supportTicketMessage.create({
      data: {
        ticketId,
        authorUserId: user.id,
        authorRole: user.role,
        body: input.body,
        // Customer-facing replies are never internal; staff notes come from the admin surface.
        isInternal: false,
      },
    });

    if (isStaff) {
      // A staff reply hands the conversation back to the customer.
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: SupportTicketStatus.WAITING_CUSTOMER },
      });
      await this.notifications.notify({
        userId: ticket.createdByUserId,
        type: NotificationType.SUPPORT_TICKET_UPDATE,
        title: `Reply on ticket ${ticket.reference}`,
        body: 'Our support team has replied to your request.',
        data: { ticketId, reference: ticket.reference },
      });
    } else if (ticket.status === SupportTicketStatus.WAITING_CUSTOMER) {
      // The customer answered, so the ticket is back with operations.
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: SupportTicketStatus.IN_PROGRESS },
      });
    }

    return this.get(user, ticketId);
  }

  private async requireTicket(ticketId: string): Promise<TicketRecord> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: ticketInclude,
    });
    if (!ticket) throw AppError.notFound('That support ticket was not found.');
    return ticket as TicketRecord;
  }

  /** A customer may only attach their own booking; a partner may only attach one of their jobs. */
  private async assertBookingAccess(user: AuthenticatedUser, bookingId: string): Promise<void> {
    if (user.role === 'CUSTOMER') {
      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, customerId: user.id },
        select: { id: true },
      });
      if (!booking) throw AppError.notFound('That booking was not found on your account.');
      return;
    }

    if (user.role === 'PARTNER') {
      const assignment = await this.prisma.partnerAssignment.findFirst({
        where: { bookingId, partner: { userId: user.id } },
        select: { id: true },
      });
      if (!assignment) throw AppError.forbidden('That booking is not one of your jobs.');
    }
  }

  /**
   * Tickets store a bare booking id, so references are resolved in one query per page rather
   * than one per row.
   */
  private async bookingReferences(bookingIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(bookingIds)];
    if (unique.length === 0) return new Map();

    const bookings = await this.prisma.booking.findMany({
      where: { id: { in: unique } },
      select: { id: true, reference: true },
    });
    return new Map(bookings.map((booking) => [booking.id, booking.reference]));
  }

  private async bookingReference(bookingId: string): Promise<string | null> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { reference: true },
    });
    return booking?.reference ?? null;
  }
}
