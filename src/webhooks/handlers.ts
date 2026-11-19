import { MullaError, SignatureVerificationError } from '../errors.js';
import type { WebhookEventType } from '../enums.js';
import { EventDispatcher, type EventListener } from './dispatcher.js';
import type { Event } from './event.js';
import type { RawBody } from './verifiers.js';
import { Webhook, type WebhookHeaders } from './webhook.js';

export interface WebhookHandlerOptions {
  secret: string;
  on?: { [Type in WebhookEventType]?: EventListener } & Record<string, EventListener | undefined>;
  onAny?: EventListener;
  dispatcher?: EventDispatcher;
  isDuplicate?: (event: Event) => boolean | Promise<boolean>;
  onError?: (error: unknown, event: Event) => void;
  toleranceSeconds?: number;
}

export interface WebhookResult {
  status: 200 | 400 | 500;
  body: { received: boolean; duplicate?: boolean; error?: string };
  event: Event | null;
}

/**
 * Framework-independent core: verifies the raw body, skips duplicates and runs the listeners.
 * Use it directly when neither `createWebhookHandler` nor `createNodeWebhookHandler` fits
 * (e.g. Fastify, AWS Lambda); otherwise prefer those.
 */
export function createWebhookProcessor(
  options: WebhookHandlerOptions,
): (rawBody: RawBody, headers: WebhookHeaders) => Promise<WebhookResult> {
  const webhook = new Webhook(options.secret, { toleranceSeconds: options.toleranceSeconds });
  const dispatcher = options.dispatcher ?? buildDispatcher(options);
  const onError =
    options.onError ??
    ((error: unknown, event: Event) => {
      console.error(`[mulla] Webhook listener failed for ${event.type} ${event.id}:`, error);
    });

  return async (rawBody, headers) => {
    let event: Event;
    try {
      event = webhook.parse(rawBody, headers);
    } catch (error) {
      if (error instanceof SignatureVerificationError) {
        return { status: 400, body: { received: false, error: error.message }, event: null };
      }
      throw error;
    }

    try {
      if (options.isDuplicate !== undefined && (await options.isDuplicate(event))) {
        return { status: 200, body: { received: true, duplicate: true }, event };
      }
      await dispatcher.dispatch(event);
    } catch (error) {
      onError(error, event);

      return { status: 500, body: { received: false, error: 'Webhook handler failed' }, event };
    }

    return { status: 200, body: { received: true }, event };
  };
}

/**
 * Web-standard handler: `(request: Request) => Promise<Response>`.
 * Works with Next.js App Router, Remix, SvelteKit, Astro, Hono, Bun.serve, Deno.serve,
 * Cloudflare Workers and anything else built on the Fetch API.
 *
 *     // app/api/mulla/webhook/route.ts (Next.js)
 *     export const POST = createWebhookHandler({
 *       secret: process.env.MULLA_WEBHOOK_SECRET!,
 *       on: { 'charge.success': async (event) => markPaid(event.objectId()) },
 *     });
 */
export function createWebhookHandler(options: WebhookHandlerOptions): (request: Request) => Promise<Response> {
  const process = createWebhookProcessor(options);

  return async (request) => {
    if (request.method !== 'POST') {
      return json(405, { received: false, error: 'Method not allowed' }, { allow: 'POST' });
    }
    const raw = new Uint8Array(await request.arrayBuffer());
    const result = await process(raw, request.headers);

    return json(result.status, result.body);
  };
}

export interface NodeRequestLike extends AsyncIterable<unknown> {
  method?: string | undefined;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body?: unknown;
  rawBody?: unknown;
  readableEnded?: boolean;
}

export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

/**
 * Node handler: `(req, res, next?) => Promise<void>`.
 * Works with Express, NestJS (Express adapter), Koa via `ctx.req/ctx.res`, and plain `node:http`.
 * It needs the raw body: register it before any JSON parser, or give the route `express.raw()`.
 *
 *     app.post('/mulla/webhook', express.raw({ type: 'application/json' }), createNodeWebhookHandler({ ... }));
 */
export function createNodeWebhookHandler(
  options: WebhookHandlerOptions,
): (req: NodeRequestLike, res: NodeResponseLike, next?: (error?: unknown) => void) => Promise<void> {
  const process = createWebhookProcessor(options);

  return async (req, res, next) => {
    try {
      if (req.method !== undefined && req.method.toUpperCase() !== 'POST') {
        res.setHeader('allow', 'POST');
        send(res, 405, { received: false, error: 'Method not allowed' });

        return;
      }
      const result = await process(await readRawBody(req), req.headers);
      send(res, result.status, result.body);
    } catch (error) {
      if (next !== undefined) {
        next(error);

        return;
      }
      send(res, 500, {
        received: false,
        error: error instanceof MullaError ? error.message : 'Webhook handler failed',
      });
    }
  };
}

function buildDispatcher(options: WebhookHandlerOptions): EventDispatcher {
  const dispatcher = new EventDispatcher();
  for (const [type, listener] of Object.entries(options.on ?? {})) {
    if (listener !== undefined) {
      dispatcher.on(type, listener);
    }
  }
  if (options.onAny !== undefined) {
    dispatcher.onAny(options.onAny);
  }

  return dispatcher;
}

const RAW_BODY_HELP =
  'Mulla webhooks are verified against the raw request body, but this request body was already parsed. ' +
  "Express: use express.raw({ type: 'application/json' }) on the webhook route, before express.json(). " +
  'NestJS: NestFactory.create(AppModule, { rawBody: true }). Fastify: see createWebhookProcessor in the README.';

async function readRawBody(req: NodeRequestLike): Promise<RawBody> {
  if (typeof req.rawBody === 'string' || req.rawBody instanceof Uint8Array) {
    return req.rawBody;
  }
  if (typeof req.body === 'string' || req.body instanceof Uint8Array) {
    return req.body;
  }
  if (req.body !== undefined && req.body !== null) {
    throw new MullaError(RAW_BODY_HELP);
  }
  if (req.readableEnded === true) {
    throw new MullaError(RAW_BODY_HELP);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : (chunk as Uint8Array));
  }

  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function send(res: NodeResponseLike, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
