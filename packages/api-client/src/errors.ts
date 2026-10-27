import type { ApiErrorBody } from '@autowra/shared-types';

/** Error thrown for every non-2xx API response. */
export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Array<{ path: string; message: string }>;
  readonly requestId: string | undefined;

  constructor(body: Partial<ApiErrorBody> & { message: string }) {
    super(body.message);
    this.name = 'ApiClientError';
    this.statusCode = body.statusCode ?? 0;
    this.code = body.code ?? 'INTERNAL_ERROR';
    this.details = body.details ?? [];
    this.requestId = body.requestId;
  }

  get isUnauthenticated(): boolean {
    return this.statusCode === 401;
  }

  get isForbidden(): boolean {
    return this.statusCode === 403;
  }

  get isNotFound(): boolean {
    return this.statusCode === 404;
  }

  get isConflict(): boolean {
    return this.statusCode === 409;
  }

  get isValidationError(): boolean {
    return this.statusCode === 422 || this.statusCode === 400;
  }

  get isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  get isNetworkError(): boolean {
    return this.statusCode === 0;
  }

  /** Field level messages keyed by path - convenient for react-hook-form. */
  get fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const detail of this.details) {
      const key = detail.path.split('.').pop() ?? detail.path;
      if (!result[key]) result[key] = detail.message;
    }
    return result;
  }
}

/** Raised when the request never reached the server (no connectivity, timeout). */
export class NetworkError extends ApiClientError {
  constructor(message = 'Could not reach the Autowra service. Check your connection and try again.') {
    super({ statusCode: 0, code: 'NETWORK_ERROR', message });
    this.name = 'NetworkError';
  }
}
