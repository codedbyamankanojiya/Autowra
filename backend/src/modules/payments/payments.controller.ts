import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Headers,
  Logger,
  Param,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { CreatePaymentOrderResult, Paginated, Refund, VerifyPaymentResult } from '@autowra/shared-types';
import {
  createPaymentOrderSchema,
  simulatePaymentSchema,
  verifyPaymentSchema,
  type SimulatePaymentInput,
  type VerifyPaymentInput,
} from '@autowra/validation';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { zodBody } from '../../common/zod-validation.pipe';
import { AppConfigService } from '../../config/configuration';
import { PaymentsService, type PaymentRow } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Opens (or re-opens) the gateway order for a booking that is waiting for payment.
   * The client sends only the booking id; the amount always comes from the booking row.
   */
  @Roles('CUSTOMER')
  @Post('create-order')
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createPaymentOrderSchema)) input: { bookingId: string },
  ): Promise<CreatePaymentOrderResult> {
    return this.payments.openOrder(user.id, input.bookingId);
  }

  /** Confirms a gateway payment and, when it succeeds, confirms the booking. */
  @Roles('CUSTOMER')
  @Post('verify')
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(verifyPaymentSchema)) input: VerifyPaymentInput,
  ): Promise<VerifyPaymentResult> {
    return this.payments.verify(user.id, input);
  }

  /**
   * Development-only stand-in for the gateway checkout. Rejected unless the server is
   * running in development with the mock provider, so it can never mark a real payment paid.
   */
  @Roles('CUSTOMER')
  @Post('dev/simulate')
  simulate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(simulatePaymentSchema)) input: SimulatePaymentInput,
  ): Promise<VerifyPaymentResult> {
    return this.payments.simulate(input.paymentId, input.outcome, user.id);
  }

  /**
   * The page `mockCheckoutUrl` points at, so a developer can confirm a simulated payment
   * from a browser without a session. Development and mock provider only.
   */
  @Public()
  @ApiExcludeEndpoint()
  @Get('dev/simulate')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async devCheckoutPage(
    @Query('paymentId') paymentId?: string,
    @Query('outcome') outcome?: string,
  ): Promise<string> {
    if (!this.config.app.isDevelopment || !this.payments.isSimulated) {
      return devPage('Simulated payments are unavailable', 'This server does not run the development payment mock.');
    }
    if (!paymentId) {
      return devPage('Missing payment', 'Add a paymentId query parameter to this URL.');
    }
    if (outcome !== 'success' && outcome !== 'failure') {
      return devPage(
        'Simulated checkout',
        'Choose an outcome for this simulated payment.',
        [
          { label: 'Confirm payment (no real money)', href: `?paymentId=${encodeURIComponent(paymentId)}&outcome=success` },
          { label: 'Decline payment', href: `?paymentId=${encodeURIComponent(paymentId)}&outcome=failure` },
        ],
      );
    }

    try {
      const result = await this.payments.simulate(paymentId, outcome);
      return devPage(
        result.verified ? 'Simulated payment confirmed' : 'Simulated payment declined',
        `${result.message} ${describeTarget(result)}`,
      );
    } catch (error) {
      return devPage(
        'Simulated payment failed',
        error instanceof Error ? error.message : 'The simulated payment could not be processed.',
      );
    }
  }

  @Roles('CUSTOMER')
  @Get('mine')
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: { page?: number; pageSize?: number },
  ): Promise<Paginated<PaymentRow>> {
    return this.payments.listForCustomer(user.id, query);
  }

  @Roles('CUSTOMER')
  @Get('refunds')
  listRefunds(@CurrentUser() user: AuthenticatedUser): Promise<{ items: Refund[] }> {
    return this.payments.listRefundsForCustomer(user.id);
  }
}

/**
 * Gateway callbacks.
 *
 * Separate controller because the raw request body must reach the signature check untouched.
 * `NestFactory.create(..., { rawBody: true })` in `main.ts` keeps it available as
 * `req.rawBody`.
 */
@ApiTags('payments')
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  private readonly logger = new Logger(PaymentWebhooksController.name);

  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: boolean; duplicate: boolean; outcome: string }> {
    // Prefer the untouched bytes; a re-serialised body would break the HMAC.
    const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {});
    const result = await this.payments.handleWebhook(provider, rawBody, headers);
    if (result.duplicate) {
      this.logger.debug(`Ignored duplicate ${provider} webhook`);
    }
    return result;
  }
}

function devPage(title: string, message: string, links: { label: string; href: string }[] = []): string {
  const anchors = links
    .map((link) => `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; margin: 0; padding: 32px; color: #14181f; background: #f4f6f9;">
<main style="max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #dfe4eb; border-radius: 12px; padding: 24px;">
<h1 style="font-size: 18px; margin: 0 0 8px;">${escapeHtml(title)}</h1>
<p style="margin: 0 0 16px; color: #5a6472; font-size: 14px;">${escapeHtml(message)}</p>
${anchors}
<p style="margin: 16px 0 0; color: #8a94a3; font-size: 12px;">Development only. No real money moves.</p>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A payment settles either a booking or a plan purchase, so the page names whichever it is. */
function describeTarget(result: VerifyPaymentResult): string {
  if (result.booking) return `Booking ${result.booking.reference} is now "${result.booking.status}".`;
  if (result.subscription) {
    return `Plan "${result.subscription.planName}" is now "${result.subscription.status}".`;
  }
  return 'No booking or plan was affected.';
}
