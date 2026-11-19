# Mulla Node.js SDK

Official Node.js library for the Mulla payment gateway. Accept **MTN Mobile Money** and **Airtel Money** payments in Rwanda, send payouts, and handle webhooks in a few lines of JavaScript or TypeScript.

- Node 20+, Bun, Deno and Cloudflare Workers (`nodejs_compat`); ESM and CommonJS
- No runtime dependencies (uses the built-in `fetch` and `node:crypto`)
- Written in TypeScript: typed params, models and enums, so your editor autocompletes everything
- Idempotency keys, retries and required headers handled for you
- Webhook verification plus ready-made handlers for Express, NestJS, Next.js, Hono and more
- Test helpers to fake the API in your own test suite

## Installation

```bash
npm install @kayko/mulla-node
```

## Quick start

```ts
import { MullaClient, Provider } from '@kayko/mulla-node';

const mulla = new MullaClient('sk_test_...'); // or leave it out and set MULLA_SECRET_KEY

const charge = await mulla.charges.initiate({
  provider: Provider.MTN_RW,
  amount: 5000,
  phoneNumber: '250788000000',
  reason: 'Order #1001',
  metadata: { orderId: 1001 },
});

// The customer approves the prompt on their phone.
// Mulla then sends a webhook, or you can poll:
const final = await mulla.charges.waitForFinalStatus(charge.id);

if (final.isSuccessful()) {
  // fulfil the order
}
```

CommonJS works too: `const { MullaClient } = require('@kayko/mulla-node');`

| Key           | Default gateway                               |
| ------------- | --------------------------------------------- |
| `sk_test_...` | `https://mfs.kayko.dev/gateway` (sandbox)     |
| `sk_live_...` | `https://core.mulla.app/gateway` (production) |

Override with the `baseUrl` option or the `MULLA_BASE_URL` environment variable (e.g. a local server).
You can paste the gateway URL exactly as the dashboard shows it (`https://host/gateway`); the SDK adds `/v1`.

## Good to know

### camelCase in, camelCase out

Params use camelCase (`phoneNumber`, `successUrl`) and the SDK maps them to the API's field names.
Unknown or misspelled fields throw an `InvalidArgumentError` before anything is sent, because the API rejects them.
The contents of `metadata`, `billingDetails` and `shippingDetails` are sent as you give them.

Responses are typed objects with camelCase fields, `Date`s and helpers such as `isSuccessful()` and `isFinal()`.
The untouched API data is always available as `model.raw`, and `JSON.stringify(model)` returns it.

### Hosted checkout

Let Mulla's page collect the network and phone number:

```ts
const session = await mulla.charges.createCheckout({
  amount: 25000,
  reason: 'Order #1001',
  metadata: { orderId: 1001 },
  successUrl: 'https://shop.example/thanks',
  cancelUrl: 'https://shop.example/cart',
});

res.redirect(session.checkoutUrl!);
```

> Return URLs are not signed. Always confirm payment with a webhook or `mulla.charges.retrieve(session.charge)`.

### Listing and pagination

`for await` walks through **every page** automatically:

```ts
import { ChargeStatus } from '@kayko/mulla-node';

for await (const charge of mulla.charges.list({ status: ChargeStatus.SUCCESSFUL })) {
  console.log(charge.reference, charge.amount);
}

const page = await mulla.charges.list({ limit: 20 }); // one page: page.data, page.total, await page.nextPage()
```

### Available services

| Service                 | Methods                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `mulla.charges`         | `initiate`, `createCheckout`, `retrieve`, `list`, `waitForFinalStatus`                                                          |
| `mulla.checkout`        | `retrieve`, `pay`, `eventsUrl` (public, token based)                                                                            |
| `mulla.payouts`         | `initiate`, `retrieve`, `list`, `waitForFinalStatus`                                                                            |
| `mulla.recharges`       | `initiate`, `retrieve`, `list`, `waitForFinalStatus`                                                                            |
| `mulla.invoices`        | `create`, `retrieve`, `list`, `update`, `updateStatus`, `listPayments`, `retrievePayment`, `retrievePublic`, `pay`, `eventsUrl` |
| `mulla.customers`       | `create`, `retrieve`, `list`, `update`, `blacklist`, `whitelist`                                                                |
| `mulla.webhookEndpoint` | `create`, `retrieve`, `update`, `rotateSecret`, `test`                                                                          |
| `mulla.referenceData`   | `banks`, `bankBranches`, `countries`, `currencies`, `scopes`                                                                    |

Each service needs the matching scope on your API key (CHARGES, PAYOUTS, INVOICES, RECHARGES, CUSTOMERS).

## Webhooks

Signatures are computed over the **raw request body**, so the handler must receive the exact bytes Mulla sent.
Each handler verifies the signature, then answers `200` once your listeners succeed, `400` for a bad signature,
and `500` when a listener throws (Mulla retries later).

```ts
const options = {
  secret: process.env.MULLA_WEBHOOK_SECRET!,
  on: {
    'charge.success': async (event) => markPaid(event.objectId(), event.reference()),
    'charge.failed': async (event) => markFailed(event.objectId()),
  },
  // Mulla retries deliveries: skip events you already handled.
  isDuplicate: async (event) => db.webhookEvents.exists(event.id),
};
```

### Next.js, Remix, SvelteKit, Hono, Bun, Deno, Cloudflare Workers

`createWebhookHandler` takes a web `Request` and returns a `Response`:

```ts
// app/api/mulla/webhook/route.ts (Next.js App Router)
import { createWebhookHandler } from '@kayko/mulla-node';

export const POST = createWebhookHandler(options);
```

```ts
// Hono
app.post('/mulla/webhook', (c) => handler(c.req.raw)); // const handler = createWebhookHandler(options)

// Bun / Deno
Bun.serve({ fetch: createWebhookHandler(options) });
```

### Express

```ts
import express from 'express';
import { createNodeWebhookHandler } from '@kayko/mulla-node';

app.post('/mulla/webhook', express.raw({ type: 'application/json' }), createNodeWebhookHandler(options));
app.use(express.json()); // other routes; register it after the webhook route
```

### NestJS

Turn on the raw body once, then call the handler from a controller:

```ts
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });

// mulla-webhook.controller.ts
const handle = createNodeWebhookHandler(options);

@Controller('mulla')
export class MullaWebhookController {
  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    return handle(req, res);
  }
}
```

### Fastify, AWS Lambda, anything else

`createWebhookProcessor` does the work without touching the request or response; you pass the raw body and headers:

```ts
import { createWebhookProcessor } from '@kayko/mulla-node';

const process = createWebhookProcessor(options);

fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
fastify.post('/mulla/webhook', async (req, reply) => {
  const result = await process(req.body as Buffer, req.headers);
  return reply.code(result.status).send(result.body);
});
```

### Verifying by hand

```ts
import { Webhook, SignatureVerificationError } from '@kayko/mulla-node';

try {
  const event = Webhook.constructEvent(rawBody, req.headers, process.env.MULLA_WEBHOOK_SECRET!);
  // event.type, event.id, event.objectId(), event.reference(), event.amount(), event.metadata()
} catch (error) {
  if (error instanceof SignatureVerificationError) {
    // answer 400
  }
}
```

Set up your endpoint with `await mulla.webhookEndpoint.create({ url: 'https://...' })` and store the returned `secret`.

## Error handling

Every error extends `MullaError`:

| Error                                | When                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `InvalidRequestError`                | 400: invalid parameters, minimum amount, insufficient balance                   |
| `AuthenticationError`                | 401: invalid, expired or revoked key                                            |
| `PermissionError`                    | 403: missing scope, IP not allowed, test/live key mismatch, merchant not active |
| `NotFoundError`                      | 404                                                                             |
| `ConflictError` / `IdempotencyError` | 409: payment in progress / idempotency key already used                         |
| `RateLimitError`                     | 429: see `retryAfter` (seconds)                                                 |
| `ApiServerError`                     | 5xx                                                                             |
| `ConnectionError`                    | network problem, no response. Check `requestMayHaveBeenSent`                    |
| `SignatureVerificationError`         | invalid webhook signature                                                       |
| `InvalidArgumentError`               | bad SDK usage, raised before any request                                        |

```ts
import { InvalidRequestError } from '@kayko/mulla-node';

try {
  await mulla.payouts.initiate({ ... });
} catch (error) {
  if (error instanceof InvalidRequestError) {
    error.errorCode;  // e.g. "INSUFFICIENT_BALANCE"
    error.statusCode; // 400
    error.body;       // full decoded error body
  }
}
```

### Retries and duplicate payments

The SDK retries automatically, but only when it is sure nothing is charged twice:

| Request                                 | Retried on                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Reads (`retrieve`, `list`)              | network errors, 408, 429, 500, 502, 503, 504                                         |
| Writes (`initiate`, `create`, `pay`, …) | 429 and 503 (rejected before processing), or a connection that was never established |

A write that times out, or fails with a 500, is **not** retried, because Mulla may already have
sent the payment prompt or the payout. When that happens, check before sending it again:

```ts
import { ConnectionError, uuidV4 } from '@kayko/mulla-node';

try {
  const charge = await mulla.charges.initiate(params, { idempotencyKey: order.mullaKey });
} catch (error) {
  if (error instanceof ConnectionError && error.requestMayHaveBeenSent) {
    // Look the charge up or wait for the webhook before asking the customer to pay again.
  }
}
```

Store the idempotency key with your order and reuse it. If the first attempt went through, a repeat
with the same key is rejected with `IdempotencyError` instead of creating a second charge.
Keys must be UUIDs (`uuidV4()` or `crypto.randomUUID()`).

## Configuration

```ts
const mulla = new MullaClient('sk_live_...', {
  baseUrl: 'https://core.mulla.app/gateway', // optional: defaults from the key; must be https
  timeout: 30_000, // ms
  maxRetries: 2, // see "Retries and duplicate payments"; 0 disables
  lang: 'fr', // en, fr, rw, sw: language of API messages
  appInfo: 'my-shop/1.4', // appended to the User-Agent
  logger: console, // or pino, winston, or (level, message, context) => {}; keys are never logged
  fetch: myFetch, // e.g. a fetch that goes through a proxy
  middleware: [myTracingMiddleware], // (request, next) => next(request.withHeader('x-trace-id', id))
});
```

Per-request options go in the last argument of every method:

```ts
await mulla.charges.initiate(params, {
  idempotencyKey: order.mullaKey, // a UUID stored with your order, reused on your own retries
  lang: 'rw',
  timeout: 60_000,
  signal: AbortSignal.timeout(10_000), // cancel the request (and its retries)
});
```

## Testing your integration

The SDK ships helpers so your tests never call the real API:

```ts
import { MullaClient, WebhookEventType } from '@kayko/mulla-node';
import { FakeTransport, WebhookSigner } from '@kayko/mulla-node/testing';

const fake = new FakeTransport();
fake.pushJson({ id: 'chg_1', reference: 'CHG1', status: 'PENDING', amount: 5000 });

const mulla = new MullaClient('sk_test_abc_xyz', { transport: fake });
// ... run your code ...
fake.assertSent((request) => request.url.endsWith('/charges/initiate'));

// Signed webhook requests for your webhook handler tests:
const { body, headers } = WebhookSigner.event(
  WebhookEventType.CHARGE_SUCCESS,
  { charge: 'chg_1', reference: 'CHG1', amount: 5000, currency: 'RWF', status: 'SUCCESSFUL' },
  'my-webhook-secret',
);
```
