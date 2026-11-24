import { ConnectionError } from '../errors.js';
import { redactUrl } from '../support/redactor.js';
import type { Request } from './request.js';
import { Response } from './response.js';

export interface Transport {
  send(request: Request): Promise<Response>;
}

export type FetchFunction = (input: string, init: globalThis.RequestInit) => Promise<globalThis.Response>;

const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET_CONNECT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

/**
 * Default transport: the runtime's global fetch (Node 20+, Bun, Deno, Workers).
 * Pass your own `fetch` (e.g. one with a proxy dispatcher) through the client's `fetch` option.
 * Redirects are never followed, so the API key is never sent to another host.
 */
export class FetchTransport implements Transport {
  readonly #fetch: FetchFunction;

  constructor(fetchFn?: FetchFunction) {
    const resolved = fetchFn ?? (globalThis.fetch as FetchFunction | undefined);
    if (resolved === undefined) {
      throw new ConnectionError('No fetch implementation found. Use Node 20+ or pass the "fetch" option.', {
        requestMayHaveBeenSent: false,
      });
    }
    // Unbound call: some fetch implementations throw "Illegal invocation" when called as a method.
    this.#fetch = (input, init) => resolved(input, init);
  }

  async send(request: Request): Promise<Response> {
    const timeout = AbortSignal.timeout(request.timeout);
    const signal = request.signal !== undefined ? anySignal([request.signal, timeout]) : timeout;

    let response: globalThis.Response;
    let body: string;
    try {
      response = await this.#fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        body: request.body ?? undefined,
        redirect: 'manual',
        signal,
      });
      body = await response.text();
    } catch (error) {
      // The caller cancelled: surface their abort as-is so it is never retried.
      if (request.signal?.aborted === true) {
        throw request.signal.reason ?? error;
      }
      throw this.connectionError(request, error, timeout.aborted);
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });

    return new Response(response.status, headers, body);
  }

  private connectionError(request: Request, error: unknown, timedOut: boolean): ConnectionError {
    const code = errorCode(error);
    const mayHaveBeenSent = timedOut || code === null || !NOT_SENT_CODES.has(code);
    const reason = timedOut
      ? `timed out after ${request.timeout} ms`
      : `${code ?? 'network error'}: ${errorMessage(error)}`;

    let message = `Could not reach Mulla at ${redactUrl(request.url)} (${reason}).`;
    if (mayHaveBeenSent && request.method !== 'GET') {
      message += ' The request may have reached Mulla: check whether it was processed before sending it again.';
    }

    return new ConnectionError(message, { requestMayHaveBeenSent: mayHaveBeenSent, cause: error });
  }
}

/** undici wraps the system error: TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }). */
function errorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

function errorMessage(error: unknown): string {
  const cause = (error as { cause?: { message?: unknown } } | null)?.cause;
  if (typeof cause?.message === 'string' && cause.message !== '') {
    return cause.message;
  }

  return error instanceof Error ? error.message : String(error);
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  return controller.signal;
}
