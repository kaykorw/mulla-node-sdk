import {
  DefaultEnvironmentResolver,
  Environment,
  environmentFromApiKey,
  type EnvironmentResolver,
} from './environment.js';
import { Language } from './enums.js';
import { InvalidArgumentError } from './errors.js';
import { defaultSleep, type Logger, type Middleware, type Sleep } from './http/middleware/index.js';
import { ExponentialBackoff, type RetryStrategy } from './http/retry.js';
import { FetchTransport, type FetchFunction, type Transport } from './http/transport.js';
import { INSPECT } from './support/runtime.js';
import { isUuidV4, uuidFromSeed } from './support/uuid.js';
import { PLATFORM } from './version.js';

/** Identifies your integration in the User-Agent, e.g. `{ name: 'my-shop', version: '1.4.0' }`. */
export interface AppInfo {
  name: string;
  version?: string;
  url?: string;
}

/**
 * Options for `new MullaClient({...})`.
 *
 * The SDK never reads environment variables or `.env` files: pass every value explicitly
 * (for example `api_key: process.env.MULLA_SECRET_KEY`). `undefined`, `null` and `''` count as
 * "not set", so values read from an unset environment variable fall back to the defaults.
 */
export interface MullaOptions {
  /** Secret key, `sk_test_...` or `sk_live_...`. Required. */
  api_key: string | undefined;
  /**
   * Expected environment: `Environment.TEST` or `Environment.PRODUCTION`. The key prefix still decides
   * which server is called; this is a guard that fails fast if the key belongs to the other environment.
   */
  environment?: Environment;
  /** Gateway URL. Defaults to the official server for the key's environment. HTTPS only (http for local hosts). */
  base_url?: string | null | undefined;
  /** Endpoint secret used by `mulla.webhooks()` to verify incoming webhooks. */
  webhook_secret?: string | null | undefined;
  /** Your public webhook URL, used by `mulla.webhookEndpoint.create()` when no `url` is given. */
  webhook_url?: string | null | undefined;
  /** Total request timeout in milliseconds (default 30000). */
  timeout?: number;
  /** Extra attempts for requests that are safe to retry (default 2). */
  max_retries?: number;
  lang?: Language;
  /** UUID v4 sent as `x-device-id`. Defaults to a stable value derived from the key. */
  device_id?: string;
  app_info?: AppInfo;
  /** `console`, pino, winston, or `(level, message, context) => {}`. Secrets are never passed to it. */
  logger?: Logger;
  /** Custom `fetch` (e.g. with a proxy). Cannot be combined with `transport`. */
  fetch?: FetchFunction;
  /** Replaces the HTTP layer entirely (mostly for tests). Cannot be combined with `fetch`. */
  transport?: Transport;
  /** `(request, next) => next(request)` functions or `{ handle(request, next) }` objects. */
  middleware?: Middleware[];
  /** Advanced: replaces the default exponential backoff. Cannot be combined with `max_retries`. */
  retry_strategy?: RetryStrategy;
  /** Advanced: decides the base URL for an environment. */
  environment_resolver?: EnvironmentResolver;
  /** Advanced: how retries wait (tests pass a no-op). */
  sleep?: Sleep;
}

const ALLOWED_OPTIONS: readonly string[] = [
  'api_key',
  'environment',
  'base_url',
  'webhook_secret',
  'webhook_url',
  'timeout',
  'max_retries',
  'lang',
  'device_id',
  'app_info',
  'logger',
  'fetch',
  'transport',
  'middleware',
  'retry_strategy',
  'environment_resolver',
  'sleep',
] satisfies readonly (keyof MullaOptions)[];

const LANGUAGES = Object.values(Language) as string[];
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const APP_TOKEN = /^[A-Za-z0-9._~@+-]{1,64}$/;

export class MullaConfig {
  readonly environment: Environment;
  readonly baseUrl: string;
  readonly webhookUrl: string | null;
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
  readonly #webhookSecret: string | null;

  private constructor(options: MullaOptions) {
    const apiKey = optionalString(options.api_key, 'api_key');
    if (apiKey === null) {
      throw new InvalidArgumentError(
        'Missing "api_key". Pass your secret key: new MullaClient({ api_key: process.env.MULLA_SECRET_KEY }). ' +
          'The SDK does not read environment variables itself; with Node.js 20+ load a .env file using `node --env-file=.env`.',
      );
    }
    this.#apiKey = apiKey;
    this.environment = environmentFromApiKey(apiKey);
    assertExpectedEnvironment(options.environment, this.environment);

    const resolver = options.environment_resolver ?? new DefaultEnvironmentResolver();
    assertMethods(resolver, ['resolveBaseUrl'], 'environment_resolver');
    this.baseUrl = resolver.resolveBaseUrl(this.environment, optionalString(options.base_url, 'base_url') ?? undefined);

    this.#webhookSecret = optionalString(options.webhook_secret, 'webhook_secret');

    const webhookUrl = optionalString(options.webhook_url, 'webhook_url');
    if (webhookUrl !== null) {
      assertWebhookUrl(webhookUrl);
    }
    this.webhookUrl = webhookUrl;

    if (options.lang !== undefined && !LANGUAGES.includes(options.lang)) {
      throw new InvalidArgumentError(
        `Unsupported "lang" ${JSON.stringify(options.lang)}. Use one of: ${LANGUAGES.join(', ')}.`,
      );
    }
    this.lang = options.lang ?? null;

    const deviceId = options.device_id ?? uuidFromSeed(`${PLATFORM}:${keyId(apiKey)}`);
    if (typeof deviceId !== 'string' || !isUuidV4(deviceId)) {
      throw new InvalidArgumentError('The "device_id" option must be a UUID v4 (use uuidV4() to create one).');
    }
    this.deviceId = deviceId;

    const timeout = options.timeout ?? 30_000;
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
      throw new InvalidArgumentError('The "timeout" option must be a positive number of milliseconds.');
    }
    this.timeout = timeout;

    this.appInfo = options.app_info === undefined ? null : formatAppInfo(options.app_info);

    // Transport (Adapter): either a custom fetch or a full transport, never both.
    if (options.transport !== undefined && options.fetch !== undefined) {
      throw new InvalidArgumentError(
        'Pass either "fetch" or "transport", not both: a custom transport does not use fetch.',
      );
    }
    if (options.fetch !== undefined && typeof options.fetch !== 'function') {
      throw new InvalidArgumentError('The "fetch" option must be a function with the same signature as fetch().');
    }
    this.transport = options.transport ?? new FetchTransport(options.fetch);
    assertMethods(this.transport, ['send'], 'transport');

    // Retries (Strategy): max_retries configures the default; a custom strategy owns its own limits.
    if (options.retry_strategy !== undefined && options.max_retries !== undefined) {
      throw new InvalidArgumentError(
        'Pass either "max_retries" or "retry_strategy", not both: set the limit on your strategy instead.',
      );
    }
    if (options.retry_strategy !== undefined) {
      assertMethods(options.retry_strategy, ['shouldRetry', 'delay'], 'retry_strategy');
      this.retryStrategy = options.retry_strategy;
    } else {
      const maxRetries = options.max_retries ?? 2;
      if (!Number.isInteger(maxRetries) || maxRetries < 0) {
        throw new InvalidArgumentError('The "max_retries" option must be a whole number, 0 or more.');
      }
      this.retryStrategy = new ExponentialBackoff({ maxRetries });
    }

    const middleware = options.middleware ?? [];
    if (!Array.isArray(middleware)) {
      throw new InvalidArgumentError('The "middleware" option must be an array.');
    }
    middleware.forEach((layer, index) => {
      if (typeof layer !== 'function') {
        assertMethods(layer, ['handle'], `middleware[${index}]`, 'be a function (request, next) => ... or have a');
      }
    });
    this.middleware = Object.freeze([...middleware]);

    const logger = options.logger ?? null;
    if (logger !== null && typeof logger !== 'function') {
      assertMethods(logger, LOG_LEVELS, 'logger', 'be a function (level, message, context) => ... or have');
    }
    this.logger = logger;

    this.sleep = options.sleep ?? defaultSleep;
    if (typeof this.sleep !== 'function') {
      throw new InvalidArgumentError('The "sleep" option must be a function (ms) => Promise<void>.');
    }
  }

  /** Accepts the options object, or just the secret key as a shorthand. */
  static create(input: MullaOptions | string): MullaConfig {
    if (typeof input === 'string') {
      return new MullaConfig({ api_key: input });
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new InvalidArgumentError(
        'Pass an options object: new MullaClient({ api_key: process.env.MULLA_SECRET_KEY }).',
      );
    }

    const unknown = Object.keys(input).filter((key) => !ALLOWED_OPTIONS.includes(key));
    if (unknown.length > 0) {
      const hints = unknown.map((key) => {
        const snake = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);

        return ALLOWED_OPTIONS.includes(snake) ? `${key} (did you mean "${snake}"?)` : key;
      });
      throw new InvalidArgumentError(
        `Unknown Mulla option(s): ${hints.join(', ')}. Allowed: ${ALLOWED_OPTIONS.join(', ')}.`,
      );
    }

    return new MullaConfig({ ...input });
  }

  apiKey(): string {
    return this.#apiKey;
  }

  webhookSecret(): string | null {
    return this.#webhookSecret;
  }

  maskedApiKey(): string {
    return `sk_${this.environment}_${keyId(this.#apiKey)}_****`;
  }

  toJSON(): Record<string, unknown> {
    return {
      apiKey: this.maskedApiKey(),
      environment: this.environment,
      baseUrl: this.baseUrl,
      webhookUrl: this.webhookUrl,
      webhookSecret: this.#webhookSecret === null ? null : '****',
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

/** `undefined`, `null` and blank strings mean "not set"; anything else must be a string. */
function optionalString(value: unknown, option: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new InvalidArgumentError(`The "${option}" option must be a string.`);
  }
  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

function assertMethods(value: unknown, methods: readonly string[], option: string, prefix = 'have'): void {
  const missing =
    value === null || typeof value !== 'object'
      ? methods
      : methods.filter((method) => typeof (value as Record<string, unknown>)[method] !== 'function');
  if (missing.length > 0) {
    throw new InvalidArgumentError(
      `The "${option}" option must ${prefix} ${missing.map((method) => `${method}()`).join(', ')} method${missing.length > 1 ? 's' : ''}.`,
    );
  }
}

function assertWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidArgumentError(`The "webhook_url" option "${url}" is not a valid URL.`);
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') {
    throw new InvalidArgumentError('The "webhook_url" option must not contain credentials or a fragment.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.hostname.endsWith('.localhost');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new InvalidArgumentError('The "webhook_url" option must use https:// (plain http only for localhost).');
  }
}

/** Builds a header-safe User-Agent token, so app_info can never inject headers. */
function formatAppInfo(info: AppInfo): string {
  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    throw new InvalidArgumentError(
      'The "app_info" option must be an object like { name: "my-shop", version: "1.4.0" }.',
    );
  }
  const unknown = Object.keys(info).filter((key) => !['name', 'version', 'url'].includes(key));
  if (unknown.length > 0) {
    throw new InvalidArgumentError(`Unknown "app_info" field(s): ${unknown.join(', ')}. Allowed: name, version, url.`);
  }
  if (typeof info.name !== 'string' || !APP_TOKEN.test(info.name)) {
    throw new InvalidArgumentError(
      'The "app_info.name" field is required: 1-64 letters, digits or . _ ~ @ + - (no spaces).',
    );
  }
  if (info.version !== undefined && (typeof info.version !== 'string' || !APP_TOKEN.test(info.version))) {
    throw new InvalidArgumentError('The "app_info.version" field must be 1-64 letters, digits or . _ ~ @ + -.');
  }

  let agent = info.version !== undefined ? `${info.name}/${info.version}` : info.name;
  if (info.url !== undefined) {
    let parsed: URL | null;
    try {
      parsed = typeof info.url === 'string' ? new URL(info.url) : null;
    } catch {
      parsed = null;
    }
    if (parsed === null || !['https:', 'http:'].includes(parsed.protocol)) {
      throw new InvalidArgumentError('The "app_info.url" field must be an http(s) URL.');
    }
    agent += ` (+${parsed.href})`;
  }

  return agent;
}

const ENVIRONMENTS = Object.values(Environment) as string[];
const ENVIRONMENT_NAMES: Record<Environment, string> = { test: 'Environment.TEST', live: 'Environment.PRODUCTION' };

function assertExpectedEnvironment(expected: unknown, actual: Environment): void {
  if (expected === undefined) {
    return;
  }
  if (typeof expected !== 'string' || !ENVIRONMENTS.includes(expected)) {
    throw new InvalidArgumentError('The "environment" option must be Environment.TEST or Environment.PRODUCTION.');
  }
  if (expected !== actual) {
    throw new InvalidArgumentError(
      `The "environment" option is ${ENVIRONMENT_NAMES[expected as Environment]}, but "api_key" is a ` +
        `${actual === 'live' ? 'live (sk_live_)' : 'test (sk_test_)'} key. Use a key from the matching environment.`,
    );
  }
}
