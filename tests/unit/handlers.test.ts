import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNodeWebhookHandler,
  createWebhookHandler,
  createWebhookProcessor,
  type Event,
  type WebhookHandlerOptions,
} from '@kayko/mulla-node';
import { WebhookSigner } from '@kayko/mulla-node/testing';

const SECRET = 'whsec_test';
const signed = () =>
  WebhookSigner.event('charge.success', { charge: 'chg_1', reference: 'CHG1', status: 'SUCCESSFUL' }, SECRET, {
    eventId: 'evt_1',
  });

let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

/** Starts node:http with `prepare` acting like framework middleware (e.g. express.raw / express.json). */
async function serve(
  options: WebhookHandlerOptions,
  prepare?: (req: IncomingMessage & { body?: unknown; rawBody?: unknown }) => Promise<void>,
  next?: (error?: unknown) => void,
): Promise<string> {
  const handler = createNodeWebhookHandler(options);
  server = createServer((req, res: ServerResponse) => {
    void (async () => {
      if (prepare) await prepare(req);
      await handler(req, res, next && ((error) => (next(error), res.writeHead(599).end())));
    })();
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/webhook`;
}

async function readAll(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks);
}

describe('createWebhookHandler (Fetch API)', () => {
  it('verifies, dispatches and answers 200', async () => {
    const seen: Event[] = [];
    const handler = createWebhookHandler({ secret: SECRET, on: { 'charge.success': (e) => void seen.push(e) } });
    const { body, headers } = signed();

    const response = await handler(new Request('https://shop.test/webhook', { method: 'POST', headers, body }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(seen.map((e) => e.objectId())).toEqual(['chg_1']);
  });

  it('answers 400 for a bad signature without calling listeners', async () => {
    const listener = vi.fn();
    const handler = createWebhookHandler({ secret: SECRET, onAny: listener });
    const { body, headers } = signed();

    const response = await handler(
      new Request('https://shop.test/webhook', { method: 'POST', headers, body: body.replace('CHG1', 'CHG2') }),
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('signature does not match');
    expect(listener).not.toHaveBeenCalled();
  });

  it('answers 500 when a listener throws, so Mulla retries', async () => {
    const onError = vi.fn();
    const handler = createWebhookHandler({
      secret: SECRET,
      on: {
        'charge.success': () => {
          throw new Error('database down');
        },
      },
      onError,
    });
    const { body, headers } = signed();

    const response = await handler(new Request('https://shop.test/webhook', { method: 'POST', headers, body }));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('database down');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('acknowledges duplicates without calling listeners', async () => {
    const listener = vi.fn();
    const handler = createWebhookHandler({ secret: SECRET, onAny: listener, isDuplicate: (e) => e.id === 'evt_1' });
    const { body, headers } = signed();

    const response = await handler(new Request('https://shop.test/webhook', { method: 'POST', headers, body }));

    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it('answers 405 to other methods', async () => {
    const response = await createWebhookHandler({ secret: SECRET })(new Request('https://shop.test/webhook'));
    expect(response.status).toBe(405);
  });

  it('fails at startup when the secret is missing', () => {
    expect(() => createWebhookHandler({ secret: '' })).toThrow(/secret is empty/);
  });
});

describe('createNodeWebhookHandler', () => {
  it('reads the raw stream (node:http)', async () => {
    const seen: string[] = [];
    const url = await serve({ secret: SECRET, onAny: (e) => void seen.push(e.type) });
    const { body, headers } = signed();

    const response = await fetch(url, { method: 'POST', headers, body });

    expect(response.status).toBe(200);
    expect(seen).toEqual(['charge.success']);
  });

  it('uses a Buffer body (express.raw)', async () => {
    const url = await serve({ secret: SECRET }, async (req) => {
      req.body = await readAll(req);
    });
    const { body, headers } = signed();

    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(200);
  });

  it('uses req.rawBody (NestJS rawBody: true)', async () => {
    const url = await serve({ secret: SECRET }, async (req) => {
      const raw = await readAll(req);
      req.rawBody = raw;
      req.body = JSON.parse(raw.toString('utf8'));
    });
    const { body, headers } = signed();

    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(200);
  });

  it('explains how to fix an already-parsed body (express.json)', async () => {
    const url = await serve({ secret: SECRET }, async (req) => {
      req.body = JSON.parse((await readAll(req)).toString('utf8'));
    });
    const { body, headers } = signed();

    const response = await fetch(url, { method: 'POST', headers, body });

    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toContain("express.raw({ type: 'application/json' })");
  });

  it('passes configuration errors to next() when given', async () => {
    const next = vi.fn();
    const url = await serve(
      { secret: SECRET },
      async (req) => {
        req.body = JSON.parse((await readAll(req)).toString('utf8'));
      },
      next,
    );
    const { body, headers } = signed();

    await fetch(url, { method: 'POST', headers, body });

    expect(next).toHaveBeenCalledOnce();
    expect(String(next.mock.calls[0]![0])).toContain('rawBody: true');
  });

  it('answers 400 for a tampered body', async () => {
    const url = await serve({ secret: SECRET });
    const { body, headers } = signed();

    expect((await fetch(url, { method: 'POST', headers, body: `${body} ` })).status).toBe(400);
  });
});

describe('createWebhookProcessor', () => {
  it('returns the status, body and event for custom integrations', async () => {
    const { body, headers } = signed();

    const result = await createWebhookProcessor({ secret: SECRET })(body, headers);

    expect(result.status).toBe(200);
    expect(result.event!.reference()).toBe('CHG1');
  });
});
