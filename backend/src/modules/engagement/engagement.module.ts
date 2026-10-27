import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  controllers: [ReviewsController, SupportController],
  providers: [ReviewsService, SupportService],
  exports: [ReviewsService, SupportService],
})
export class EngagementModule {}
