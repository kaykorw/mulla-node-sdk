import { describe, expect, it } from 'vitest';
import {
  ApiServerError,
  ConnectionError,
  InvalidArgumentError,
  InvalidRequestError,
  isUuidV4,
  Provider,
  RateLimitError,
  type Middleware,
} from '@kayko/mulla-node';
import { BASE, caught, charge, CHARGE, KEY, makeClient } from './helpers.js';

describe('request pipeline', () => {
  it('sends auth, client context and idempotency headers on POST', async () => {
    const { client, fake } = makeClient({ lang: 'fr', appInfo: 'my-shop/1.0' });
    fake.pushJson(charge());

    await client.charges.initiate({ provider: Provider.MTN_RW, amount: 5000, phoneNumber: '250788000000' });

    const r = fake.lastRequest!;
    expect(r.method).toBe('POST');
    expect(r.url).toBe(`${BASE}/charges/initiate`);
    expect(r.header('x-api-key')).toBe(KEY);
    expect(r.header('x-platform')).toMatch(/^mulla-node\/\d+\.\d+\.\d+$/);
    expect(isUuidV4(r.header('x-device-id')!)).toBe(true);
    expect(isUuidV4(r.header('x-idempotency-key')!)).toBe(true);
    expect(r.header('content-type')).toBe('application/json');
    expect(r.header('x-lang')).toBe('fr');
    expect(r.header('user-agent')).toMatch(/^mulla-node\/\S+ Node\/v\S+ my-shop\/1\.0$/);
  });

  it('sends no idempotency key on GET and encodes the query', async () => {
    const { client, fake } = makeClient();
    fake.pushJson({ data: [], total: 0, page: 1, limit: 20, total_pages: 0 });

    await client.customers.list({ isActive: true, keyword: "jean paul's" });

    const r = fake.lastRequest!;
    expect(r.header('x-idempotency-key')).toBeNull();
    expect(r.url).toBe(`${BASE}/customers?is_active=true&keyword=jean%20paul%27s`);
  });

  it('maps camelCase params to API fields and drops null values', async () => {
    const { client, fake } = makeClient();
    fake.pushJson(charge());

    await client.charges.initiate({
      provider: 'AIRTEL_RW',
      phoneNumber: '250733000000',
      amount: 1000,
      billingDetails: { firstName: 'Aline' },
      metadata: { orderId: 7, note: null },
      customer: 'cus_1',
      reason: undefined,
    });

    expect(fake.lastBody).toEqual({
      provider: 'AIRTEL_RW',
      phone_number: '+250733000000',
      amount: 1000,
      billing_details: { firstName: 'Aline' },
      metadata: { orderId: 7 },
      customer: { id: 'cus_1' },
    });
  });

  it('reports missing and unknown fields before sending', async () => {
    const { client, fake } = makeClient();

    const missing = await caught(() => client.charges.initiate({ amount: 1000 } as never));
    expect(missing).toBeInstanceOf(InvalidArgumentError);
    expect((missing as Error).message).toContain(
      'charges.initiate() is missing required field(s): provider, phoneNumber',
    );

    const unknown = await caught(() => client.charges.initiate({ ...CHARGE, phone_number: '2507' } as never));
    expect((unknown as Error).message).toContain('unknown field(s): phone_number');
    expect((unknown as Error).message).toContain('Use camelCase');

    fake.assertNothingSent();
  });

  it('accepts a per-request idempotency key and language', async () => {
    const { client, fake } = makeClient();
    fake.pushJson(charge());

    await client.charges.initiate(CHARGE, { idempotencyKey: 'b3f1f8a2-8c1e-4e7a-9d2c-1a2b3c4d5e6f', lang: 'rw' });

    expect(fake.lastRequest!.header('x-idempotency-key')).toBe('b3f1f8a2-8c1e-4e7a-9d2c-1a2b3c4d5e6f');
    expect(fake.lastRequest!.header('x-lang')).toBe('rw');
  });

  it('rejects unknown request options', async () => {
    const { client } = makeClient();
    await expect(client.charges.retrieve('abc', { idempotency_key: 'x' } as never)).rejects.toThrow(
      /Unknown request option/,
    );
  });

  it('retries unprocessed writes reusing the same idempotency key', async () => {
    const { client, fake, sleeps } = makeClient();
    fake.pushError(503, 'SERVICE_UNAVAILABLE').pushConnectionError().pushJson(charge());

    const result = await client.charges.initiate(CHARGE);

    expect(result.reference).toBe('CHG20261116ABCD');
    const keys = fake.requests.map((r) => r.header('x-idempotency-key'));
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(sleeps).toHaveLength(2);
  });

  it('gives up after maxRetries', async () => {
    const { client, fake } = makeClient({ maxRetries: 1 });
    fake.pushError(500, 'INTERNAL').pushError(500, 'INTERNAL');

    await expect(client.charges.retrieve('abc')).rejects.toBeInstanceOf(ApiServerError);
    fake.assertSentCount(2);
  });

  it('surfaces a connection error after retries', async () => {
    const { client, fake } = makeClient({ maxRetries: 0 });
    fake.pushConnectionError('Could not resolve host');

    await expect(client.charges.retrieve('abc')).rejects.toBeInstanceOf(ConnectionError);
  });

  it('does not retry client errors', async () => {
    const { client, fake } = makeClient();
    fake.pushError(400, 'VALIDATION_FAILED', 'amount must not be less than 10');

    const error = (await caught(() => client.charges.initiate({ ...CHARGE, amount: 1 }))) as InvalidRequestError;

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.errorCode).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('amount must not be less than 10');
    fake.assertSentCount(1);
  });

  it('does not wait for a long rate limit and exposes retryAfter', async () => {
    const { client, fake } = makeClient();
    fake.pushJson({ statusCode: 429, errorCode: 'RATE_LIMIT_EXCEEDED', message: 'Too many', retryAfter: 540 }, 429, {
      'Retry-After': '540',
    });

    const error = (await caught(() => client.charges.list())) as RateLimitError;

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBe(540);
    fake.assertSentCount(1);
  });

  it('honours a short Retry-After', async () => {
    const { client, fake, sleeps } = makeClient();
    fake
      .pushJson({ statusCode: 429, errorCode: 'RATE_LIMIT_EXCEEDED' }, 429, { 'retry-after': '2' })
      .pushJson(charge());

    await client.charges.retrieve('abc');

    expect(sleeps).toEqual([2000]);
  });

  it('runs custom middleware (object or function) for each attempt', async () => {
    const seen: unknown[] = [];
    const tracing: Middleware = {
      handle: (request, next) => {
        seen.push(request.attribute('attempt'));

        return next(request.withHeader('x-trace-id', 'trace-1'));
      },
    };
    const timing: Middleware = async (request, next) => next(request.withHeader('x-timing', '1'));
    const { client, fake } = makeClient({ middleware: [tracing, timing] });
    fake.pushError(502, 'BAD_GATEWAY').pushJson(charge());

    await client.charges.retrieve('abc');

    expect(seen).toEqual([1, 2]);
    expect(fake.lastRequest!.header('x-trace-id')).toBe('trace-1');
    expect(fake.lastRequest!.header('x-timing')).toBe('1');
  });

  it('never gives the API key to the logger', async () => {
    const logs: unknown[][] = [];
    const { client, fake } = makeClient({
      logger: (level, message, context) => {
        logs.push([level, message, context]);
      },
    });
    fake.pushJson(charge());

    await client.charges.retrieve('abc');

    expect(logs).toHaveLength(1);
    expect(logs[0]![0]).toBe('debug');
    expect((logs[0]![2] as Record<string, unknown>).status).toBe(200);
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it('accepts a console-style logger object', async () => {
    const lines: string[] = [];
    const logger = {
      debug: (m: string) => lines.push(`debug ${m}`),
      info: (m: string) => lines.push(`info ${m}`),
      warn: (m: string) => lines.push(`warn ${m}`),
      error: (m: string) => lines.push(`error ${m}`),
    };
    const { client, fake } = makeClient({ logger, maxRetries: 0 });
    fake.pushError(404, 'CHARGE_NOT_FOUND');

    await expect(client.charges.retrieve('abc')).rejects.toThrow();

    expect(lines).toEqual([`warn Mulla GET ${BASE}/charges/abc -> 404`]);
  });

  it('stops when the caller aborts', async () => {
    const { client, fake } = makeClient();
    const controller = new AbortController();
    fake.push((request) => {
      expect(request.signal).toBe(controller.signal);
      controller.abort(new Error('user cancelled'));
      throw controller.signal.reason;
    });

    await expect(client.charges.retrieve('abc', { signal: controller.signal })).rejects.toThrow('user cancelled');
    fake.assertSentCount(1);
  });
});
