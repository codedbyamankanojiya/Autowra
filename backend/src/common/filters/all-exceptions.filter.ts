import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiErrorCode, type ApiErrorBody } from '@autowra/shared-types';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../app-error';

type ErrorWithStatus = Error & { status?: number; code?: string };

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const body = this.toErrorBody(exception, request.requestId);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode} ${body.code}: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown, requestId?: string): ApiErrorBody {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        requestId,
      };
    }

    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ApiErrorCode.VALIDATION_FAILED,
        message: 'The submitted data is not valid.',
        details: exception.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
        requestId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { statusCode: status, code: mapStatusToCode(status), message: payload, requestId };
      }
      const record = payload as Record<string, unknown>;
      const message = record['message'];
      return {
        statusCode: status,
        code: typeof record['code'] === 'string' ? (record['code'] as ApiErrorCode) : mapStatusToCode(status),
        message: Array.isArray(message)
          ? message.join(', ')
          : typeof message === 'string'
            ? message
            : exception.message,
        details: Array.isArray(record['details'])
          ? (record['details'] as Array<{ path: string; message: string }>)
          : undefined,
        requestId,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception, requestId);
    }

    // Unknown failures never leak internals to the client.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong on our side. Please try again.',
      requestId,
    };
  }

  private fromPrismaError(error: Prisma.PrismaClientKnownRequestError, requestId?: string): ApiErrorBody {
    switch (error.code) {
      case 'P2002': {
        const target = error.meta?.['target'];
        const field = Array.isArray(target) ? target.join(', ') : String(target ?? 'value');
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ApiErrorCode.CONFLICT,
          message: `A record with the same ${field} already exists.`,
          requestId,
        };
      }
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: ApiErrorCode.NOT_FOUND,
          message: 'The requested record was not found.',
          requestId,
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: ApiErrorCode.VALIDATION_FAILED,
          message: 'A related record referenced by this request does not exist.',
          requestId,
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ApiErrorCode.INTERNAL_ERROR,
          message: 'A database error occurred while processing the request.',
          requestId,
        };
    }
  }
}

function mapStatusToCode(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ApiErrorCode.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ApiErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ApiErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ApiErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ApiErrorCode.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ApiErrorCode.RATE_LIMITED;
    default:
      return ApiErrorCode.INTERNAL_ERROR;
  }
}

/** Narrow helper used nowhere else but kept for readability in tests. */
export function isErrorWithStatus(error: unknown): error is ErrorWithStatus {
  return error instanceof Error;
}
