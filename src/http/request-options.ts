import { InvalidArgumentError } from '../errors.js';
import { isUuid } from '../support/uuid.js';

export interface RequestOptions {
  idempotencyKey?: string;
  lang?: string;
  /** Timeout in milliseconds for this request. */
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const ALLOWED = ['idempotencyKey', 'lang', 'timeout', 'headers', 'signal'];

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
