import { ConnectionError } from '../../errors.js';
import { redactUrl } from '../../support/redactor.js';
import { INSPECT, runtimeName } from '../../support/runtime.js';
import { uuidV4 } from '../../support/uuid.js';
import { PLATFORM, VERSION } from '../../version.js';
import type { Request } from '../request.js';
import type { Response } from '../response.js';
import type { RetryStrategy } from '../retry.js';
import type { Transport } from '../transport.js';

export type Next = (request: Request) => Promise<Response>;

/**
 * Chain of Responsibility handler. Each middleware may change the request,
 * call `next` to continue the chain, and inspect or replace the response.
 *
 * Add your own (e.g. tracing) through the client's `middleware` option, as an object
 * with a `handle` method or as a plain function.
 */
export interface MiddlewareHandler {
  handle(request: Request, next: Next): Promise<Response>;
}
export type MiddlewareFunction = (request: Request, next: Next) => Promise<Response>;
export type Middleware = MiddlewareHandler | MiddlewareFunction;

export class Pipeline {
  readonly #handler: Next;

  constructor(transport: Transport, middleware: readonly Middleware[] = []) {
    let next: Next = (request) => transport.send(request);
    for (const layer of [...middleware].reverse()) {
      const inner = next;
      next =
        typeof layer === 'function' ? (request) => layer(request, inner) : (request) => layer.handle(request, inner);
    }
    this.#handler = next;
  }

  send(request: Request): Promise<Response> {
    return this.#handler(request);
  }
}

export class AuthMiddleware implements MiddlewareHandler {
  static readonly HEADER = 'x-api-key';
  readonly #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  handle(request: Request, next: Next): Promise<Response> {
    return next(request.withHeader(AuthMiddleware.HEADER, this.#apiKey));
  }

  [INSPECT](): Record<string, unknown> {
    return { apiKey: '****' };
  }
}

export class ClientContextMiddleware implements MiddlewareHandler {
  constructor(
    private readonly deviceId: string,
    private readonly lang: string | null = null,
    private readonly appInfo: string | null = null,
  ) {}

  handle(request: Request, next: Next): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.userAgent(),
      'x-platform': `${PLATFORM}/${VERSION}`,
      'x-device-id': this.deviceId,
    };
    if (request.body !== null) {
      headers['content-type'] = 'application/json';
    }
    if (this.lang !== null) {
      headers['x-lang'] = this.lang;
      headers['accept-language'] = this.lang;
    }

    let current = request;
    for (const [name, value] of Object.entries(headers)) {
      if (!current.hasHeader(name)) {
        current = current.withHeader(name, value);
      }
    }

    return next(current);
  }

  private userAgent(): string {
    const agent = `${PLATFORM}/${VERSION} ${runtimeName()}`;

    return this.appInfo !== null ? `${agent} ${this.appInfo}` : agent;
  }
}

export class IdempotencyMiddleware implements MiddlewareHandler {
  static readonly HEADER = 'x-idempotency-key';

  handle(request: Request, next: Next): Promise<Response> {
    if (request.method === 'POST' && !request.hasHeader(IdempotencyMiddleware.HEADER)) {
      return next(request.withHeader(IdempotencyMiddleware.HEADER, uuidV4()));
    }

    return next(request);
  }
}

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class RetryMiddleware implements MiddlewareHandler {
  constructor(
    private readonly strategy: RetryStrategy,
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  async handle(request: Request, next: Next): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let response: Response | null = null;
      let error: unknown = null;

      try {
        response = await next(request.withAttribute('attempt', attempt));
      } catch (e) {
        if (!(e instanceof ConnectionError)) {
          throw e;
        }
        error = e;
      }

      if (!this.strategy.shouldRetry(request, attempt, response, error)) {
        if (response === null) {
          throw error;
        }

        return response;
      }

      await this.sleep(this.strategy.delay(attempt, response));
    }
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFunction = (level: LogLevel, message: string, context: Record<string, unknown>) => void;
export interface LoggerObject {
  debug(...args: unknown[]): unknown;
  info(...args: unknown[]): unknown;
  warn(...args: unknown[]): unknown;
  error(...args: unknown[]): unknown;
}
export type Logger = LogFunction | LoggerObject;

export class LoggingMiddleware implements MiddlewareHandler {
  readonly #log: LogFunction;

  constructor(logger: Logger) {
    const log: LogFunction =
      typeof logger === 'function'
        ? logger
        : (level, message, context) => {
            logger[level](message, context);
          };
    // Logging is best effort: a failing logger must never break (or retry) a payment request.
    this.#log = (level, message, context) => {
      try {
        log(level, message, context);
      } catch {
        /* ignore logger failures */
      }
    };
  }

  async handle(request: Request, next: Next): Promise<Response> {
    const start = Date.now();
    const url = redactUrl(request.url);
    const context: Record<string, unknown> = {
      method: request.method,
      url,
      attempt: request.attribute('attempt', 1),
      idempotencyKey: request.header(IdempotencyMiddleware.HEADER),
    };

    let response: Response;
    try {
      response = await next(request);
    } catch (error) {
      if (error instanceof ConnectionError) {
        this.#log('warn', `Mulla request failed: ${error.message}`, { ...context, durationMs: Date.now() - start });
      }
      throw error;
    }

    const level: LogLevel = response.isSuccessful() ? 'debug' : response.statusCode >= 500 ? 'error' : 'warn';
    this.#log(level, `Mulla ${request.method} ${url} -> ${response.statusCode}`, {
      ...context,
      status: response.statusCode,
      durationMs: Date.now() - start,
    });

    return response;
  }
}
