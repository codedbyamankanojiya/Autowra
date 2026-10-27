import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for the process.
 *
 * Prisma 6 with the `prisma-client-js` generator keeps us on CommonJS, which is what the
 * NestJS build expects.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `work` inside a transaction with a serialisable-safe retry for the
   * write-conflict / deadlock errors PostgreSQL raises when two requests race for the
   * same availability slot.
   */
  async runWithRetry<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        lastError = error;
        if (!isRetryableWriteConflict(error) || attempt === attempts) throw error;
        this.logger.warn(`Retrying transaction after write conflict (attempt ${attempt})`);
        await sleep(25 * attempt);
      }
    }
    throw lastError;
  }
}

function isRetryableWriteConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034 = transaction failed due to a write conflict or a deadlock.
    return error.code === 'P2034';
  }
  const message = error instanceof Error ? error.message : '';
  return message.includes('could not serialize access');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
