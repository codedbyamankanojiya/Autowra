import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates and normalises a request segment (body, query or params) with a Zod schema
 * from `@autowra/validation`, so the API and the mobile/admin clients share one contract.
 *
 * `validateEnv`-style error reporting is handled by `AllExceptionsFilter`, which turns a
 * `ZodError` into the standard `ApiErrorBody` with per-field details.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value ?? {});
  }
}

export const zodBody = <T>(schema: ZodType<T>) => new ZodValidationPipe<T>(schema);
export const zodQuery = <T>(schema: ZodType<T>) => new ZodValidationPipe<T>(schema);
export const zodParam = <T>(schema: ZodType<T>) => new ZodValidationPipe<T>(schema);
