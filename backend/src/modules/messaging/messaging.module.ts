import { Global, Module } from '@nestjs/common';
import { PushService } from './push.service';
import { SmsService } from './sms.service';

@Global()
@Module({
  providers: [SmsService, PushService],
  exports: [SmsService, PushService],
})
export class MessagingModule {}
