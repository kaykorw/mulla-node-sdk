import { InvalidArgumentError } from './errors.js';
import { env } from './support/runtime.js';

/**
 * Mulla runs sandbox (test) and production (live) as separate servers.
 * The environment is encoded in the secret key prefix: sk_test_... / sk_live_...
 */
export type Environment = 'live' | 'test';

export function environmentFromApiKey(apiKey: string): Environment {
  const match = /^sk_(live|test)_[A-Za-z0-9]+_/.exec(apiKey);
  if (match === null) {
    throw new InvalidArgumentError(
      'Invalid Mulla secret key. Expected the format "sk_test_<id>_<secret>" or "sk_live_<id>_<secret>".',
    );
  }

  return match[1] as Environment;
}

/** Strategy: decides which API base URL a client talks to. */
export interface EnvironmentResolver {
  resolveBaseUrl(environment: Environment, configuredBaseUrl: string | undefined): string;
}

/** API version appended when a base URL does not end with one (e.g. ".../gateway"). */
export const API_VERSION = 'v1';

/** Official gateway hosts per environment. */
export const OFFICIAL_BASE_URLS: Readonly<Record<Environment, string | null>> = {
  live: 'https://core.mulla.app/gateway',
  test: 'https://mfs.kayko.dev/gateway',
};

/**
 * Precedence: the `baseUrl` option, then the MULLA_BASE_URL environment variable,
 * then the official host for the key's environment.
 */
export class DefaultEnvironmentResolver implements EnvironmentResolver {
  constructor(private readonly baseUrls: Readonly<Record<Environment, string | null>> = OFFICIAL_BASE_URLS) {}

  resolveBaseUrl(environment: Environment, configuredBaseUrl: string | undefined): string {
    const url = configuredBaseUrl ?? env('MULLA_BASE_URL') ?? this.baseUrls[environment] ?? null;
    if (url === null) {
      throw new InvalidArgumentError(
        `No Mulla API URL is configured for the ${environment} environment. Pass the "baseUrl" option`,
      );
    }

    assertSafeUrl(url);

    return withVersion(url);
  }
}

/**
 * The secret key travels in every request, so the URL must use HTTPS.
 * Plain HTTP is allowed only for local development hosts.
 */
export function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidArgumentError(`The Mulla base URL "${url}" is not a valid URL.`);
  }
  if (parsed.hostname === '') {
    throw new InvalidArgumentError(`The Mulla base URL "${url}" is not a valid URL.`);
  }
  if (parsed.username !== '' || parsed.password !== '' || url.includes('?') || url.includes('#')) {
    throw new InvalidArgumentError('The Mulla base URL must not contain credentials, a query string or a fragment.');
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (scheme === 'https') {
    return;
  }
  if (scheme === 'http' && isLocalHost(host)) {
    return;
  }

  throw new InvalidArgumentError(
    `The Mulla base URL must use https:// (got "${scheme}://${host}"). Plain http is only allowed for localhost.`,
  );
}

function isLocalHost(host: string): boolean {
  return (
    ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.test')
  );
}

/**
 * Accepts the gateway URL as shown in the dashboard ("https://host/gateway")
 * or with a version ("https://host/gateway/v1") and always returns the versioned form.
 */
export function withVersion(url: string): string {
  const trimmed = url.replace(/\/+$/, '');

  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/${API_VERSION}`;
}
