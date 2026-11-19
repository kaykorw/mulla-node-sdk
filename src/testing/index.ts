/*
 * Test helpers, published as "@kayko/mulla-node/testing".
 *
 * Imports go through the package name (not relative paths) so the classes here are the
 * very same ones the main entry uses: instanceof checks keep working in ESM and CommonJS.
 */
import {
  ConnectionError,
  Response,
  uuidV4,
  V1SignatureVerifier,
  V2SignatureVerifier,
  type Request,
  type Transport,
  type WebhookEventType,
} from '@kayko/mulla-node';

type Queued = Response | Error | ((request: Request) => Response | Promise<Response>);

/**
 * In-memory transport for testing code that uses the SDK. Queue responses,
 * run your code, then assert on the requests that were sent.
 *
 *     const fake = new FakeTransport().pushJson({ id: 'chg_1', status: 'PENDING' });
 *     const mulla = new MullaClient('sk_test_abc_xyz', { transport: fake });
 */
export class FakeTransport implements Transport {
  readonly #queue: Queued[] = [];
  readonly #sent: Request[] = [];

  pushJson(body: unknown, status = 200, headers: Record<string, string> = {}): this {
    const lower: Record<string, string> = { 'content-type': 'application/json' };
    for (const [name, value] of Object.entries(headers)) {
      lower[name.toLowerCase()] = value;
    }

    return this.push(new Response(status, lower, JSON.stringify(body)));
  }

  /**
   * Queue a Mulla-style error response.
   *
   * @param extra extra body fields, e.g. { retryAfter: 60 }
   */
  pushError(status: number, errorCode: string, message = 'Error', extra: Record<string, unknown> = {}): this {
    return this.pushJson({ statusCode: status, message, errorCode, ...extra }, status);
  }

  /**
   * Queue a network failure.
   *
   * @param requestMayHaveBeenSent false = connection never made (safe to retry writes),
   *                               true  = e.g. response timeout (Mulla may have processed it)
   */
  pushConnectionError(message = 'Connection refused', requestMayHaveBeenSent = false): this {
    return this.push(new ConnectionError(message, { requestMayHaveBeenSent }));
  }

  push(response: Queued): this {
    this.#queue.push(response);

    return this;
  }

  async send(request: Request): Promise<Response> {
    this.#sent.push(request);

    const next = this.#queue.shift();
    if (next === undefined) {
      throw new Error(
        `FakeTransport has no queued response for ${request.method} ${request.url}. Queue one with pushJson().`,
      );
    }
    if (next instanceof Error) {
      throw next;
    }
    if (next instanceof Response) {
      return next;
    }

    return next(request);
  }

  /** Every request sent so far, oldest first. */
  get requests(): readonly Request[] {
    return [...this.#sent];
  }

  get lastRequest(): Request | null {
    return this.#sent.at(-1) ?? null;
  }

  /** Decoded JSON body of the last request. */
  get lastBody(): unknown {
    const body = this.lastRequest?.body;

    return body !== null && body !== undefined ? (JSON.parse(body) as unknown) : null;
  }

  assertSent(matcher: (request: Request) => boolean): void {
    if (!this.#sent.some(matcher)) {
      throw new Error(`Expected a matching request to be sent to Mulla, but none was. Sent: ${this.describe()}`);
    }
  }

  assertSentCount(count: number): void {
    if (this.#sent.length !== count) {
      throw new Error(`Expected ${count} request(s) to Mulla, got ${this.#sent.length}. Sent: ${this.describe()}`);
    }
  }

  assertNothingSent(): void {
    this.assertSentCount(0);
  }

  private describe(): string {
    return this.#sent.length === 0 ? '(none)' : this.#sent.map((r) => `${r.method} ${r.url}`).join(', ');
  }
}

export interface SignedWebhook {
  body: string;
  headers: Record<string, string>;
}

/**
 * Builds correctly signed webhook requests so you can test your webhook handler
 * without calling Mulla.
 *
 *     const { body, headers } = WebhookSigner.event('charge.success', { charge: 'chg_1', status: 'SUCCESSFUL' }, 'whsec_test');
 *     await request(app).post('/mulla/webhook').set(headers).send(body);
 */
export const WebhookSigner = {
  event(
    type: WebhookEventType | (string & {}),
    data: Record<string, unknown>,
    secret: string,
    options: { eventId?: string; timestamp?: number } = {},
  ): SignedWebhook {
    const body = JSON.stringify({ event: type, event_id: options.eventId ?? uuidV4(), data });

    return { body, headers: WebhookSigner.headers(body, secret, options.timestamp) };
  },

  /** Signature headers for an arbitrary raw body (both v1 and v2 schemes). */
  headers(body: string, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): Record<string, string> {
    return {
      'content-type': 'application/json',
      [V1SignatureVerifier.HEADER]: V1SignatureVerifier.sign(body, secret),
      [V2SignatureVerifier.TIMESTAMP_HEADER]: String(timestamp),
      [V2SignatureVerifier.SIGNATURE_HEADER]: V2SignatureVerifier.sign(body, secret, timestamp),
    };
  },

  /** Only the v1 header, exactly like today's Mulla server sends. */
  v1Headers(body: string, secret: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      [V1SignatureVerifier.HEADER]: V1SignatureVerifier.sign(body, secret),
    };
  },
};
