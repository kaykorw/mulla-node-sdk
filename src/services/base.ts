import type { MullaConfig } from '../config.js';
import type { ApiScope } from '../enums.js';
import { InvalidArgumentError, PermissionError } from '../errors.js';
import { validateRequestOptions, type RequestOptions } from '../http/request-options.js';
import type { ApiRequestor } from '../http/requestor.js';
import { Collection, CollectionPromise } from '../models/collection.js';
import { makeModel, type Model, type ModelClass } from '../models/model.js';
import { toApi, type SchemaName, type WaitOptions } from '../params.js';
import { encodeRfc3986 } from '../support/normalizer.js';
import { INSPECT } from '../support/runtime.js';

export abstract class BaseService {
  protected abstract readonly resource: string;
  protected readonly scope: ApiScope | null = null;

  constructor(
    protected readonly requestor: ApiRequestor,
    protected readonly config: MullaConfig,
  ) {}

  protected async call(
    method: string,
    path: string,
    query: Record<string, unknown>,
    body: Record<string, unknown> | null,
    options: RequestOptions | undefined,
  ): Promise<unknown> {
    const requestOptions = validateRequestOptions(options);
    try {
      return await this.requestor.request(method, path, query, body, requestOptions);
    } catch (error) {
      if (error instanceof PermissionError) {
        throw this.explainScope(error);
      }
      throw error;
    }
  }

  private explainScope(error: PermissionError): PermissionError {
    if (error.errorCode !== 'API_KEY_SCOPE_DENIED') {
      return error;
    }

    const body = error.body ?? {};
    const missing = Array.isArray(body.missing) ? body.missing.map(String).join(', ') : null;
    let scope: unknown = body.requiredScope ?? body.required_scope ?? missing;
    if (typeof scope !== 'string' || scope === '') {
      scope = this.scope;
    }
    if (scope === null) {
      return error;
    }

    return new PermissionError(`${error.message} Required scope: ${scope as string}.`, {
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      body: error.body,
      headers: error.headers,
      rawBody: error.rawBody,
      cause: error,
    });
  }

  protected async send<T extends Model>(
    Class: ModelClass<T>,
    method: string,
    path: string,
    query: Record<string, unknown>,
    body: Record<string, unknown> | null,
    options: RequestOptions | undefined,
  ): Promise<T> {
    return makeModel(Class, await this.call(method, path, query, body, options));
  }

  protected postModel<T extends Model>(
    Class: ModelClass<T>,
    path: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    return this.send(Class, 'POST', path, {}, body, options);
  }

  protected getModel<T extends Model>(
    Class: ModelClass<T>,
    path: string,
    query: Record<string, unknown> = {},
    options?: RequestOptions,
  ): Promise<T> {
    return this.send(Class, 'GET', path, query, null, options);
  }

  protected patchModel<T extends Model>(
    Class: ModelClass<T>,
    path: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    return this.send(Class, 'PATCH', path, {}, body, options);
  }

  protected listModels<T extends Model>(
    Class: ModelClass<T>,
    path: string | (() => string),
    filters: () => Record<string, unknown>,
    options?: RequestOptions,
  ): CollectionPromise<T> {
    // Filters are checked when the list is awaited, so mistakes reject like API errors do.
    return new CollectionPromise(async () => {
      const query = filters();
      const url = typeof path === 'string' ? path : path();
      // Every fetched page gets the fetcher too, so iteration continues past page 2.
      const fetchPage = async (page: number): Promise<Collection<T>> =>
        Collection.fromResponse(Class, await this.call('GET', url, { page, ...query }, null, options), fetchPage);

      return Collection.fromResponse(Class, await this.call('GET', url, query, null, options), fetchPage);
    });
  }

  protected params(method: string, schema: SchemaName, input: unknown): Record<string, unknown> {
    return toApi(`${this.resource}.${method}()`, schema, input);
  }

  protected async pollUntilFinal<T extends Model & { isFinal(): boolean }>(
    fetch: () => Promise<T>,
    { timeoutMs = 120_000, intervalMs = 5_000 }: WaitOptions = {},
  ): Promise<T> {
    if (!(intervalMs >= 1000) || !(timeoutMs >= 0)) {
      throw new InvalidArgumentError('Polling intervalMs must be >= 1000 and timeoutMs >= 0.');
    }

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const model = await fetch();
      if (model.isFinal() || Date.now() >= deadline) {
        return model;
      }
      await this.config.sleep(Math.min(intervalMs, Math.max(1000, deadline - Date.now())));
    }
  }

  protected static id(id: string, label = 'id'): string {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new InvalidArgumentError(`The ${label} cannot be empty.`);
    }
    if (id === '.' || id === '..') {
      throw new InvalidArgumentError(`The ${label} "${id}" is not valid.`);
    }

    return encodeRfc3986(id);
  }

  [INSPECT](): string {
    return `${this.constructor.name} { baseUrl: '${this.config.baseUrl}' }`;
  }
}
