import {
  DefaultEnvironmentResolver,
  environmentFromApiKey,
  type Environment,
  type EnvironmentResolver,
} from './environment.js';
import { InvalidArgumentError } from './errors.js';
import { defaultSleep, type Logger, type Middleware, type Sleep } from './http/middleware/index.js';
import { ExponentialBackoff, type RetryStrategy } from './http/retry.js';
import { FetchTransport, type FetchFunction, type Transport } from './http/transport.js';
import { env, INSPECT } from './support/runtime.js';
import { isUuidV4, uuidFromSeed } from './support/uuid.js';
import { PLATFORM } from './version.js';

export type Language = 'en' | 'fr' | 'rw' | 'sw';

export interface MullaOptions {
  /**
   * Gateway URL, e.g. "https://mfs.kayko.dev/gateway" ("/v1" is added if missing).
   * Default: MULLA_BASE_URL, else core.mulla.app (live keys) / mfs.kayko.dev (test keys).
   */
  baseUrl?: string;
  /** Total request timeout in milliseconds (default 30000). */
  timeout?: number;
  /** Retries for network errors, 429 and 5xx (default 2). 0 disables. */
  maxRetries?: number;
  /** Language for API messages. */
  lang?: Language;
  /** UUIDv4 sent as x-device-id. Defaults to a stable id derived from the key. */
  deviceId?: string;
  /** Your integration, appended to the User-Agent (e.g. "my-shop/1.2"). */
  appInfo?: string;
  /** Custom fetch, e.g. one using a proxy. Ignored when `transport` is set. */
  fetch?: FetchFunction;
  /** Custom HTTP adapter (default: FetchTransport). */
  transport?: Transport;
  /** Custom retry policy (overrides maxRetries). */
  retryStrategy?: RetryStrategy;
  /** console, pino, winston..., or fn(level, message, context). Keys and bodies are never logged. */
  logger?: Logger;
  /** Extra middleware, run around each attempt. */
  middleware?: Middleware[];
  /** Custom base URL resolution. */
  environmentResolver?: EnvironmentResolver;
  /** How the SDK waits between retries and polls (tests can pass a no-op). */
  sleep?: Sleep;
}

const ALLOWED_OPTIONS = [
  'baseUrl',
  'timeout',
  'maxRetries',
  'lang',
  'deviceId',
  'appInfo',
  'fetch',
  'transport',
  'retryStrategy',
  'logger',
  'middleware',
  'environmentResolver',
  'sleep',
];
const LANGUAGES = ['en', 'fr', 'rw', 'sw'];

/** Immutable client configuration, built from the options passed to MullaClient. */
export class MullaConfig {
  readonly environment: Environment;
  readonly baseUrl: string;
  readonly timeout: number;
  readonly lang: Language | null;
  readonly deviceId: string;
  readonly appInfo: string | null;
  readonly transport: Transport;
  readonly retryStrategy: RetryStrategy;
  readonly logger: Logger | null;
  readonly middleware: readonly Middleware[];
  readonly sleep: Sleep;
  readonly #apiKey: string;

  private constructor(apiKey: string, options: MullaOptions) {
    const unknown = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.includes(key));
    if (unknown.length > 0) {
      throw new InvalidArgumentError(
        `Unknown Mulla option(s): ${unknown.join(', ')}. Allowed: ${ALLOWED_OPTIONS.join(', ')}.`,
      );
    }

    this.#apiKey = apiKey.trim();
    this.environment = environmentFromApiKey(this.#apiKey);

    const resolver = options.environmentResolver ?? new DefaultEnvironmentResolver();
    assertMethod(resolver, 'resolveBaseUrl', 'environmentResolver');
    this.baseUrl = resolver.resolveBaseUrl(this.environment, options.baseUrl);

    if (options.lang !== undefined && !LANGUAGES.includes(options.lang)) {
      throw new InvalidArgumentError(
        `Unsupported lang "${String(options.lang)}". Use one of: ${LANGUAGES.join(', ')}.`,
      );
    }
    this.lang = options.lang ?? null;

    const deviceId = options.deviceId ?? uuidFromSeed(`${PLATFORM}:${keyId(this.#apiKey)}`);
    if (typeof deviceId !== 'string' || !isUuidV4(deviceId)) {
      throw new InvalidArgumentError('The "deviceId" option must be a UUID v4.');
    }
    this.deviceId = deviceId;

    const timeout = options.timeout ?? 30_000;
    if (typeof timeout !== 'number' || !(timeout > 0)) {
      throw new InvalidArgumentError('The "timeout" option must be a positive number of milliseconds.');
    }
    this.timeout = timeout;

    const maxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new InvalidArgumentError('The "maxRetries" option must be a whole number, 0 or more.');
    }

    this.transport = options.transport ?? new FetchTransport(options.fetch);
    assertMethod(this.transport, 'send', 'transport');

    this.retryStrategy = options.retryStrategy ?? new ExponentialBackoff({ maxRetries });
    assertMethod(this.retryStrategy, 'shouldRetry', 'retryStrategy');

    const middleware = options.middleware ?? [];
    if (!Array.isArray(middleware)) {
      throw new InvalidArgumentError('The "middleware" option must be an array.');
    }
    for (const layer of middleware) {
      if (typeof layer !== 'function') {
        assertMethod(layer, 'handle', 'middleware');
      }
    }
    this.middleware = Object.freeze([...middleware]);

    const logger = options.logger ?? null;
    if (logger !== null && typeof logger !== 'function') {
      for (const level of ['debug', 'info', 'warn', 'error']) {
        assertMethod(logger, level, 'logger');
      }
    }
    this.logger = logger;

    this.appInfo = options.appInfo ?? null;
    this.sleep = options.sleep ?? defaultSleep;
    if (typeof this.sleep !== 'function') {
      throw new InvalidArgumentError('The "sleep" option must be a function.');
    }
  }

  /**
   * @param apiKey your secret key; defaults to the MULLA_SECRET_KEY environment variable
   */
  static create(apiKey?: string, options: MullaOptions = {}): MullaConfig {
    const key = apiKey ?? env('MULLA_SECRET_KEY');
    if (key === undefined || typeof key !== 'string' || key.trim() === '') {
      throw new InvalidArgumentError(
        'No Mulla secret key. Pass it to new MullaClient("sk_test_...") or set the MULLA_SECRET_KEY environment variable.',
      );
    }

    return new MullaConfig(key, options ?? {});
  }

  /** @internal The secret key. Not a property, so it never shows up in logs or JSON. */
  apiKey(): string {
    return this.#apiKey;
  }

  /** e.g. "sk_test_AbC123_****" */
  maskedApiKey(): string {
    return `sk_${this.environment}_${keyId(this.#apiKey)}_****`;
  }

  toJSON(): Record<string, unknown> {
    return {
      apiKey: this.maskedApiKey(),
      environment: this.environment,
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      lang: this.lang,
      deviceId: this.deviceId,
      appInfo: this.appInfo,
    };
  }

  [INSPECT](): Record<string, unknown> {
    return this.toJSON();
  }
}

function keyId(apiKey: string): string {
  return apiKey.split('_')[2] ?? '';
}

function assertMethod(value: unknown, method: string, option: string): void {
  if (value === null || typeof value !== 'object' || typeof (value as Record<string, unknown>)[method] !== 'function') {
    throw new InvalidArgumentError(`The "${option}" option must have a ${method}() method.`);
  }
}
