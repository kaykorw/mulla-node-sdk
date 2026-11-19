import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignatureVerificationError } from '../errors.js';

export type RawBody = string | Uint8Array;

export interface SignatureVerifier {
  supports(headers: Readonly<Record<string, string>>): boolean;
  verify(payload: RawBody, headers: Readonly<Record<string, string>>, secret: string): void;
}

const MISMATCH =
  'Webhook signature does not match. Make sure you pass the raw request body ' +
  '(not re-encoded JSON) and the secret of your current webhook endpoint.';

export class V1SignatureVerifier implements SignatureVerifier {
  static readonly HEADER = 'x-webhook-signature';

  static sign(payload: RawBody, secret: string): string {
    return createHmac('sha512', secret).update(payload).digest('hex');
  }

  supports(headers: Readonly<Record<string, string>>): boolean {
    return headers[V1SignatureVerifier.HEADER] !== undefined;
  }

  verify(payload: RawBody, headers: Readonly<Record<string, string>>, secret: string): void {
    const given = (headers[V1SignatureVerifier.HEADER] ?? '').trim().toLowerCase();
    if (given === '' || !safeEqual(V1SignatureVerifier.sign(payload, secret), given)) {
      throw new SignatureVerificationError(MISMATCH);
    }
  }
}

export class V2SignatureVerifier implements SignatureVerifier {
  static readonly SIGNATURE_HEADER = 'x-webhook-signature-v2';
  static readonly TIMESTAMP_HEADER = 'x-webhook-timestamp';

  constructor(
    private readonly toleranceSeconds = 300,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  static sign(payload: RawBody, secret: string, timestamp: number): string {
    return createHmac('sha512', secret).update(`${timestamp}.`).update(payload).digest('hex');
  }

  supports(headers: Readonly<Record<string, string>>): boolean {
    return headers[V2SignatureVerifier.SIGNATURE_HEADER] !== undefined;
  }

  verify(payload: RawBody, headers: Readonly<Record<string, string>>, secret: string): void {
    const timestamp = headers[V2SignatureVerifier.TIMESTAMP_HEADER] ?? '';
    if (!/^\d+$/.test(timestamp)) {
      throw new SignatureVerificationError('Webhook timestamp header is missing or invalid.');
    }

    if (this.toleranceSeconds > 0 && Math.abs(this.clock() - Number(timestamp)) > this.toleranceSeconds) {
      throw new SignatureVerificationError(
        `Webhook timestamp is outside the ${this.toleranceSeconds} second tolerance (possible replay, or the server clock is wrong).`,
      );
    }

    const given = (headers[V2SignatureVerifier.SIGNATURE_HEADER] ?? '').trim().toLowerCase();
    if (given === '' || !safeEqual(V2SignatureVerifier.sign(payload, secret, Number(timestamp)), given)) {
      throw new SignatureVerificationError(MISMATCH);
    }
  }
}

function safeEqual(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}
