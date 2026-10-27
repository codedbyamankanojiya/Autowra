import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigService } from '../../config/configuration';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.auth.accessSecret,
        signOptions: { expiresIn: config.auth.accessTtlSeconds },
      }),
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway, JwtModule],
})
export class RealtimeModule {}
