import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Coupon, CouponValidationResult } from '@autowra/shared-types';
import { validateCouponSchema, type ValidateCouponInput } from '@autowra/validation';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { zodBody } from '../../common/zod-validation.pipe';
import { CouponsService } from '../coupons/coupons.service';
import { PricingService } from './pricing.service';

@ApiTags('coupons')
@ApiBearerAuth()
@Controller('coupons')
export class CouponsController {
  constructor(
    private readonly pricing: PricingService,
    private readonly coupons: CouponsService,
  ) {}

  /** Checks a code against the customer's actual basket before they commit. */
  @Roles('CUSTOMER')
  @Post('validate')
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(validateCouponSchema)) input: ValidateCouponInput,
  ): Promise<CouponValidationResult> {
    return this.pricing.validateCoupon(user.id, input);
  }

  /** Live offers shown on the home screen and in the offers screen. */
  @Roles('CUSTOMER')
  @Get('mine')
  async mine(): Promise<{ items: Coupon[] }> {
    return { items: await this.coupons.listActive() };
  }
}
