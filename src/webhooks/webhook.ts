import { Buffer } from 'node:buffer';
import { InvalidArgumentError, SignatureVerificationError } from '../errors.js';
import { Event } from './event.js';
import { V1SignatureVerifier, V2SignatureVerifier, type RawBody, type SignatureVerifier } from './verifiers.js';

export type WebhookHeaders =
  | { forEach(callback: (value: string, name: string) => void): void }
  | Readonly<Record<string, string | readonly string[] | undefined>>
  | string;

export interface WebhookOptions {
  toleranceSeconds?: number;
  verifiers?: SignatureVerifier[];
}

/**
 * Verifies incoming webhook requests and turns them into Events.
 *
 *     const event = Webhook.constructEvent(rawBody, req.headers, process.env.MULLA_WEBHOOK_SECRET!);
 *
 * Verifiers are tried in order; the first one whose headers are present must pass.
 * The timestamped v2 scheme always wins over v1 when both are sent, so an attacker
 * cannot strip v2 headers to bypass replay protection once your server sends them.
 */
export class Webhook {
  readonly #secret: string;
  readonly #verifiers: readonly SignatureVerifier[];

  constructor(secret: string, options: WebhookOptions = {}) {
    if (typeof secret !== 'string' || secret === '') {
      throw new InvalidArgumentError(
        'Webhook secret is empty. Use the secret shown when you created or rotated your webhook endpoint.',
      );
    }
    this.#secret = secret;
    this.#verifiers = options.verifiers ?? [
      new V2SignatureVerifier(options.toleranceSeconds ?? 300),
      new V1SignatureVerifier(),
    ];
  }

  static constructEvent(
    payload: RawBody,
    headers: WebhookHeaders,
    secret: string,
    options: WebhookOptions = {},
  ): Event {
    return new Webhook(secret, options).parse(payload, headers);
  }

  parse(payload: RawBody, headers: WebhookHeaders): Event {
    if (typeof payload !== 'string' && !(payload instanceof Uint8Array)) {
      throw new SignatureVerificationError(
        'The webhook payload must be the raw request body (string or Buffer), not parsed JSON. ' +
          'See the README section "Webhooks" for how to get the raw body in your framework.',
      );
    }

    const normalized =
      typeof headers === 'string' ? { [V1SignatureVerifier.HEADER]: headers } : normalizeHeaders(headers);

    this.verify(payload, normalized);

    let decoded: unknown;
    try {
      decoded = JSON.parse(typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8'));
    } catch {
      decoded = null;
    }
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded) || !('event' in decoded)) {
      throw new SignatureVerificationError('Webhook body is not a valid Mulla event.');
    }

    return Event.fromPayload(decoded as Record<string, unknown>);
  }

  private verify(payload: RawBody, headers: Record<string, string>): void {
    for (const verifier of this.#verifiers) {
      if (verifier.supports(headers)) {
        verifier.verify(payload, headers, this.#secret);

        return;
      }
    }

    throw new SignatureVerificationError(
      'No Mulla signature header found (expected "x-webhook-signature"). Is this request really from Mulla?',
    );
  }
}

export function normalizeHeaders(headers: Exclude<WebhookHeaders, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof (headers as { forEach?: unknown }).forEach === 'function' && !Array.isArray(headers)) {
    (headers as { forEach(cb: (value: string, name: string) => void): void }).forEach((value, name) => {
      out[name.toLowerCase()] = value;
    });

    return out;
  }
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[name.toLowerCase()] = String(value[0] ?? '');
    } else if (value !== undefined && value !== null) {
      out[name.toLowerCase()] = String(value);
    }
  }

  return out;
}
