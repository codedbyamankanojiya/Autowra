import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Paginated, SupportTicket } from '@autowra/shared-types';
import {
  addTicketMessageSchema,
  createSupportTicketSchema,
  listTicketsQuerySchema,
  type AddTicketMessageInput,
  type CreateSupportTicketInput,
  type ListTicketsQueryInput,
} from '@autowra/validation';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { zodBody, zodQuery } from '../../common/zod-validation.pipe';
import { SupportService } from './support.service';

/**
 * The customer and partner help desk. Staff read and answer the same tickets through
 * `/admin/tickets`, which is permission-gated separately.
 */
@ApiTags('support')
@ApiBearerAuth()
@Roles('CUSTOMER', 'PARTNER')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('tickets')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createSupportTicketSchema)) input: CreateSupportTicketInput,
  ): Promise<SupportTicket> {
    return this.support.create(user, input);
  }

  @Get('tickets')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(listTicketsQuerySchema)) query: ListTicketsQueryInput,
  ): Promise<Paginated<SupportTicket>> {
    return this.support.list(user, query);
  }

  @Get('tickets/:ticketId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('ticketId') ticketId: string): Promise<SupportTicket> {
    return this.support.get(user, ticketId);
  }

  @Post('tickets/:ticketId/messages')
  addMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @Body(zodBody(addTicketMessageSchema)) input: AddTicketMessageInput,
  ): Promise<SupportTicket> {
    return this.support.addMessage(user, ticketId, input);
  }
}
