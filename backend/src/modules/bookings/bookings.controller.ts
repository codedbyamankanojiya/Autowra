import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  BookingDetail,
  BookingStatusResponse,
  CancelBookingResponse,
  CreateBookingResponse,
  ListBookingsResponse,
} from '@autowra/shared-types';
import {
  cancelBookingSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  rescheduleBookingSchema,
  type CancelBookingInput,
  type CreateBookingInput,
  type ListBookingsQueryInput,
  type RescheduleBookingInput,
} from '@autowra/validation';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { zodBody, zodQuery } from '../../common/zod-validation.pipe';
import { BookingsService } from './bookings.service';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /**
   * Creates a booking. The body carries selections only - service, vehicle, address, slot
   * and an idempotency key. Every amount is decided by the server.
   */
  @Roles('CUSTOMER')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createBookingSchema)) input: CreateBookingInput,
  ): Promise<CreateBookingResponse> {
    return this.bookings.create(user.id, input);
  }

  @Roles('CUSTOMER')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(listBookingsQuerySchema)) query: ListBookingsQueryInput,
  ): Promise<ListBookingsResponse> {
    return this.bookings.list(user.id, query);
  }

  /** Printable invoice; the customer app opens this URL in the device browser. */
  @Roles('CUSTOMER', 'ADMIN')
  @Get(':bookingId/invoice')
  @Header('Content-Type', 'text/html; charset=utf-8')
  invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<string> {
    return this.bookings.renderInvoice(user.id, bookingId, user.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER');
  }

  @Roles('CUSTOMER')
  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') bookingId: string,
  ): Promise<BookingDetail> {
    return this.bookings.getDetail(user.id, bookingId);
  }

  /** Lightweight polling endpoint for the tracking screen. */
  @Roles('CUSTOMER')
  @Get(':id/status')
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') bookingId: string,
  ): Promise<BookingStatusResponse> {
    return this.bookings.getStatus(user.id, bookingId);
  }

  @Roles('CUSTOMER')
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') bookingId: string,
    @Body(zodBody(cancelBookingSchema)) input: CancelBookingInput,
  ): Promise<CancelBookingResponse> {
    return this.bookings.cancel(user.id, bookingId, input);
  }

  @Roles('CUSTOMER')
  @Post(':id/reschedule')
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') bookingId: string,
    @Body(zodBody(rescheduleBookingSchema)) input: RescheduleBookingInput,
  ): Promise<BookingDetail> {
    return this.bookings.reschedule(user.id, bookingId, input);
  }
}
