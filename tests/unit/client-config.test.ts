import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChargeService,
  DefaultEnvironmentResolver,
  InvalidArgumentError,
  isUuidV4,
  MullaClient,
  uuidFromSeed,
} from '@kayko/mulla-node';
import { BASE, KEY, makeClient } from './helpers.js';

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
    expect(() => new MullaClient('pk_test_abc_def', { baseUrl: BASE })).toThrow(/sk_live_/);
  });

  it('reads the key from MULLA_SECRET_KEY when none is passed', () => {
    vi.stubEnv('MULLA_SECRET_KEY', LIVE_KEY);
    vi.stubEnv('MULLA_BASE_URL', '');
    expect(new MullaClient().isLive()).toBe(true);
  });

  it('explains a missing key', () => {
    vi.stubEnv('MULLA_SECRET_KEY', '');
    expect(() => new MullaClient()).toThrow(/MULLA_SECRET_KEY/);
  });

  it('defaults test keys to the sandbox gateway', () => {
    vi.stubEnv('MULLA_BASE_URL', '');
    expect(new MullaClient(KEY).baseUrl).toBe('https://mfs.kayko.dev/gateway/v1');
  });

  it('defaults live keys to the production gateway', () => {
    vi.stubEnv('MULLA_BASE_URL', '');
    const client = new MullaClient(LIVE_KEY);
    expect(client.isLive()).toBe(true);
    expect(client.baseUrl).toBe('https://core.mulla.app/gateway/v1');
  });

  it('reports a missing host for an environment', () => {
    vi.stubEnv('MULLA_BASE_URL', '');
    expect(
      () =>
        new MullaClient(LIVE_KEY, {
          environmentResolver: new DefaultEnvironmentResolver({ live: null, test: null }),
        }),
    ).toThrow(/live environment/);
  });

  it('accepts the gateway URL with or without a version', () => {
    expect(new MullaClient(LIVE_KEY, { baseUrl: 'https://api.example.com/gateway' }).baseUrl).toBe(
      'https://api.example.com/gateway/v1',
    );
    expect(new MullaClient(LIVE_KEY, { baseUrl: 'https://api.example.com/gateway/' }).baseUrl).toBe(
      'https://api.example.com/gateway/v1',
    );
    expect(new MullaClient(LIVE_KEY, { baseUrl: 'http://localhost:5605/gateway/v2' }).baseUrl).toBe(
      'http://localhost:5605/gateway/v2',
    );
  });

  it('reads the base URL from MULLA_BASE_URL', () => {
    vi.stubEnv('MULLA_BASE_URL', 'https://env.mulla.test/gateway/');
    expect(new MullaClient(KEY).baseUrl).toBe('https://env.mulla.test/gateway/v1');
  });

  it('fails loudly on unknown options', () => {
    expect(() => new MullaClient(KEY, { base_url: BASE } as never)).toThrow(/base_url/);
  });

  it('rejects an unsupported language', () => {
    expect(() => new MullaClient(KEY, { baseUrl: BASE, lang: 'de' as never })).toThrow(InvalidArgumentError);
  });

  it('rejects invalid numeric options', () => {
    expect(() => new MullaClient(KEY, { baseUrl: BASE, maxRetries: -1 })).toThrow(/maxRetries/);
    expect(() => new MullaClient(KEY, { baseUrl: BASE, timeout: 0 })).toThrow(/timeout/);
  });

  it('creates services lazily and reuses them', () => {
    const { client } = makeClient();
    expect(client.charges).toBeInstanceOf(ChargeService);
    expect(client.charges).toBe(client.charges);
  });

  it('never shows the secret in console output or JSON', () => {
    const { client } = makeClient();
    for (const dump of [
      inspect(client),
      inspect(client.config),
      JSON.stringify(client),
      JSON.stringify(client.config),
    ]) {
      expect(dump).not.toContain('s3cr3tRandomPart');
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
