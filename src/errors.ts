import type { Response } from './http/response.js';

/**
 * Base class for every error thrown by the SDK.
 * Catch this to handle any Mulla failure in one place.
 */
export class MullaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The SDK was used incorrectly (bad configuration or arguments). Raised before any request is sent. */
export class InvalidArgumentError extends MullaError {}

/** A webhook signature was missing, invalid, or outside the allowed timestamp tolerance. */
export class SignatureVerificationError extends MullaError {}

/**
 * The API could not be reached (DNS, TLS, timeout, connection reset). No HTTP response was received.
 *
 * Check `requestMayHaveBeenSent`: when true (e.g. the response timed out), Mulla may have
 * processed the request. Verify the outcome before sending a write (charge, payout) again.
 */
export class ConnectionError extends MullaError {
  /** False only when the connection was never established, so Mulla cannot have seen the request. */
  readonly requestMayHaveBeenSent: boolean;

  constructor(message: string, options: { requestMayHaveBeenSent?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.requestMayHaveBeenSent = options.requestMayHaveBeenSent ?? true;
  }
}

export interface ApiErrorInit {
  statusCode: number;
  errorCode?: string | null;
  body?: Record<string, unknown> | null;
  headers?: Record<string, string>;
  rawBody?: string | null;
  cause?: unknown;
}

/** The Mulla API answered with an error status (4xx/5xx). */
export class ApiError extends MullaError {
  /** HTTP status code, e.g. 400. */
  readonly statusCode: number;
  /** Machine-readable Mulla error code, e.g. "INSUFFICIENT_BALANCE". */
  readonly errorCode: string | null;
  /** Decoded error body, if it was JSON. */
  readonly body: Record<string, unknown> | null;
  /** Response headers (lower-cased names). */
  readonly headers: Record<string, string>;
  readonly rawBody: string | null;

  constructor(message: string, init: ApiErrorInit) {
    super(message, { cause: init.cause });
    this.statusCode = init.statusCode;
    this.errorCode = init.errorCode ?? null;
    this.body = init.body ?? null;
    this.headers = init.headers ?? {};
    this.rawBody = init.rawBody ?? null;
  }
}

/** 400: the request was rejected (validation failed, minimum amount, bad parameters). */
export class InvalidRequestError extends ApiError {}

/** 401: missing, invalid, expired or revoked API key (or invalid checkout token). */
export class AuthenticationError extends ApiError {}

/** 403: the key lacks a scope, the IP is not allowed, the key environment does not match the server, or the merchant is not active. */
export class PermissionError extends ApiError {}

/** 404: the resource (charge, payout, invoice, customer...) does not exist for this merchant. */
export class NotFoundError extends ApiError {}

/** 409: the request conflicts with current state (e.g. payment already in progress, webhook already exists). */
export class ConflictError extends ApiError {}

/** 409 IDEMPOTENCY_KEY_*: this idempotency key was already used, or the original request is still in progress. Fetch the resource instead of retrying. */
export class IdempotencyError extends ConflictError {}

/** 429: too many requests. Wait `retryAfter` seconds before trying again. */
export class RateLimitError extends ApiError {
  /** Seconds to wait before retrying, when the server said so. */
  readonly retryAfter: number | null;

  constructor(message: string, init: ApiErrorInit & { retryAfter?: number | null }) {
    super(message, init);
    this.retryAfter = init.retryAfter ?? null;
  }
}

/** 5xx: Mulla had an internal error. */
export class ApiServerError extends ApiError {}

/** Extra guidance appended to the server message for common mistakes. */
const HINTS: Record<string, string> = {
  API_KEY_INVALID: 'Check that you are using a secret key (sk_...) that is active and not expired.',
  API_KEY_ENVIRONMENT_MISMATCH:
    'Test keys (sk_test_) only work on the sandbox server and live keys (sk_live_) only on production. Check your key and baseUrl.',
  API_KEY_SCOPE_DENIED: 'This API key is missing the scope required by this endpoint. Add it in the Mulla dashboard.',
  API_KEY_IP_DENIED: "This server's IP address is not in the key's allowed IP list.",
  MERCHANT_PENDING_REVIEW: 'Your merchant account is still under review by Mulla.',
  IDEMPOTENCY_KEY_CONFLICT:
    'This idempotency key was already used. Fetch the existing resource instead of re-sending the request.',
  VALIDATION_FAILED: 'One or more parameters are invalid. Unknown fields are rejected too.',
};

/**
 * Factory: turns an error HTTP response into the most specific error class,
 * so callers can `catch (e) { if (e instanceof NotFoundError) ... }` instead of inspecting status codes.
 */
export function errorFromResponse(response: Response): ApiError {
  const status = response.statusCode;
  const json = response.json();
  const body = json !== null && !Array.isArray(json) ? json : null;
  const errorCode = typeof body?.errorCode === 'string' ? body.errorCode : null;
  const message = buildMessage(status, errorCode, body);
  const init: ApiErrorInit = {
    statusCode: status,
    errorCode,
    body,
    headers: response.headers,
    rawBody: response.body,
  };

  if (status === 400) return new InvalidRequestError(message, init);
  if (status === 401) return new AuthenticationError(message, init);
  if (status === 403) return new PermissionError(message, init);
  if (status === 404) return new NotFoundError(message, init);
  if (status === 409 && errorCode?.startsWith('IDEMPOTENCY_KEY')) return new IdempotencyError(message, init);
  if (status === 409) return new ConflictError(message, init);
  if (status === 429) return new RateLimitError(message, { ...init, retryAfter: retryAfter(response, body) });
  if (status >= 500) return new ApiServerError(message, init);

  return new ApiError(message, init);
}

function buildMessage(status: number, errorCode: string | null, body: Record<string, unknown> | null): string {
  let serverMessage: unknown = body?.message;
  if (Array.isArray(serverMessage)) {
    serverMessage = serverMessage.map(String).join('; ');
  }
  if (typeof serverMessage !== 'string' || serverMessage === '') {
    serverMessage = `Mulla API request failed with HTTP ${status}`;
  }

  let message = errorCode !== null ? `[${errorCode}] ${serverMessage as string}` : (serverMessage as string);
  const hint = errorCode !== null ? HINTS[errorCode] : undefined;
  if (hint !== undefined) {
    message += ` — ${hint}`;
  }

  return message;
}

function retryAfter(response: Response, body: Record<string, unknown> | null): number | null {
  const header = response.header('retry-after');
  if (header !== null && isNumeric(header)) {
    return Math.trunc(Number(header));
  }
  const fromBody = body?.retryAfter;
  if ((typeof fromBody === 'number' || typeof fromBody === 'string') && isNumeric(String(fromBody))) {
    return Math.trunc(Number(fromBody));
  }

  return null;
}

/** @internal */
export function isNumeric(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value));
}
