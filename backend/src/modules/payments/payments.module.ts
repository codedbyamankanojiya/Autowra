import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/configuration';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER_TOKEN, type PaymentProviderAdapter } from './payment-provider';
import { PaymentWebhooksController, PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayPaymentProvider } from './razorpay-payment.provider';

/**
 * Payments.
 *
 * `PAYMENT_PROVIDER` selects the adapter once at boot; nothing below this module knows which
 * one is active. The mock adapter is constructed by hand because it carries the display name
 * shown inside the checkout sheet. `RazorpayPaymentProvider` fails loudly when its keys are
 * missing rather than degrading to a simulated charge, and `validateEnv` refuses to boot
 * production with the mock selected.
 */
@Module({
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [
    PaymentsService,
    RazorpayPaymentProvider,
    {
      provide: PAYMENT_PROVIDER_TOKEN,
      inject: [AppConfigService, RazorpayPaymentProvider],
      useFactory: (config: AppConfigService, razorpay: RazorpayPaymentProvider): PaymentProviderAdapter =>
        config.payments.provider === 'razorpay' ? razorpay : new MockPaymentProvider('Autowra'),
    },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER_TOKEN],
})
export class PaymentsModule {}
