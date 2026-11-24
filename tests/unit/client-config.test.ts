import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChargeService,
  DefaultEnvironmentResolver,
  Environment,
  ExponentialBackoff,
  InvalidArgumentError,
  isUuidV4,
  Language,
  MullaClient,
  uuidFromSeed,
  Webhook,
} from '@mulla/nodejs';
import { FakeTransport } from '@mulla/nodejs/testing';
import { BASE, charge, KEY, makeClient } from './helpers.js';

const LIVE_KEY = 'sk_live_AbC123_s3cr3tRandomPart';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('client configuration', () => {
  it('detects the environment from the key', () => {
    const { client } = makeClient();
    expect(client.environment).toBe('test');
    expect(client.isLive()).toBe(false);
    expect(client.baseUrl).toBe(BASE);
  });

  it('rejects public or malformed keys', () => {
    expect(() => new MullaClient({ api_key: 'pk_test_abc_def', base_url: BASE })).toThrow(/sk_live_/);
  });

  it('accepts the key alone as a shorthand', () => {
    expect(new MullaClient(LIVE_KEY).isLive()).toBe(true);
  });

  it('never reads MULLA_SECRET_KEY or MULLA_BASE_URL from the environment', () => {
    vi.stubEnv('MULLA_SECRET_KEY', LIVE_KEY);
    vi.stubEnv('MULLA_BASE_URL', 'https://env.mulla.test/gateway/');
    expect(() => new MullaClient({ api_key: undefined })).toThrow(/Missing "api_key"/);
    expect(new MullaClient({ api_key: KEY }).baseUrl).toBe('https://mfs.kayko.dev/gateway/v1');
  });

  it('explains a missing key', () => {
    for (const api_key of [undefined, null, '', '   ']) {
      expect(() => new MullaClient({ api_key } as never)).toThrow(/api_key/);
    }
    expect(() => new MullaClient(undefined as never)).toThrow(/options object/);
  });

  it('rejects the old (key, options) call shape instead of ignoring the options', () => {
    const Ctor = MullaClient as unknown as new (...args: unknown[]) => MullaClient;
    expect(() => new Ctor(KEY, { base_url: BASE })).toThrow(/single options object/);
  });

  it('treats unset optional values as defaults', () => {
    const client = new MullaClient({ api_key: KEY, base_url: undefined, webhook_secret: '', webhook_url: null });
    expect(client.baseUrl).toBe('https://mfs.kayko.dev/gateway/v1');
    expect(client.config.webhookUrl).toBeNull();
    expect(client.config.webhookSecret()).toBeNull();
  });

  it('checks the environment option against the key', () => {
    expect(new MullaClient({ api_key: KEY, environment: Environment.TEST }).environment).toBe('test');
    expect(new MullaClient({ api_key: LIVE_KEY, environment: Environment.PRODUCTION }).isLive()).toBe(true);
    expect(() => new MullaClient({ api_key: LIVE_KEY, environment: Environment.TEST })).toThrow(
      /Environment\.TEST, but "api_key" is a live/,
    );
    expect(() => new MullaClient({ api_key: KEY, environment: Environment.PRODUCTION })).toThrow(
      /Environment\.PRODUCTION, but "api_key" is a test/,
    );
    expect(() => new MullaClient({ api_key: KEY, environment: 'staging' as never })).toThrow(/"environment" option/);
  });

  it('defaults live keys to the production gateway', () => {
    const client = new MullaClient({ api_key: LIVE_KEY });
    expect(client.isLive()).toBe(true);
    expect(client.baseUrl).toBe('https://core.mulla.app/gateway/v1');
  });

  it('reports a missing host for an environment', () => {
    expect(
      () =>
        new MullaClient({
          api_key: LIVE_KEY,
          environment_resolver: new DefaultEnvironmentResolver({ live: null, test: null }),
        }),
    ).toThrow(/live environment/);
  });

  it('accepts the gateway URL with or without a version', () => {
    const url = (base_url: string) => new MullaClient({ api_key: LIVE_KEY, base_url }).baseUrl;
    expect(url('https://api.example.com/gateway')).toBe('https://api.example.com/gateway/v1');
    expect(url('https://api.example.com/gateway/')).toBe('https://api.example.com/gateway/v1');
    expect(url('http://localhost:5605/gateway/v2')).toBe('http://localhost:5605/gateway/v2');
  });

  it('fails loudly on unknown options and suggests the snake_case name', () => {
    expect(() => new MullaClient({ api_key: KEY, baseUrl: BASE } as never)).toThrow(
      /baseUrl \(did you mean "base_url"\?\)/,
    );
    expect(() => new MullaClient({ api_key: KEY, nope: 1 } as never)).toThrow(/nope/);
  });

  it('rejects an unsupported language and accepts the Language enum', () => {
    expect(() => new MullaClient({ api_key: KEY, base_url: BASE, lang: 'de' as never })).toThrow(InvalidArgumentError);
    expect(new MullaClient({ api_key: KEY, base_url: BASE, lang: Language.RW }).config.lang).toBe('rw');
  });

  it('rejects invalid numeric options', () => {
    expect(() => new MullaClient({ api_key: KEY, max_retries: -1 })).toThrow(/max_retries/);
    expect(() => new MullaClient({ api_key: KEY, timeout: 0 })).toThrow(/timeout/);
    expect(() => new MullaClient({ api_key: KEY, timeout: Infinity })).toThrow(/timeout/);
  });

  it('requires a UUID v4 device_id', () => {
    expect(() => new MullaClient({ api_key: KEY, device_id: 'my-device-id' })).toThrow(/device_id/);
    const id = uuidFromSeed('pos-terminal-7');
    expect(new MullaClient({ api_key: KEY, device_id: id }).config.deviceId).toBe(id);
  });

  it('validates webhook_url', () => {
    for (const webhook_url of ['http://shop.example/hook', 'https://u:p@shop.example/hook', 'nope']) {
      expect(() => new MullaClient({ api_key: KEY, webhook_url })).toThrow(/webhook_url/);
    }
    expect(new MullaClient({ api_key: KEY, webhook_url: 'https://shop.example/hook' }).config.webhookUrl).toBe(
      'https://shop.example/hook',
    );
  });

  it('builds a header-safe app_info and rejects anything else', () => {
    const agent = (app_info: unknown) => new MullaClient({ api_key: KEY, app_info: app_info as never }).config.appInfo;
    expect(agent({ name: 'my-shop', version: '1.4.0', url: 'https://shop.example' })).toBe(
      'my-shop/1.4.0 (+https://shop.example/)',
    );
    const bad = [
      {},
      'my-shop/1.0',
      { name: 'a\r\nx-evil: 1' },
      { name: 'ok', version: 'a b' },
      { name: 'ok', url: 'javascript:1' },
      { name: 'ok', extra: 1 },
    ];
    for (const value of bad) {
      expect(() => agent(value)).toThrow(/app_info/);
    }
  });

  it('checks callback options when the client is created', () => {
    const base = { api_key: KEY };
    expect(() => new MullaClient({ ...base, fetch: 'fetch' as never })).toThrow(/"fetch" option must be a function/);
    expect(() => new MullaClient({ ...base, transport: {} as never })).toThrow(/"transport" option must have send\(\)/);
    expect(
      () => new MullaClient({ ...base, fetch: async () => new Response(), transport: new FakeTransport() }),
    ).toThrow(/either "fetch" or "transport"/);
    expect(() => new MullaClient({ ...base, middleware: {} as never })).toThrow(/must be an array/);
    expect(
      () => new MullaClient({ ...base, middleware: [async (request, next) => next(request), {} as never] }),
    ).toThrow(/middleware\[1\]/);
    expect(() => new MullaClient({ ...base, logger: { info() {} } as never })).toThrow(
      /debug\(\), warn\(\), error\(\)/,
    );
    expect(() => new MullaClient({ ...base, sleep: 1 as never })).toThrow(/sleep/);
    expect(() => new MullaClient({ ...base, retry_strategy: { shouldRetry: () => false } as never })).toThrow(
      /delay\(\)/,
    );
    expect(
      () => new MullaClient({ ...base, max_retries: 1, retry_strategy: new ExponentialBackoff({ maxRetries: 3 }) }),
    ).toThrow(/either "max_retries" or "retry_strategy"/);
    expect(new MullaClient({ ...base, logger: console, middleware: [], fetch: globalThis.fetch })).toBeInstanceOf(
      MullaClient,
    );
  });

  it('calls a custom fetch without binding it to the transport', async () => {
    const receivers: unknown[] = [];
    const fetch = function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(new Response(JSON.stringify(charge()), { status: 200 }));
    };
    const client = new MullaClient({ api_key: KEY, base_url: BASE, fetch });
    await client.charges.retrieve('abc');
    expect(receivers).toEqual([undefined]);
  });

  it('keeps going when the logger throws', async () => {
    const { client, fake } = makeClient({
      logger: () => {
        throw new Error('logger down');
      },
    });
    fake.pushJson(charge());
    await expect(client.charges.retrieve('abc')).resolves.toBeDefined();
  });

  it('uses webhook_secret and webhook_url as defaults', async () => {
    const { client, fake } = makeClient({ webhook_secret: 'whsec_test', webhook_url: 'https://shop.example/hook' });
    expect(client.webhooks()).toBeInstanceOf(Webhook);
    fake.pushJson({ id: 'wh_1', url: 'https://shop.example/hook' });
    await client.webhookEndpoint.create();
    expect(fake.lastBody).toEqual({ is_active: true, url: 'https://shop.example/hook' });
    expect(() => makeClient().client.webhooks()).toThrow(/webhook_secret/);
  });

  it('creates services lazily and reuses them', () => {
    const { client } = makeClient();
    expect(client.charges).toBeInstanceOf(ChargeService);
    expect(client.charges).toBe(client.charges);
  });

  it('never shows the secrets in console output or JSON', () => {
    const { client } = makeClient({ webhook_secret: 'whsec_TopSecretValue' });
    for (const dump of [
      inspect(client),
      inspect(client.config),
      JSON.stringify(client),
      JSON.stringify(client.config),
    ]) {
      expect(dump).not.toContain('s3cr3tRandomPart');
      expect(dump).not.toContain('whsec_TopSecretValue');
    }
    expect(inspect(client)).toContain('sk_test_AbC123_****');
  });

  it('derives a stable UUIDv4 device id, identical to the other SDKs', () => {
    const a = makeClient().client.config.deviceId;
    const b = makeClient().client.config.deviceId;
    expect(isUuidV4(a)).toBe(true);
    expect(a).toBe(b);
    expect(a).toBe(uuidFromSeed('mulla-node:AbC123'));
    // Cross-SDK vector: the value PHP's Mulla\Support\Uuid::fromSeed('mulla-php:AbC123') returns.
    expect(uuidFromSeed('mulla-php:AbC123')).toBe('2467d1be-0b2b-4394-86e2-963edd5283b9');
  });
});
