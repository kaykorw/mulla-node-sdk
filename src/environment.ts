import { InvalidArgumentError } from './errors.js';

/**
 * Mulla runs sandbox (test) and production (live) as separate servers.
 * The environment is encoded in the secret key prefix: sk_test_... / sk_live_...
 */
export const Environment = {
  TEST: 'test',
  PRODUCTION: 'live',
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];

export function environmentFromApiKey(apiKey: string): Environment {
  const match = /^sk_(live|test)_[A-Za-z0-9]+_/.exec(apiKey);
  if (match === null) {
    throw new InvalidArgumentError(
      'Invalid Mulla secret key. Expected the format "sk_test_<id>_<secret>" or "sk_live_<id>_<secret>".',
    );
  }

  return match[1] as Environment;
}

export interface EnvironmentResolver {
  resolveBaseUrl(environment: Environment, configuredBaseUrl: string | undefined): string;
}

export const API_VERSION = 'v1';

export const OFFICIAL_BASE_URLS: Readonly<Record<Environment, string | null>> = {
  live: 'https://core.mulla.app/gateway',
  test: 'https://mfs.kayko.dev/gateway',
};

export class DefaultEnvironmentResolver implements EnvironmentResolver {
  constructor(private readonly baseUrls: Readonly<Record<Environment, string | null>> = OFFICIAL_BASE_URLS) {}

  resolveBaseUrl(environment: Environment, configuredBaseUrl: string | undefined): string {
    const url = configuredBaseUrl ?? this.baseUrls[environment] ?? null;
    if (url === null) {
      throw new InvalidArgumentError(
        `No Mulla API URL is configured for the ${environment} environment. Pass the "base_url" option.`,
      );
    }

    assertSafeUrl(url);

    return withVersion(url);
  }
}

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

export function withVersion(url: string): string {
  const trimmed = url.replace(/\/+$/, '');

  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/${API_VERSION}`;
}
