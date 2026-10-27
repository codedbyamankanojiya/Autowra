import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BookingStatus, type Paginated, type Review } from '@autowra/shared-types';
import type { CreateReviewInput, ListReviewsQueryInput } from '@autowra/validation';
import { AppError } from '../../common/app-error';
import { paginate, resolvePagination } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { reviewInclude, toReview, type ReviewRecord } from './engagement.mapper';

/**
 * Customer feedback.
 *
 * A review is always derived from a completed booking the caller owns - the rating cannot be
 * attached to someone else's job, and `Review.bookingId` is unique so one booking is reviewed
 * at most once. The partner's public rating is a projection of these rows and is recomputed
 * here rather than incremented, so it can never drift from the reviews behind it.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(customerId: string, input: CreateReviewInput): Promise<{ success: boolean }> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: input.bookingId, customerId },
      include: {
        review: { select: { id: true } },
        assignments: {
          where: { status: 'ACCEPTED' },
          select: { partnerId: true },
          orderBy: { offeredAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!booking) throw AppError.notFound('That booking was not found.');

    if (booking.status !== BookingStatus.COMPLETED) {
      throw AppError.badRequest('VALIDATION_FAILED', 'You can review a booking once the service is complete.');
    }
    if (booking.review) {
      throw AppError.conflict('DUPLICATE_REQUEST', 'You have already reviewed this booking.');
    }

    const partnerId = booking.assignments[0]?.partnerId ?? null;
    try {
      await this.prisma.review.create({
        data: {
          bookingId: booking.id,
          customerId,
          partnerId,
          rating: input.rating,
          comment: input.comment?.trim() || null,
        },
      });
    } catch (error) {
      // Two taps from the same device can both pass the read above; the unique index is the
      // real guard, so the loser reports the same friendly conflict.
      if (isUniqueViolation(error)) {
        throw AppError.conflict('DUPLICATE_REQUEST', 'You have already reviewed this booking.');
      }
      throw error;
    }

    if (partnerId) await this.refreshPartnerRating(partnerId);

    await this.audit.record({
      actorUserId: customerId,
      actorRole: 'CUSTOMER',
      action: 'CREATE',
      entity: 'Review',
      entityId: booking.id,
      summary: `Booking ${booking.reference} was rated ${input.rating}/5.`,
      metadata: { rating: input.rating, partnerId },
    });

    return { success: true };
  }

  /**
   * Public review feed, used by the service pages and the home screen.
   *
   * The rows carry only a display name, a booking reference and the comment - never a phone
   * number or an address - so this can stay unauthenticated.
   */
  async list(query: ListReviewsQueryInput): Promise<Paginated<Review>> {
    const where: Prisma.ReviewWhereInput = {
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      // A review belongs to a booking, and the booking carries the services that were sold.
      ...(query.serviceId ? { booking: { items: { some: { serviceId: query.serviceId } } } } : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        include: reviewInclude,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.review.count({ where }),
    ]);

    return paginate(
      records.map((record) => toReview(record as ReviewRecord)),
      total,
      resolvePagination({ page: 1, pageSize: query.limit }),
    );
  }

  /** Recomputes the partner's aggregate from the reviews themselves. */
  private async refreshPartnerRating(partnerId: string): Promise<void> {
    const aggregate = await this.prisma.review.aggregate({
      where: { partnerId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await this.prisma.partnerProfile.update({
      where: { id: partnerId },
      data: {
        rating: aggregate._avg.rating ?? 0,
        ratingCount: aggregate._count._all,
      },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return true;
  const message = error instanceof Error ? error.message : '';
  return message.includes('Unique constraint');
}
