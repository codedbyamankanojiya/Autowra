import { Module } from '@nestjs/common';
import { CommissionService } from './commission.service';
import { LedgerService } from './ledger.service';
import { PayoutService } from './payout.service';

/**
 * Partner money: commission resolution, the earnings ledger and payouts.
 *
 * Kept in its own module because three different surfaces use it - the partner app reads
 * its earnings, the admin dashboard settles them, and the booking lifecycle writes the
 * entries when a job completes. Not `@Global()`: importing it explicitly keeps the money
 * dependency visible in each module that touches it.
 */
@Module({
  providers: [CommissionService, LedgerService, PayoutService],
  exports: [CommissionService, LedgerService, PayoutService],
})
export class FinanceModule {}
