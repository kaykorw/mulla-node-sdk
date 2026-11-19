import { ConnectionError, isNumeric } from '../errors.js';
import type { Request } from './request.js';
import type { Response } from './response.js';

export interface RetryStrategy {
  shouldRetry(request: Request, attempt: number, response: Response | null, error: unknown): boolean;

  /** Milliseconds to wait before the next attempt. */
  delay(attempt: number, response: Response | null): number;
}

export interface ExponentialBackoffOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];
const NOT_PROCESSED_STATUSES = [429, 503];

/**
 * Default strategy: exponential backoff with jitter, honouring Retry-After
 * (but giving up when the server asks to wait longer than maxDelay).
 *
 * Reads (GET) are retried on network errors, 408, 429 and 5xx.
 *
 * Writes (POST/PATCH) are retried ONLY when Mulla cannot have processed them:
 * the connection was never made, or the server answered 429/503 (rejected up front).
 * The API deletes the idempotency key when a request fails and does not replay
 * responses, so repeating a write after a timeout or 500 could create a second
 * charge or payout.
 */
export class ExponentialBackoff implements RetryStrategy {
  readonly maxRetries: number;
  readonly baseDelay: number;
  readonly maxDelay: number;
  readonly jitter: boolean;

  constructor(options: ExponentialBackoffOptions = {}) {
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelay = options.baseDelay ?? 500;
    this.maxDelay = options.maxDelay ?? 8000;
    this.jitter = options.jitter ?? true;
  }

  shouldRetry(request: Request, attempt: number, response: Response | null, error: unknown): boolean {
    if (attempt > this.maxRetries) {
      return false;
    }

    const safe = SAFE_METHODS.includes(request.method);

    if (response === null) {
      if (!(error instanceof ConnectionError)) {
        return false;
      }

      return safe || !error.requestMayHaveBeenSent;
    }

    const statuses = safe ? RETRYABLE_STATUSES : NOT_PROCESSED_STATUSES;
    if (!statuses.includes(response.statusCode)) {
      return false;
    }

    const retryAfter = retryAfterMs(response);

    return retryAfter === null || retryAfter <= this.maxDelay;
  }

  delay(attempt: number, response: Response | null): number {
    const retryAfter = response !== null ? retryAfterMs(response) : null;
    if (retryAfter !== null) {
      return retryAfter;
    }

    let delay = Math.min(this.maxDelay, this.baseDelay * 2 ** (attempt - 1));
    if (this.jitter) {
      delay *= 0.5 + Math.random() * 0.5;
    }

    return delay;
  }
}

function retryAfterMs(response: Response): number | null {
  const value = response.header('retry-after');

  return value !== null && isNumeric(value) ? Number(value) * 1000 : null;
}
