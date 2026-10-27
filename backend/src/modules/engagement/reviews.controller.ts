import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Paginated, Review } from '@autowra/shared-types';
import {
  createReviewSchema,
  listReviewsQuerySchema,
  type CreateReviewInput,
  type ListReviewsQueryInput,
} from '@autowra/validation';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { zodBody, zodQuery } from '../../common/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Public: the rating shown next to a service before anyone signs in. */
  @Public()
  @Get()
  list(@Query(zodQuery(listReviewsQuerySchema)) query: ListReviewsQueryInput): Promise<Paginated<Review>> {
    return this.reviews.list(query);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createReviewSchema)) input: CreateReviewInput,
  ): Promise<{ success: boolean }> {
    return this.reviews.create(user.id, input);
  }
}
