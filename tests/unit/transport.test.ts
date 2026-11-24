import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionError, FetchTransport, MullaClient, NotFoundError, Request } from '@mulla/nodejs';
import { caught, charge, KEY } from './helpers.js';

let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/gateway`;
}

describe('FetchTransport', () => {
  it('passes method, headers and body to fetch, and never follows redirects', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const transport = new FetchTransport(async (url, init) => {
      seen = { url, init };

      return new Response('{"ok":true}', { status: 201, headers: { 'X-Thing': 'a' } });
    });

    const response = await transport.send(
      new Request({ method: 'post', url: 'https://mulla.test/x', headers: { 'X-A': '1' }, body: '{}' }),
    );

    expect(seen!.url).toBe('https://mulla.test/x');
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.redirect).toBe('manual');
    expect(seen!.init.headers).toEqual({ 'x-a': '1' });
    expect(response.statusCode).toBe(201);
    expect(response.header('x-thing')).toBe('a');
    expect(response.json()).toEqual({ ok: true });
  });

  it('talks to a real server end to end, with retries', async () => {
    let calls = 0;
    const base = await listen((req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(503, { 'content-type': 'application/json' }).end('{"errorCode":"SERVICE_UNAVAILABLE"}');

        return;
      }
      if (req.url === '/gateway/v1/charges/missing') {
        res
          .writeHead(404, { 'content-type': 'application/json' })
          .end('{"errorCode":"CHARGE_NOT_FOUND","message":"No"}');

        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(charge()));
    });
    const mulla = new MullaClient({ api_key: KEY, base_url: base, sleep: async () => {} });

    expect((await mulla.charges.retrieve('abc')).reference).toBe('CHG20261116ABCD');
    expect(calls).toBe(2);
    await expect(mulla.charges.retrieve('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reports a timeout as "may have been sent"', async () => {
    const base = await listen(() => {
      // never answers
    });
    const mulla = new MullaClient({ api_key: KEY, base_url: base, timeout: 100, max_retries: 0 });

    const error = (await caught(() =>
      mulla.charges.initiate({ provider: 'MTN_RW', amount: 100, phoneNumber: '2507' }),
    )) as ConnectionError;

    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.requestMayHaveBeenSent).toBe(true);
    expect(error.message).toContain('timed out after 100 ms');
    expect(error.message).toContain('may have reached Mulla');
  });

  it('reports a refused connection as "not sent", so writes are retried', async () => {
    const base = await listen(() => {});
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    const mulla = new MullaClient({ api_key: KEY, base_url: base, max_retries: 0 });

    const error = (await caught(() => mulla.charges.retrieve('abc'))) as ConnectionError;

    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.requestMayHaveBeenSent).toBe(false);
    expect(error.message).toContain('ECONNREFUSED');
  });

  it('redacts the checkout token in connection errors', async () => {
    const transport = new FetchTransport(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      });
    });

    const error = (await caught(() =>
      transport.send(new Request({ method: 'GET', url: 'https://mulla.test/checkout/cs_1?token=tok_SECRET' })),
    )) as ConnectionError;

    expect(error.requestMayHaveBeenSent).toBe(false);
    expect(error.message).toContain('token=***');
    expect(error.message).not.toContain('tok_SECRET');
  });
});
