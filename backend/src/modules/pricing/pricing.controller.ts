import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PriceQuoteResponse } from '@autowra/shared-types';
import { priceQuoteSchema, type PriceQuoteInput } from '@autowra/validation';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { zodBody } from '../../common/zod-validation.pipe';
import { PricingService } from './pricing.service';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /**
   * The single source of truth for an order total. The client sends selections,
   * never amounts, and receives a full breakdown it can render verbatim.
   */
  @Roles('CUSTOMER')
  @Post('quote')
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(priceQuoteSchema)) input: PriceQuoteInput,
  ): Promise<PriceQuoteResponse> {
    return this.pricing.quote(user.id, input);
  }
}
