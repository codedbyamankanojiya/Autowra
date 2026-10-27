import type { CreatePaymentOrderResult, PaymentProvider, RefundStatus } from '@autowra/shared-types';

/** Everything a gateway needs to open an order for a booking. */
export interface CreateProviderOrderInput {
  readonly paymentId: string;
  readonly bookingReference: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly description: string;
  readonly customerPhone: string;
  readonly customerEmail: string | null;
}

export interface ProviderOrder {
  readonly providerOrderId: string;
  readonly checkout: CreatePaymentOrderResult['checkout'];
  /** True when no real money moves; the UI must say so explicitly. */
  readonly isSimulated: boolean;
}

export interface VerifyProviderPaymentInput {
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly signature: string | null;
  readonly amountMinor: number;
}

export interface ProviderVerification {
  readonly verified: boolean;
  readonly message: string;
}

export interface ProviderRefundInput {
  readonly providerPaymentId: string | null;
  readonly amountMinor: number;
  readonly reason: string;
}

export interface ProviderRefundResult {
  readonly providerRefundId: string | null;
  readonly status: RefundStatus;
  readonly failureReason: string | null;
}

/** The subset of a gateway callback the payment pipeline needs. */
export interface ParsedWebhook {
  readonly eventId: string;
  readonly eventType: string;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly outcome: 'PAID' | 'FAILED' | 'REFUNDED' | 'IGNORED';
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

/** DI token for whichever gateway adapter `PAYMENT_PROVIDER` selects. */
export const PAYMENT_PROVIDER_TOKEN = 'Autowra_PAYMENT_PROVIDER';

/**
 * Adapter contract for a payment gateway.
 *
 * Only `RazorpayPaymentProvider` talks to a real gateway; the mock adapter exists so the
 * whole order -> verify -> refund pipeline can be exercised locally without ever moving
 * money. Nothing outside this module knows which adapter is active.
 */
export interface PaymentProviderAdapter {
  readonly name: PaymentProvider;
  /** Whether real money can move. Development must surface this to the user. */
  readonly isSimulated: boolean;

  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;
  verifyPayment(input: VerifyProviderPaymentInput): Promise<ProviderVerification>;
  refund(input: ProviderRefundInput): Promise<ProviderRefundResult>;
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  parseWebhook(rawBody: string, headers: WebhookHeaders): ParsedWebhook;
}
