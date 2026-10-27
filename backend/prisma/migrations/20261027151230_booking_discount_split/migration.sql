-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "couponDiscountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subscriptionCoverageMinor" INTEGER NOT NULL DEFAULT 0;
