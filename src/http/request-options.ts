import { InvalidArgumentError } from '../errors.js';
import { isUuid } from '../support/uuid.js';

/**
 * Per-request overrides. Every service method accepts them as the last argument:
 *
 *     await mulla.charges.initiate(params, { idempotencyKey: order.mullaKey, lang: 'fr' });
 */
export interface RequestOptions {
  /** A UUID stored with your order and reused on your own retries. Generated for you when omitted. */
  idempotencyKey?: string;
  /** Language of API messages for this request: en, fr, rw, sw. */
  lang?: string;
  /** Timeout in milliseconds for this request. */
  timeout?: number;
  /** Extra headers for this request only. */
  headers?: Record<string, string>;
  /** Cancels the request (and its retries) when aborted. */
  signal?: AbortSignal;
}

const ALLOWED = ['idempotencyKey', 'lang', 'timeout', 'headers', 'signal'];

/** @internal */
export function validateRequestOptions(options: RequestOptions | undefined): RequestOptions {
  if (options === undefined || options === null) {
    return {};
  }
  const unknown = Object.keys(options).filter((key) => !ALLOWED.includes(key));
  if (unknown.length > 0) {
    throw new InvalidArgumentError(`Unknown request option(s): ${unknown.join(', ')}. Allowed: ${ALLOWED.join(', ')}.`);
  }
  if (options.idempotencyKey !== undefined && !isUuid(options.idempotencyKey)) {
    throw new InvalidArgumentError(
      'The "idempotencyKey" must be a UUID (e.g. uuidV4() or crypto.randomUUID()). Store it with your order so retries reuse it.',
    );
  }
  if (options.timeout !== undefined && !(options.timeout > 0)) {
    throw new InvalidArgumentError('The "timeout" request option must be a positive number of milliseconds.');
  }

  return options;
}
