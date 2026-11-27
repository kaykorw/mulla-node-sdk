import type { Response } from './http/response.js';

export class MullaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    // Pass `cause` only when there is one, or console output shows `[cause]: undefined`.
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
  }
}

export class InvalidArgumentError extends MullaError {}

export class SignatureVerificationError extends MullaError {}

export class ConnectionError extends MullaError {
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
  /** Overrides the hint the SDK picks from `errorCode`. */
  hint?: string | null;
  cause?: unknown;
}

export class ApiError extends MullaError {
  readonly statusCode: number;
  readonly errorCode: string | null;
  /** How to fix the error, when the SDK knows. Kept out of `message`, which is the server's text as sent. */
  declare readonly hint: string | null;
  /** The parsed error response. */
  declare readonly body: Record<string, unknown> | null;
  declare readonly headers: Record<string, string>;
  declare readonly rawBody: string | null;

  constructor(message: string, init: ApiErrorInit) {
    super(message, { cause: init.cause });
    this.statusCode = init.statusCode;
    this.errorCode = init.errorCode ?? null;
    // Non-enumerable, so console.log(error) shows the message and codes instead of every response header.
    hide(this, {
      hint: init.hint !== undefined ? init.hint : this.errorCode !== null ? (HINTS[this.errorCode] ?? null) : null,
      body: init.body ?? null,
      headers: init.headers ?? {},
      rawBody: init.rawBody ?? null,
    });
  }
}

function hide(target: object, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(target, key, { value, enumerable: false, writable: false, configurable: true });
  }
}

export class InvalidRequestError extends ApiError {}

export class AuthenticationError extends ApiError {}

export class PermissionError extends ApiError {
  /** The scope the key is missing, for `API_KEY_SCOPE_DENIED`, when known. */
  readonly requiredScope: string | null;

  constructor(message: string, init: ApiErrorInit & { requiredScope?: string | null }) {
    super(message, init);
    this.requiredScope = init.requiredScope ?? null;
  }
}

export class NotFoundError extends ApiError {}

export class ConflictError extends ApiError {}

export class IdempotencyError extends ConflictError {}

export class RateLimitError extends ApiError {
  readonly retryAfter: number | null;

  constructor(message: string, init: ApiErrorInit & { retryAfter?: number | null }) {
    super(message, init);
    this.retryAfter = init.retryAfter ?? null;
  }
}

export class ApiServerError extends ApiError {}

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

export function errorFromResponse(response: Response): ApiError {
  const status = response.statusCode;
  const json = response.json();
  const body = json !== null && !Array.isArray(json) ? json : null;
  const errorCode = typeof body?.errorCode === 'string' ? body.errorCode : null;
  const message = buildMessage(status, body);
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

function buildMessage(status: number, body: Record<string, unknown> | null): string {
  let serverMessage: unknown = body?.message;
  if (Array.isArray(serverMessage)) {
    serverMessage = serverMessage.map(String).join('; ');
  }
  if (typeof serverMessage !== 'string' || serverMessage === '') {
    return `Mulla API request failed with HTTP ${status}`;
  }

  return serverMessage;
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

export function isNumeric(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value));
}
