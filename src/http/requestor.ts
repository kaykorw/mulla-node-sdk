import type { MullaConfig } from '../config.js';
import { errorFromResponse } from '../errors.js';
import { buildQuery } from '../support/normalizer.js';
import {
  AuthMiddleware,
  ClientContextMiddleware,
  IdempotencyMiddleware,
  LoggingMiddleware,
  Pipeline,
  RetryMiddleware,
  type Middleware,
} from './middleware/index.js';
import { Request } from './request.js';
import type { RequestOptions } from './request-options.js';

/**
 * Builds requests, runs them through the middleware pipeline and turns
 * error responses into errors. Shared by every service.
 *
 * Pipeline order (outermost first):
 *   ClientContext -> Auth -> Idempotency -> Retry -> [your middleware] -> Logging -> transport
 */
export class ApiRequestor {
  readonly #pipeline: Pipeline;

  constructor(private readonly config: MullaConfig) {
    const middleware: Middleware[] = [
      new ClientContextMiddleware(config.deviceId, config.lang, config.appInfo),
      new AuthMiddleware(config.apiKey()),
      new IdempotencyMiddleware(),
      new RetryMiddleware(config.retryStrategy, config.sleep),
      ...config.middleware,
    ];
    if (config.logger !== null) {
      middleware.push(new LoggingMiddleware(config.logger));
    }

    this.#pipeline = new Pipeline(config.transport, middleware);
  }

  async request(
    method: string,
    path: string,
    query: Record<string, unknown> = {},
    body: Record<string, unknown> | null = null,
    options: RequestOptions = {},
  ): Promise<Record<string, unknown> | unknown[] | null> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    if (options.idempotencyKey !== undefined) {
      headers[IdempotencyMiddleware.HEADER] = options.idempotencyKey;
    }
    if (options.lang !== undefined) {
      headers['x-lang'] = options.lang;
      headers['accept-language'] = options.lang;
    }

    const request = new Request({
      method,
      url: `${this.config.baseUrl}/${path.replace(/^\/+/, '')}${buildQuery(query)}`,
      headers,
      body: body !== null ? JSON.stringify(body) : null,
      timeout: options.timeout ?? this.config.timeout,
      signal: options.signal,
    });

    const response = await this.#pipeline.send(request);

    if (!response.isSuccessful()) {
      throw errorFromResponse(response);
    }

    return response.json();
  }
}
