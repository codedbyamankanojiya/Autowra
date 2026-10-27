import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AppConfigModule } from './config/config.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomersModule } from './modules/customers/customers.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { FinanceModule } from './modules/finance/finance.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PartnerModule } from './modules/partner/partner.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StorageModule } from './modules/storage/storage.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // Infrastructure. Each of these is @Global() so feature modules never re-import them.
    AppConfigModule,
    PrismaModule,
    SettingsModule,
    AuditModule,
    StorageModule,
    MessagingModule,
    RealtimeModule,
    NotificationsModule,

    // Rate limiting is the outermost gate for unauthenticated abuse (OTP requests).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),

    // Feature modules.
    AuthModule,
    CustomersModule,
    CatalogModule,
    PricingModule,
    PaymentsModule,
    BookingsModule,
    FinanceModule,
    PartnerModule,
    SubscriptionsModule,
    EngagementModule,
  ],
  providers: [
    // Order matters: authenticate first, then check role metadata.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
