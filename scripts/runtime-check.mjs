/**
 * Exercises the built package on the current runtime (Node, Bun or Deno): client flow with
 * retries through the testing entry, webhook conformance vector, and the Fetch API handler.
 *
 *   node scripts/runtime-check.mjs      bun scripts/runtime-check.mjs
 *
 * Imports by package name, so it also checks the "exports" map (self-reference).
 */
import { readFileSync } from 'node:fs';
import { createWebhookHandler, MullaClient, V1SignatureVerifier, V2SignatureVerifier, Webhook } from '@mulla/nodejs';
import { FakeTransport, WebhookSigner } from '@mulla/nodejs/testing';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`runtime-check failed: ${message}`);
  }
}

// A never-sent connection error is retried, so the testing entry's
//    ConnectionError must be the same class the retry middleware checks.
const fake = new FakeTransport()
  .pushConnectionError('refused', false)
  .pushJson({ id: 'chg_1', status: 'SUCCESSFUL', amount: '5000' });
const mulla = new MullaClient('sk_test_AbC123_secret', {
  baseUrl: 'https://mulla.test/gateway',
  transport: fake,
  sleep: async () => {},
});
const charge = await mulla.charges.initiate({ provider: 'MTN_RW', amount: 5000, phoneNumber: '250788000000' });
assert(charge.isSuccessful() && charge.amount === 5000, 'charge hydration');
assert(fake.requests.length === 2, `retry across entries (sent ${fake.requests.length})`);

const vector = JSON.parse(
  readFileSync(new URL('../tests/fixtures/webhooks/charge_success.json', import.meta.url), 'utf8'),
);
assert(V1SignatureVerifier.sign(vector.body, vector.secret) === vector.v1_signature, 'v1 signature');
assert(V2SignatureVerifier.sign(vector.body, vector.secret, vector.timestamp) === vector.v2_signature, 'v2 signature');
assert(
  Webhook.constructEvent(vector.body, vector.v1_signature, vector.secret).reference() === 'CHG20261116ABCD',
  'event',
);

const handler = createWebhookHandler({ secret: 'whsec', onAny: () => {} });
const { body, headers } = WebhookSigner.event('charge.success', { charge: 'chg_1' }, 'whsec');
const ok = await handler(new Request('https://shop.test/hook', { method: 'POST', headers, body }));
const bad = await handler(new Request('https://shop.test/hook', { method: 'POST', headers, body: `${body} ` }));
assert(ok.status === 200 && bad.status === 400, `handler statuses ${ok.status}/${bad.status}`);

const runtime = globalThis.Bun
  ? `Bun ${globalThis.Bun.version}`
  : globalThis.Deno
    ? `Deno ${globalThis.Deno.version.deno}`
    : `Node ${process.version}`;
console.log(`runtime-check passed on ${runtime}`);
