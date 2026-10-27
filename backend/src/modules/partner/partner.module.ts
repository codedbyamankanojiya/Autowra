import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AssignmentService } from './assignment.service';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

/**
 * Partner app surface: onboarding, job lifecycle and earnings.
 *
 * `FinanceModule` is imported explicitly rather than made global so the money services are a
 * visible dependency of the partner module; the admin dashboard imports the same module for
 * commission rules, payouts and adjustments. `AssignmentService` is exported because the admin
 * module assigns jobs manually through the same offer machinery.
 */
@Module({
  imports: [FinanceModule],
  controllers: [PartnerController],
  providers: [PartnerService, AssignmentService],
  exports: [PartnerService, AssignmentService],
})
export class PartnerModule {}
