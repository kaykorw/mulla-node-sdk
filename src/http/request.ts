import { InvalidArgumentError } from '../errors.js';
import { redactUrl } from '../support/redactor.js';
import { INSPECT } from '../support/runtime.js';

export interface RequestInit {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeout?: number;
  attributes?: Record<string, unknown>;
  signal?: AbortSignal | undefined;
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export class Request {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly timeout: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal | undefined;

  constructor(init: RequestInit) {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      assertValidHeader(name, value);
      headers[name.toLowerCase()] = value;
    }

    this.method = init.method.toUpperCase();
    this.url = init.url;
    this.headers = Object.freeze(headers);
    this.body = init.body ?? null;
    this.timeout = init.timeout ?? 30_000;
    this.attributes = Object.freeze({ ...init.attributes });
    this.signal = init.signal;
    Object.freeze(this);
  }

  withHeader(name: string, value: string): Request {
    return this.copy({ headers: { ...this.headers, [name.toLowerCase()]: value } });
  }

  withoutHeader(name: string): Request {
    const headers = { ...this.headers };
    delete headers[name.toLowerCase()];

    return this.copy({ headers });
  }

  withAttribute(name: string, value: unknown): Request {
    return this.copy({ attributes: { ...this.attributes, [name]: value } });
  }

  header(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null;
  }

  hasHeader(name: string): boolean {
    return this.headers[name.toLowerCase()] !== undefined;
  }

  attribute<T = unknown>(name: string, fallback?: T): T | undefined {
    return (this.attributes[name] as T | undefined) ?? fallback;
  }

  toJSON(): Record<string, unknown> {
    const headers: Record<string, string> = { ...this.headers };
    if (headers['x-api-key'] !== undefined) {
      headers['x-api-key'] = '****';
    }

    return {
      method: this.method,
      url: redactUrl(this.url),
      headers,
      body: this.body,
      timeout: this.timeout,
      attributes: this.attributes,
    };
  }

  [INSPECT](): Record<string, unknown> {
    return this.toJSON();
  }

  private copy(changes: Partial<RequestInit>): Request {
    return new Request({
      method: this.method,
      url: this.url,
      headers: this.headers,
      body: this.body,
      timeout: this.timeout,
      attributes: this.attributes,
      signal: this.signal,
      ...changes,
    });
  }
}

/** Rejects header names/values that could inject extra header lines (CR, LF, NUL). */
function assertValidHeader(name: string, value: unknown): void {
  if (!HEADER_NAME.test(name)) {
    throw new InvalidArgumentError(`Invalid HTTP header name "${JSON.stringify(name).slice(1, -1)}".`);
  }
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) {
    throw new InvalidArgumentError(`Invalid value for HTTP header "${name}": it must be a string without line breaks.`);
  }
}
