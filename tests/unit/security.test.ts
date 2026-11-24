import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ApiError, ApiServerError, ConnectionError, InvalidArgumentError, MullaClient } from '@mulla/nodejs';
import { FakeTransport } from '@mulla/nodejs/testing';
import { BASE, caught, charge, CHARGE, KEY, makeClient } from './helpers.js';

describe('retries never duplicate a write', () => {
  it('does not retry a write after a server error', async () => {
    const { client, fake } = makeClient();
    fake.pushError(500, 'INTERNAL');

    await expect(client.charges.initiate(CHARGE)).rejects.toBeInstanceOf(ApiServerError);
    expect(fake.requests).toHaveLength(1);
  });

  it('does not retry a write after a gateway timeout', async () => {
    const { client, fake } = makeClient();
    fake.pushError(408, 'REQUEST_TIMEOUT').pushJson(charge());

    await expect(client.payouts.initiate({ ...CHARGE, reason: 'Supplier' })).rejects.toBeInstanceOf(ApiError);
    expect(fake.requests).toHaveLength(1);
  });

  it('retries a write the server rejected up front', async () => {
    const { client, fake } = makeClient();
    fake.pushError(503, 'SERVICE_UNAVAILABLE').pushJson(charge());

    await client.charges.initiate(CHARGE);

    expect(fake.requests).toHaveLength(2);
  });

  it('does not retry a write that may have been sent', async () => {
    const { client, fake } = makeClient();
    fake.pushConnectionError('Operation timed out', true).pushJson(charge());

    const error = (await caught(() => client.charges.initiate(CHARGE))) as ConnectionError;

    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.requestMayHaveBeenSent).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });

  it('retries a write when the connection was never made', async () => {
    const { client, fake } = makeClient();
    fake.pushConnectionError('Could not resolve host', false).pushJson(charge());

    await client.charges.initiate(CHARGE);

    expect(fake.requests).toHaveLength(2);
  });

  it('retries a read after a server error and a timeout', async () => {
    const { client, fake } = makeClient();
    fake.pushError(500, 'INTERNAL').pushConnectionError('timed out', true).pushJson(charge());

    await client.charges.retrieve('abc');

    expect(fake.requests).toHaveLength(3);
  });
});

describe('secrets stay out of logs and dumps', () => {
  it('redacts the checkout token from logs', async () => {
    const logs: string[] = [];
    const { client, fake } = makeClient({
      logger: (_level, message, context) => {
        logs.push(`${message} ${JSON.stringify(context)}`);
      },
    });
    fake.pushJson({ id: 'cs_1', status: 'PENDING' });

    await client.checkout.retrieve('cs_1', 'tok_SECRET123');

    expect(fake.lastRequest!.url).toContain('tok_SECRET123');
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain('tok_SECRET123');
      expect(line).toContain('token=***');
    }
  });

  it('keeps the secret key out of every dump', async () => {
    const { client, fake } = makeClient();
    fake.pushJson(charge());
    await client.charges.retrieve('abc');

    const secret = 's3cr3tRandomPart';
    for (const value of [client, client.config, client.charges, fake.lastRequest]) {
      expect(inspect(value, { depth: 10, showHidden: true })).not.toContain(secret);
      expect(JSON.stringify(value)).not.toContain(secret);
    }
  });

  it('does not put the key in connection error messages', async () => {
    const { client, fake } = makeClient({ max_retries: 0 });
    fake.pushConnectionError();

    const error = await caught(() => client.charges.retrieve('abc'));

    expect(String(error)).not.toContain('s3cr3t');
  });
});

describe('base URL', () => {
  it.each([
    ['plain http', 'http://api.example.com/gateway'],
    ['credentials', 'https://user:pass@api.example.com/gateway'],
    ['query string', 'https://api.example.com/gateway?x=1'],
    ['fragment', 'https://api.example.com/gateway#x'],
    ['ftp', 'ftp://api.example.com/gateway'],
    ['file', 'file:///etc/passwd'],
    ['not a url', 'mulla'],
  ])('rejects %s', (_name, url) => {
    expect(() => new MullaClient({ api_key: KEY, base_url: url, transport: new FakeTransport() })).toThrow(
      InvalidArgumentError,
    );
  });

  it.each([
    ['localhost', 'http://localhost:5605/gateway'],
    ['loopback', 'http://127.0.0.1:5605/gateway'],
    ['ipv6 loopback', 'http://[::1]:5605/gateway'],
    ['docker', 'http://host.docker.internal:5605/gateway'],
    ['dev tld', 'http://mulla.test/gateway'],
  ])('allows plain http for %s', (_name, url) => {
    expect(new MullaClient({ api_key: KEY, base_url: url, transport: new FakeTransport() }).baseUrl).toMatch(
      /\/gateway\/v1$/,
    );
  });
});

describe('request input', () => {
  it('rejects header injection', async () => {
    const { client, fake } = makeClient();

    await expect(
      client.charges.retrieve('abc', { headers: { 'x-note': 'ok\r\nx-api-key: stolen' } }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(fake.requests).toHaveLength(0);
  });

  it('rejects an invalid header name', async () => {
    const { client } = makeClient();
    await expect(client.charges.retrieve('abc', { headers: { 'x-bad\nname': 'v' } })).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('requires the idempotency key to be a UUID', async () => {
    const { client } = makeClient();
    await expect(client.charges.initiate(CHARGE, { idempotencyKey: 'order-1001' })).rejects.toThrow(/idempotencyKey/);
  });

  it('rejects dot-segment and empty ids', async () => {
    const { client, fake } = makeClient();
    for (const id of ['.', '..', '', '  ']) {
      await expect(client.charges.retrieve(id)).rejects.toBeInstanceOf(InvalidArgumentError);
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('encodes ids in paths', async () => {
    const { client, fake } = makeClient();
    fake.pushJson(charge());

    await client.charges.retrieve('a/b?c');

    expect(fake.lastRequest!.url).toBe(`${BASE}/charges/a%2Fb%3Fc`);
  });

  it('builds the invoice events URL without a request', () => {
    const { client, fake } = makeClient();
    expect(client.invoices.eventsUrl('inv/1')).toBe(`${BASE}/invoice/inv%2F1/events`);
    expect(fake.requests).toHaveLength(0);
  });

  it('works with the default transport', () => {
    expect(new MullaClient({ api_key: KEY })).toBeInstanceOf(MullaClient);
  });
});
