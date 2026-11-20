import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Event,
  EventDispatcher,
  SignatureVerificationError,
  V1SignatureVerifier,
  V2SignatureVerifier,
  Webhook,
  WebhookEventType,
} from '@mulla/nodejs';
import { WebhookSigner } from '@mulla/nodejs/testing';

interface Vector {
  secret: string;
  body: string;
  v1_signature: string;
  timestamp: number;
  v2_signature: string;
}

/** Shared conformance vector, generated with Node crypto exactly like the Mulla server (same file in every SDK). */
const v = JSON.parse(
  readFileSync(new URL('../fixtures/webhooks/charge_success.json', import.meta.url), 'utf8'),
) as Vector;

describe('Webhook', () => {
  it('verifies the v1 signature produced by the server', () => {
    const event = Webhook.constructEvent(v.body, { 'X-Webhook-Signature': v.v1_signature }, v.secret);

    expect(event.eventType).toBe(WebhookEventType.CHARGE_SUCCESS);
    expect(event.id).toBe('4f6c2a8e-1b3d-4e5f-9a7b-0c1d2e3f4a5b');
    expect(event.objectId()).toBe('9b2e5c1a-7d4f-4a3b-8c6e-1f2a3b4c5d6e');
    expect(event.reference()).toBe('CHG20261116ABCD');
    expect(event.amount()).toBe(5000);
    expect(event.status()).toBe('SUCCESSFUL');
    expect(event.isCharge()).toBe(true);
  });

  it('signs exactly like the server (cross-SDK vector)', () => {
    expect(V1SignatureVerifier.sign(v.body, v.secret)).toBe(v.v1_signature);
    expect(V2SignatureVerifier.sign(v.body, v.secret, v.timestamp)).toBe(v.v2_signature);
  });

  it('accepts a Buffer body', () => {
    expect(Webhook.constructEvent(Buffer.from(v.body), v.v1_signature, v.secret).type).toBe('charge.success');
  });

  it('accepts the signature as a plain string', () => {
    expect(Webhook.constructEvent(v.body, v.v1_signature, v.secret).type).toBe('charge.success');
  });

  it('accepts Node-style array headers and fetch Headers', () => {
    expect(
      Webhook.constructEvent(v.body, { 'x-webhook-signature': [v.v1_signature] }, v.secret).is(
        WebhookEventType.CHARGE_SUCCESS,
      ),
    ).toBe(true);
    expect(Webhook.constructEvent(v.body, new Headers({ 'X-Webhook-Signature': v.v1_signature }), v.secret).type).toBe(
      'charge.success',
    );
  });

  it('rejects a tampered body', () => {
    expect(() => Webhook.constructEvent(v.body.replace('5000', '9000'), v.v1_signature, v.secret)).toThrow(
      SignatureVerificationError,
    );
  });

  it('rejects the wrong secret', () => {
    expect(() => Webhook.constructEvent(v.body, v.v1_signature, 'another-secret')).toThrow(SignatureVerificationError);
  });

  it('rejects missing headers', () => {
    expect(() => Webhook.constructEvent(v.body, {}, v.secret)).toThrow(/x-webhook-signature/);
  });

  it('explains a parsed body', () => {
    expect(() => Webhook.constructEvent(JSON.parse(v.body) as never, v.v1_signature, v.secret)).toThrow(
      /raw request body/,
    );
  });

  it('rejects an empty secret', () => {
    expect(() => new Webhook('')).toThrow(/secret is empty/);
  });

  it('verifies v2 within the tolerance', () => {
    const webhook = new Webhook(v.secret, {
      verifiers: [new V2SignatureVerifier(300, () => v.timestamp + 100), new V1SignatureVerifier()],
    });

    const event = webhook.parse(v.body, {
      'x-webhook-timestamp': String(v.timestamp),
      'x-webhook-signature-v2': v.v2_signature,
    });

    expect(event.type).toBe('charge.success');
  });

  it('rejects a replayed v2 event', () => {
    const webhook = new Webhook(v.secret, { verifiers: [new V2SignatureVerifier(300, () => v.timestamp + 301)] });

    expect(() =>
      webhook.parse(v.body, { 'x-webhook-timestamp': String(v.timestamp), 'x-webhook-signature-v2': v.v2_signature }),
    ).toThrow(/tolerance/);
  });

  it('does not fall back to v1 when v2 is invalid', () => {
    expect(() =>
      Webhook.constructEvent(
        v.body,
        {
          'x-webhook-signature': v.v1_signature,
          'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-webhook-signature-v2': '0'.repeat(128),
        },
        v.secret,
      ),
    ).toThrow(SignatureVerificationError);
  });

  it('produces verifiable requests with WebhookSigner', () => {
    const { body, headers } = WebhookSigner.event(
      WebhookEventType.PAYOUT_SUCCESS,
      { payout: 'po_1', metadata: { ref: 'x' } },
      'whsec',
    );

    const event = Webhook.constructEvent(body, headers, 'whsec');

    expect(event.objectId()).toBe('po_1');
    expect(event.metadata()).toEqual({ ref: 'x' });
    expect(Webhook.constructEvent(body, WebhookSigner.v1Headers(body, 'whsec'), 'whsec').type).toBe('payout.success');
  });
});

describe('EventDispatcher', () => {
  it('calls typed and wildcard listeners in order, awaiting async ones', async () => {
    const calls: string[] = [];
    const dispatcher = new EventDispatcher()
      .on(WebhookEventType.CHARGE_SUCCESS, async (e) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push(`success:${e.reference()}`);
      })
      .on('charge.failed', () => {
        calls.push('failed');
      })
      .onAny((e) => {
        calls.push(`any:${e.type}`);
      });

    const count = await dispatcher.dispatch(new Event('e1', 'charge.success', { reference: 'CHG1' }));

    expect(count).toBe(2);
    expect(calls).toEqual(['success:CHG1', 'any:charge.success']);
    expect(dispatcher.hasListeners('payout.success')).toBe(true);
    expect(new Event('e2', 'something.new', {}).eventType).toBeNull();
  });
});
