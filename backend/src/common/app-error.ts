import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorCode } from '@autowra/shared-types';

/**
 * Business error carrying a machine readable `code` from the shared contract.
 * The exception filter turns it into the `ApiErrorBody` shape both clients expect.
 */
export class AppError extends HttpException {
  readonly code: ApiErrorCode;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Array<{ path: string; message: string }>,
  ) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }

  static badRequest(code: ApiErrorCode, message: string, details?: Array<{ path: string; message: string }>) {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static unauthenticated(message = 'Your session has expired. Please sign in again.') {
    return new AppError(ApiErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message = 'You do not have access to this resource.') {
    return new AppError(ApiErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static notFound(message = 'The requested resource was not found.') {
    return new AppError(ApiErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
  }

  static conflict(code: ApiErrorCode, message: string) {
    return new AppError(code, message, HttpStatus.CONFLICT);
  }

  static internal(message = 'Something went wrong on our side. Please try again.') {
    return new AppError(ApiErrorCode.INTERNAL_ERROR, message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
