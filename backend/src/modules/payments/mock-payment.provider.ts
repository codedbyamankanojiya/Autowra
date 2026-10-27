import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { PaymentProvider } from '@autowra/shared-types';
import type {
  CreateProviderOrderInput,
  ParsedWebhook,
  PaymentProviderAdapter,
  ProviderOrder,
  ProviderRefundInput,
  ProviderRefundResult,
  ProviderVerification,
  VerifyProviderPaymentInput,
  WebhookHeaders,
} from './payment-provider';

/**
 * Development payment adapter.
 *
 * It produces the same shapes as a real gateway so the app, the webhook pipeline and the
 * refund flow can all be exercised end to end, but it never contacts a network and never
 * moves money. Every payment it creates is flagged `isSimulated`, and `env.validation.ts`
 * refuses to boot production with this provider selected.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProviderAdapter {
  private readonly logger = new Logger(MockPaymentProvider.name);

  readonly name = PaymentProvider.MOCK;
  readonly isSimulated = true;

  constructor(private readonly displayName: string) {}

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    const providerOrderId = `mock_order_${input.paymentId.replace(/-/g, '').slice(0, 18)}`;
    this.logger.warn(
      `[simulated] order ${providerOrderId} for ${input.amountMinor} ${input.currency} (booking ${input.bookingReference})`,
    );
    return {
      providerOrderId,
      isSimulated: true,
      checkout: {
        keyId: null,
        orderId: providerOrderId,
        name: this.displayName,
        description: input.description,
        prefillPhone: input.customerPhone,
        prefillEmail: input.customerEmail,
        notes: { bookingReference: input.bookingReference, simulated: 'true' },
      },
    };
  }

  async verifyPayment(input: VerifyProviderPaymentInput): Promise<ProviderVerification> {
    if (!input.providerPaymentId) {
      return { verified: false, message: 'The simulated gateway did not return a payment id.' };
    }
    return {
      verified: true,
      message: 'Simulated payment confirmed. No real money was charged.',
    };
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    this.logger.warn(`[simulated] refund of ${input.amountMinor} for ${input.reason}`);
    return {
      providerRefundId: `mock_refund_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      status: 'COMPLETED',
      failureReason: null,
    };
  }

  /**
   * The simulated gateway still requires a shared secret when one is configured, so the
   * webhook plumbing (signature check, dedupe, retry) is genuinely exercised in development.
   */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
    if (!secret) return true;
    return safeEqual(createHash('sha256').update(`${secret}:${rawBody}`).digest('hex'), signature);
  }

  parseWebhook(rawBody: string, headers: WebhookHeaders): ParsedWebhook {
    const payload = safeParse(rawBody);
    const eventId =
      firstHeader(headers['x-mock-event-id']) ??
      (payload && typeof payload['eventId'] === 'string' ? payload['eventId'] : null) ??
      `mock_${createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`;

    const status = payload && typeof payload['status'] === 'string' ? payload['status'].toUpperCase() : '';
    return {
      eventId,
      eventType: payload && typeof payload['event'] === 'string' ? payload['event'] : `payment.${status || 'unknown'}`,
      providerOrderId: payload && typeof payload['orderId'] === 'string' ? payload['orderId'] : null,
      providerPaymentId: payload && typeof payload['paymentId'] === 'string' ? payload['paymentId'] : null,
      outcome: status === 'PAID' ? 'PAID' : status === 'FAILED' ? 'FAILED' : status === 'REFUNDED' ? 'REFUNDED' : 'IGNORED',
    };
  }
}

function safeParse(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function safeEqual(expected: string, received: string | null): boolean {
  if (!received) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
