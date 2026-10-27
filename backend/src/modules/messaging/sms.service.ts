import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/configuration';

export interface SmsDeliveryResult {
  readonly delivered: boolean;
  readonly channel: 'sms' | 'console' | 'disabled';
  readonly message: string;
}

/**
 * SMS adapter.
 *
 * `console` is the development driver: it writes the message to the backend log so the OTP
 * flow can be exercised without an SMS account. `http` posts to a configured gateway and is
 * only selected when credentials are present, so we never pretend a message was sent.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: AppConfigService) {}

  async sendOtp(phone: string, code: string): Promise<SmsDeliveryResult> {
    const { provider, apiKey, senderId, templateId } = this.config.sms;
    if (provider === 'http' && apiKey) {
      return this.sendOverHttp(phone, code, apiKey, senderId, templateId);
    }
    this.logger.warn(`[dev-sms] OTP for ${phone} is ${code} (no SMS provider configured)`);
    return {
      delivered: false,
      channel: 'console',
      message: 'No SMS provider is configured, so the code was written to the server log.',
    };
  }

  private async sendOverHttp(
    phone: string,
    code: string,
    apiKey: string,
    senderId: string,
    templateId: string | undefined,
  ): Promise<SmsDeliveryResult> {
    // A generic transactional-SMS gateway contract: override the URL for your provider.
    const endpoint = process.env['SMS_GATEWAY_URL'] ?? 'https://api.sms-gateway.example/v1/messages';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          to: phone,
          sender: senderId,
          templateId,
          variables: { code },
          message: `Your Autowra verification code is ${code}. It expires in a few minutes.`,
        }),
      });
      if (!response.ok) {
        this.logger.error(`SMS gateway rejected the request with status ${response.status}`);
        return { delivered: false, channel: 'sms', message: 'The SMS could not be delivered right now.' };
      }
      return { delivered: true, channel: 'sms', message: 'Verification code sent by SMS.' };
    } catch (error) {
      this.logger.error('SMS gateway request failed', error as Error);
      return { delivered: false, channel: 'sms', message: 'The SMS could not be delivered right now.' };
    }
  }
}
