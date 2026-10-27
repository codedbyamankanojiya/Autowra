import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { PaymentProvider, type RefundStatus } from '@autowra/shared-types';
import { AppError } from '../../common/app-error';
// Value import: `emitDecoratorMetadata` needs the class reference for constructor injection.
import { AppConfigService } from '../../config/configuration';
import { safeEqual } from './mock-payment.provider';
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

const RAZORPAY_API = 'https://api.razorpay.com/v1';

/**
 * Razorpay adapter.
 *
 * This is the only adapter that moves real money. When the keys are missing it fails loudly
 * with `PAYMENT_NOT_CONFIGURED` instead of quietly degrading to a simulated charge, and
 * `env.validation.ts` refuses to boot production with the mock provider selected.
 */
@Injectable()
export class RazorpayPaymentProvider implements PaymentProviderAdapter {
  private readonly logger = new Logger(RazorpayPaymentProvider.name);

  readonly name = PaymentProvider.RAZORPAY;
  readonly isSimulated = false;

  constructor(private readonly config: AppConfigService) {}

  get isConfigured(): boolean {
    const { keyId, keySecret } = this.config.payments.razorpay;
    return Boolean(keyId && keySecret);
  }

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    const { keyId } = this.requireCredentials();

    const order = await this.request<{ id: string }>('POST', '/orders', {
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.bookingReference,
      notes: { bookingReference: input.bookingReference, paymentId: input.paymentId },
    });

    return {
      providerOrderId: order.id,
      isSimulated: false,
      checkout: {
        keyId,
        orderId: order.id,
        name: 'Autowra',
        description: input.description,
        prefillPhone: input.customerPhone,
        prefillEmail: input.customerEmail,
        notes: { bookingReference: input.bookingReference },
      },
    };
  }

  verifyPayment(input: VerifyProviderPaymentInput): Promise<ProviderVerification> {
    const { keySecret } = this.requireCredentials();
    if (!input.providerOrderId || !input.providerPaymentId || !input.signature) {
      return Promise.resolve({ verified: false, message: 'The payment signature is incomplete.' });
    }

    // Razorpay signs `<order_id>|<payment_id>` with the key secret.
    const expected = createHmac('sha256', keySecret)
      .update(`${input.providerOrderId}|${input.providerPaymentId}`)
      .digest('hex');
    if (!safeEqual(expected, input.signature)) {
      return Promise.resolve({ verified: false, message: 'The payment signature could not be verified.' });
    }
    return Promise.resolve({ verified: true, message: 'Payment verified with the gateway.' });
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    this.requireCredentials();
    if (!input.providerPaymentId) {
      return {
        providerRefundId: null,
        status: 'FAILED',
        failureReason: 'The original payment has no gateway payment id to refund.',
      };
    }

    try {
      const refund = await this.request<{ id: string; status: string }>(
        'POST',
        `/payments/${input.providerPaymentId}/refund`,
        { amount: input.amountMinor, notes: { reason: input.reason }, speed: 'normal' },
      );
      return {
        providerRefundId: refund.id,
        status: mapRefundStatus(refund.status),
        failureReason: refund.status === 'failed' ? 'The gateway rejected the refund.' : null,
      };
    } catch (error) {
      this.logger.error('Razorpay refund request failed', error as Error);
      return {
        providerRefundId: null,
        status: 'FAILED',
        failureReason: 'The gateway could not process the refund. Our team will retry manually.',
      };
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    const secret = this.config.payments.razorpay.webhookSecret;
    if (!secret) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }

  parseWebhook(rawBody: string, headers: WebhookHeaders): ParsedWebhook {
    const payload = safeParse(rawBody);
    const event = typeof payload?.['event'] === 'string' ? (payload['event'] as string) : 'unknown';
    const entity = extractEntity(payload);

    const providerPaymentId = typeof entity?.['id'] === 'string' ? (entity['id'] as string) : null;
    const providerOrderId = typeof entity?.['order_id'] === 'string' ? (entity['order_id'] as string) : null;
    const status = typeof entity?.['status'] === 'string' ? (entity['status'] as string) : '';

    // Razorpay retries the same event; the header id is the only stable dedupe key when the
    // payload is re-serialised. Falls back to a content hash so retries still collapse.
    const headerEventId = firstHeader(headers['x-razorpay-event-id']);
    const eventId =
      headerEventId ??
      `${event}:${providerPaymentId ?? providerOrderId ?? 'unknown'}:${status || createHash('sha256').update(rawBody).digest('hex').slice(0, 24)}`;

    return {
      eventId,
      eventType: event,
      providerOrderId,
      providerPaymentId,
      outcome: mapWebhookOutcome(event, status),
    };
  }

  private requireCredentials(): { keyId: string; keySecret: string } {
    const { keyId, keySecret } = this.config.payments.razorpay;
    if (!keyId || !keySecret) {
      throw AppError.badRequest(
        'PAYMENT_NOT_CONFIGURED',
        'Online payments are not configured on this server. Please contact support or choose cash on service.',
      );
    }
    return { keyId, keySecret };
  }

  private async request<T>(method: 'POST' | 'GET', path: string, body?: unknown): Promise<T> {
    const { keyId, keySecret } = this.requireCredentials();
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const response = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Razorpay ${method} ${path} failed with ${response.status}: ${detail.slice(0, 400)}`);
      throw AppError.badRequest('PAYMENT_NOT_CONFIGURED', 'The payment gateway rejected the request. Please try again.');
    }

    return (await response.json()) as T;
  }
}

function mapRefundStatus(status: string): RefundStatus {
  if (status === 'processed') return 'COMPLETED';
  if (status === 'pending') return 'PROCESSING';
  return 'FAILED';
}

function mapWebhookOutcome(event: string, status: string): ParsedWebhook['outcome'] {
  if (event.startsWith('refund')) return 'REFUNDED';
  if (event === 'payment.failed' || status === 'failed') return 'FAILED';
  if (event === 'payment.captured' || event === 'payment.authorized' || status === 'captured') return 'PAID';
  return 'IGNORED';
}

function extractEntity(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const container = payload?.['payload'];
  if (typeof container !== 'object' || container === null) return null;
  for (const key of ['payment', 'refund']) {
    const entry = (container as Record<string, unknown>)[key];
    if (typeof entry === 'object' && entry !== null) {
      const entity = (entry as Record<string, unknown>)['entity'];
      if (typeof entity === 'object' && entity !== null) return entity as Record<string, unknown>;
    }
  }
  return null;
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
