import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/configuration';

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, string>;
}

export interface PushDeliveryResult {
  readonly delivered: number;
  /** Tokens the provider reported as invalid - the caller deactivates them. */
  readonly invalidTokens: string[];
}

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/**
 * Expo push adapter.
 *
 * Only the notification title/body and non-sensitive routing data are sent. Invalid tokens
 * reported by Expo are returned so `NotificationsService` can deactivate them instead of
 * retrying forever.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly config: AppConfigService) {}

  get provider(): string {
    return this.config.push.provider;
  }

  async send(tokens: string[], message: PushMessage): Promise<PushDeliveryResult> {
    if (tokens.length === 0) return { delivered: 0, invalidTokens: [] };

    if (this.config.push.provider !== 'expo') {
      this.logger.warn(`[dev-push] ${tokens.length} device(s): ${message.title} - ${message.body}`);
      return { delivered: 0, invalidTokens: [] };
    }

    const invalidTokens: string[] = [];
    let delivered = 0;

    // Expo accepts up to 100 messages per request.
    for (const batch of chunk(tokens, 100)) {
      try {
        const response = await fetch(EXPO_PUSH_ENDPOINT, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'accept-encoding': 'gzip, deflate',
            'content-type': 'application/json',
            ...(this.config.push.accessToken ? { authorization: `Bearer ${this.config.push.accessToken}` } : {}),
          },
          body: JSON.stringify(
            batch.map((to) => ({
              to,
              title: message.title,
              body: message.body,
              data: message.data ?? {},
              sound: 'default',
            })),
          ),
        });

        if (!response.ok) {
          this.logger.error(`Expo push endpoint returned ${response.status}`);
          continue;
        }

        const payload = (await response.json()) as { data?: Array<{ status?: string; details?: { error?: string } }> };
        payload.data?.forEach((ticket, index) => {
          if (ticket.status === 'ok') {
            delivered += 1;
          } else if (ticket.details?.error === 'DeviceNotRegistered') {
            const token = batch[index];
            if (token) invalidTokens.push(token);
          }
        });
      } catch (error) {
        this.logger.error('Expo push request failed', error as Error);
      }
    }

    return { delivered, invalidTokens };
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}
