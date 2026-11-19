# Mulla NodeJS SDK

<!-- x-release-please-start-version -->

> This guide applies to `@kayko/mulla-node` **0.0.1** and the Mulla API **v1**. See [Versioning and compatibility](#versioning-and-compatibility).

<!-- x-release-please-end -->

## Introduction

The official Node.js library for Mulla, the mobile money payment gateway for Rwanda.

With it you can:

- take payments from **MTN Mobile Money** and **Airtel Money** wallets;
- send money to a wallet (payouts);
- send invoices and track their payments;
- receive and verify webhooks (payment notifications).

Why use it instead of calling the API yourself:

- **Typed.** Written in TypeScript, so your editor autocompletes every parameter, field and status.
- **Safe by default.** It adds the required headers, retries only when no payment can be duplicated, and never logs your key.
- **No dependencies.** It uses the built-in `fetch` and `node:crypto`.
- **Runs anywhere.** Node.js 20+, Bun, Deno and Cloudflare Workers. Works with both `import` and `require`.
- **Ready-made webhook handlers** for Express, NestJS, Next.js, Hono, Fastify and more.

## Table of contents

- [Introduction](#introduction)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [How Mulla payments work](#how-mulla-payments-work)
- [Guides](#guides)
  - [Charge a phone number](#charge-a-phone-number)
  - [Use the hosted checkout page](#use-the-hosted-checkout-page)
  - [Handle webhooks](#handle-webhooks)
  - [Send a payout](#send-a-payout)
  - [Top up your balance](#top-up-your-balance)
  - [Invoice a customer](#invoice-a-customer)
  - [List and filter records](#list-and-filter-records)
  - [Handle errors](#handle-errors)
  - [Avoid duplicate payments](#avoid-duplicate-payments)
  - [Test your integration](#test-your-integration)
  - [Go live](#go-live)
- [Reference](#reference)
  - [Services and methods](#services-and-methods)
  - [Client options](#client-options)
  - [Per-request options](#per-request-options)
  - [Environment variables](#environment-variables)
  - [Statuses](#statuses)
  - [Webhook events](#webhook-events)
  - [Errors](#errors)
  - [Retry rules](#retry-rules)
  - [Response objects](#response-objects)
- [Troubleshooting](#troubleshooting)
- [Versioning and compatibility](#versioning-and-compatibility)
- [Support](#support)
- [Contributing](#contributing)
- [License](#license)

## Requirements

- **Node.js 20 or newer.** Bun, Deno and Cloudflare Workers (with the `nodejs_compat` flag) also work.
- **A Mulla merchant account** and a secret API key from the Mulla dashboard.
- **The right scopes on the key.** A scope is a permission. Each service needs its own: `CHARGES`, `PAYOUTS`, `INVOICES`, `RECHARGES` or `CUSTOMERS`.

> **Server-side only.** Your secret key can move money. Use this SDK on your server, never in browser or mobile app code.

## Installation

```bash
npm install @kayko/mulla-node
```

With other package managers: `pnpm add @kayko/mulla-node`, `yarn add @kayko/mulla-node` or `bun add @kayko/mulla-node`.

## Quick start

This uses the sandbox, so no real money moves.

**1. Add your test key** to your environment, for example in a `.env` file that you don't commit:

```bash
MULLA_SECRET_KEY=sk_test_...
```

**2. Create a client.** It reads `MULLA_SECRET_KEY` automatically:

```ts
import { MullaClient, Provider } from '@kayko/mulla-node';

const mulla = new MullaClient();
```

With CommonJS: `const { MullaClient, Provider } = require('@kayko/mulla-node');`

**3. Ask a customer to pay.** Mulla sends a payment prompt to their phone:

```ts
const charge = await mulla.charges.initiate({
  provider: Provider.MTN_RW,
  amount: 5000, // RWF
  phoneNumber: '+250788000000',
  reason: 'Order #1001',
});

console.log(charge.id, charge.status); // "PENDING" until the customer answers
```

**4. Get the result.** For a quick test, wait for it:

```ts
const result = await mulla.charges.waitForFinalStatus(charge.id);

if (result.isSuccessful()) {
  // Mark the order as paid.
}
```

In production, use [webhooks](#handle-webhooks) instead of waiting.

## How Mulla payments work

Read this once. It explains the ideas the guides rely on.

### Payments finish later, not instantly

The customer has to approve a mobile money payment on their phone. So every charge starts as `PENDING` and changes later:

```text
PENDING ──► SUCCESSFUL   the customer approved
        ├─► FAILED       declined, wrong PIN, not enough money…
        └─► EXPIRED      the customer did not answer in time
```

Payouts, recharges and invoices work the same way, with their own [statuses](#statuses).

### Two ways to collect a payment

| Approach                                         | You collect                               | Best for                                       |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------- |
| [Direct charge](#charge-a-phone-number)          | The network and phone number, in your app | Apps with their own checkout form, USSD, POS   |
| [Hosted checkout](#use-the-hosted-checkout-page) | Nothing: Mulla's page asks the customer   | Websites that want the fastest, simplest setup |

### Two ways to learn the result

- **Webhooks (recommended).** Mulla calls a URL on your server when the status changes. See [Handle webhooks](#handle-webhooks).
- **Polling.** Your code asks Mulla repeatedly with `waitForFinalStatus`. Fine for scripts and tests, but it keeps your code waiting.

### Test mode and live mode

The key prefix decides where requests go. You don't need to configure a URL.

| Key prefix | Mode                   | Server                           |
| ---------- | ---------------------- | -------------------------------- |
| `sk_test_` | Sandbox, no real money | `https://mfs.kayko.dev/gateway`  |
| `sk_live_` | Production, real money | `https://core.mulla.app/gateway` |

To use another server (for example a local one), set the `baseUrl` option or `MULLA_BASE_URL`. You can paste the URL exactly as the dashboard shows it; the SDK adds `/v1`.

### Amounts, phone numbers and field names

- **Amounts** are whole Rwandan francs (RWF), not cents. The minimum is 10.
- **Phone numbers** go to the API in international format with `+`, for example `+250788000000`. The SDK converts `250788000000`, `0788000000` and `0788 000 000` for you. `normalizePhoneNumber()` does the same conversion, for example to clean form input.
- **Field names** are camelCase (`phoneNumber`, `successUrl`). A misspelled or unknown field throws an `InvalidArgumentError` before anything is sent.

### Key terms

| Term                | Meaning                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| **Provider**        | The mobile money network: `MTN_RW` (MTN Mobile Money) or `AIRTEL_RW` (Airtel Money).                    |
| **Scope**           | A permission on your API key, such as `CHARGES`. Calls without it fail with `PermissionError`.          |
| **Webhook secret**  | A value Mulla gives you when you register your webhook URL. It proves a webhook really came from Mulla. |
| **Idempotency key** | A unique ID (UUID) sent with a request, so that sending it twice never creates two payments.            |

## Guides

Each guide is a short, complete task. They all start from a client:

```ts
import { MullaClient, Provider } from '@kayko/mulla-node';

const mulla = new MullaClient(); // reads MULLA_SECRET_KEY
```

### Charge a phone number

Use this when your app already knows the customer's network and phone number.

```ts
const charge = await mulla.charges.initiate({
  provider: Provider.AIRTEL_RW,
  amount: 12000,
  phoneNumber: '+250730000000',
  reason: 'Order #1001', // shown to the customer
  metadata: { orderId: 1001 }, // your own data, kept with the charge
});

await db.orders.update(1001, { mullaChargeId: charge.id });
```

Save `charge.id` with your order so you can match them later. Then wait for the `charge.success` or `charge.failed` [webhook](#handle-webhooks).

To check a charge yourself at any time:

```ts
const latest = await mulla.charges.retrieve(charge.id);
latest.status; // "PENDING", "SUCCESSFUL", "FAILED" or "EXPIRED"
```

### Use the hosted checkout page

Use this on a website when you don't want to build a payment form. Mulla's page asks for the network and phone number.

**1. Create a session and send the customer to it:**

```ts
const session = await mulla.charges.createCheckout({
  amount: 25000,
  reason: 'Order #1001',
  metadata: { orderId: 1001 },
  successUrl: 'https://shop.example/orders/1001/thanks',
  cancelUrl: 'https://shop.example/cart',
});

await db.orders.update(1001, { mullaChargeId: session.charge });
res.redirect(session.checkoutUrl!);
```

**2. Confirm the payment** with the webhook, or by retrieving the charge when the customer comes back:

```ts
const charge = await mulla.charges.retrieve(order.mullaChargeId);

if (charge.isSuccessful()) {
  // Mark the order as paid.
}
```

> **Don't trust the return URL alone.** Anyone can open `successUrl` in a browser. Always confirm with a webhook or `retrieve()`.

### Handle webhooks

A webhook is a POST request that Mulla sends to your server when something changes, such as a successful payment.

**1. Register your URL once** and save the secret it returns. Mulla shows the secret only once:

```ts
const endpoint = await mulla.webhookEndpoint.create({ url: 'https://shop.example/mulla/webhook' });
// Save endpoint.secret as MULLA_WEBHOOK_SECRET.

await mulla.webhookEndpoint.test(); // Mulla sends a "webhook.test" event to your URL
```

**2. Say what to do for each event.** These options work with every handler below:

```ts
const options = {
  secret: process.env.MULLA_WEBHOOK_SECRET!,
  on: {
    'charge.success': async (event) => {
      await db.orders.markPaidByChargeId(event.objectId());
      await db.webhookEvents.add(event.id); // remember it for isDuplicate
    },
    'charge.failed': async (event) => db.orders.markFailedByChargeId(event.objectId()),
  },
  // Mulla may deliver the same event more than once. Skip the ones you've handled.
  isDuplicate: async (event) => db.webhookEvents.exists(event.id),
};
```

Each handler checks the signature, then replies:

| Reply | When                                         | What Mulla does next |
| ----- | -------------------------------------------- | -------------------- |
| `200` | Your listeners finished, or it's a duplicate | Nothing              |
| `400` | The signature is missing, wrong or too old   | Nothing              |
| `500` | One of your listeners threw an error         | Retries later        |

**3. Add the route.** Mulla signs the **raw request body**, so the handler needs the exact bytes Mulla sent, before any JSON parser reads them. Pick your framework:

#### Next.js, Remix, SvelteKit, Hono, Bun, Deno, Cloudflare Workers

`createWebhookHandler` takes a web `Request` and returns a `Response`:

```ts
// app/api/mulla/webhook/route.ts (Next.js App Router)
import { createWebhookHandler } from '@kayko/mulla-node';

export const POST = createWebhookHandler(options);
```

```ts
// Hono
const handler = createWebhookHandler(options);
app.post('/mulla/webhook', (c) => handler(c.req.raw));

// Bun
Bun.serve({ fetch: createWebhookHandler(options) });
```

#### Express

Give the webhook route `express.raw()`, and register it before `express.json()`:

```ts
import express from 'express';
import { createNodeWebhookHandler } from '@kayko/mulla-node';

app.post('/mulla/webhook', express.raw({ type: 'application/json' }), createNodeWebhookHandler(options));
app.use(express.json()); // for your other routes
```

#### NestJS

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

#### Fastify, AWS Lambda, anything else

`createWebhookProcessor` does the work without touching a request or response object. Pass it the raw body and headers, then send back what it returns:

```ts
import { createWebhookProcessor } from '@kayko/mulla-node';

const processWebhook = createWebhookProcessor(options);

fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
fastify.post('/mulla/webhook', async (req, reply) => {
  const result = await processWebhook(req.body as Buffer, req.headers);
  return reply.code(result.status).send(result.body);
});
```

#### Verify by hand

```ts
import { Webhook, SignatureVerificationError } from '@kayko/mulla-node';

try {
  const event = Webhook.constructEvent(rawBody, req.headers, process.env.MULLA_WEBHOOK_SECRET!);
  // event.type, event.id, event.objectId(), event.reference(), event.status(), event.amount()
} catch (error) {
  if (error instanceof SignatureVerificationError) {
    // Reply 400.
  }
}
```

**Good to know:**

- **Find your record with `event.objectId()`.** It returns the charge, payout or invoice ID. `event.metadata()` returns `null` when the payload has no metadata, so don't rely on it alone.
- **Reply fast.** Record the event, then do slow work (emails, PDFs) in a background job.
- **Events you don't listen to** still get a `200`. Use `onAny` to log every event.
- **Old webhooks are rejected.** A signed webhook more than 5 minutes old fails, which stops replayed requests. Keep your server clock correct.
- **Rotating the secret:** `mulla.webhookEndpoint.rotateSecret()` returns a new secret. Update `MULLA_WEBHOOK_SECRET` right away.

### Send a payout

A payout sends money from your Mulla balance to a mobile money wallet. You need the `PAYOUTS` scope and enough balance.

```ts
const payout = await mulla.payouts.initiate({
  provider: Provider.MTN_RW,
  amount: 15000,
  phoneNumber: '+250788000000',
  reason: 'Refund for order #1001', // required
});
```

Listen for the `payout.success` and `payout.failed` webhooks, or check with `mulla.payouts.retrieve(payout.id)`. A payout has succeeded when its status is `COMPLETED` (`payout.isSuccessful()`).

If your balance is too low, you get an `InvalidRequestError` with the `errorCode` `INSUFFICIENT_BALANCE`.

### Top up your balance

A recharge moves money from a mobile money wallet into your Mulla balance, for example to fund payouts. You need the `RECHARGES` scope.

```ts
const recharge = await mulla.recharges.initiate({
  provider: Provider.MTN_RW,
  amount: 100000,
  phoneNumber: '+250788000000', // the wallet that pays
});

const result = await mulla.recharges.waitForFinalStatus(recharge.id);
```

### Invoice a customer

An invoice lets a customer pay a bill with one or more items. You need the `CUSTOMERS` and `INVOICES` scopes.

**1. Create the customer** (once), **then the invoice:**

```ts
const customer = await mulla.customers.create({
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+250788000000',
});

const invoice = await mulla.invoices.create({
  customer: customer.id,
  items: [
    { name: 'Website design', unitPrice: 150000 },
    { name: 'Hosting (months)', unitPrice: 10000, quantity: 12 },
  ],
  dueDate: '2026-12-31',
});
```

**2. Collect the payment.** This sends a payment prompt to the customer's phone:

```ts
await mulla.invoices.pay(invoice.id, { provider: Provider.MTN_RW, phoneNumber: '+250788000000' });
```

**3. Track it.** You get an `invoice.paid` webhook once it's fully paid. To see every payment attempt, call `mulla.invoices.listPayments(invoice.id)`.

To cancel an invoice: `await mulla.invoices.updateStatus(invoice.id, 'CANCELLED')`.

### List and filter records

Every `list()` method takes filters. `await` returns **one page**. A `for await` loop goes through **every page**:

```ts
import { ChargeStatus } from '@kayko/mulla-node';

// Every successful charge since 1 November; pages are fetched as the loop needs them
for await (const charge of mulla.charges.list({ status: ChargeStatus.SUCCESSFUL, startDate: '2026-11-01' })) {
  console.log(charge.reference, charge.amount);
}

// One page of 20
const page = await mulla.charges.list({ limit: 20, page: 1 });
page.data; // the charges on this page
page.total; // how many match in total
page.hasMore(); // true if there are more pages
const next = await page.nextPage();
```

Common filters are `page`, `limit`, `status`, `keyword`, `startDate`, `endDate`, `sortField` and `sortDirection` (`'ASC'` or `'DESC'`). Your editor shows the exact filters for each service.

### Handle errors

Every error the SDK throws extends `MullaError`, so you can catch them all at once or one type at a time:

```ts
import { InvalidRequestError, MullaError, PermissionError } from '@kayko/mulla-node';

try {
  await mulla.payouts.initiate(params);
} catch (error) {
  if (error instanceof InvalidRequestError && error.errorCode === 'INSUFFICIENT_BALANCE') {
    // Ask an admin to top up.
  } else if (error instanceof PermissionError) {
    // The key is missing a scope, or this server's IP isn't allowed.
  } else if (error instanceof MullaError) {
    console.error(error.message); // includes the error code and, often, a hint on how to fix it
  } else {
    throw error;
  }
}
```

API errors carry `statusCode`, `errorCode` and `body` (the full error response). See [Errors](#errors) for the full list.

### Avoid duplicate payments

Networks fail. If a request to start a payment times out, you can't know whether Mulla received it. Sending it again might charge the customer twice.

The SDK protects you in two ways:

1. **It only retries when that's safe.** A request that starts a payment is retried only when Mulla clearly didn't process it. See [Retry rules](#retry-rules).
2. **Idempotency keys.** Every payment request carries a unique key. If you repeat a request with the same key, Mulla rejects the repeat instead of creating a second payment.

For the strongest protection, create the key once, save it with your order, and reuse it on every attempt:

```ts
import { ConnectionError, IdempotencyError, uuidV4 } from '@kayko/mulla-node';

order.mullaKey ??= uuidV4(); // or crypto.randomUUID(); save it with the order

try {
  await mulla.charges.initiate(params, { idempotencyKey: order.mullaKey });
} catch (error) {
  if (error instanceof ConnectionError && error.requestMayHaveBeenSent) {
    // Unknown outcome: wait for the webhook, or look the charge up, before asking again.
  } else if (error instanceof IdempotencyError) {
    // A charge with this key already exists. Don't create another one.
  } else {
    throw error;
  }
}
```

### Test your integration

The SDK includes helpers so your own tests never call Mulla. Import them from `@kayko/mulla-node/testing`.

**Fake API responses** with `FakeTransport`:

```ts
import { MullaClient } from '@kayko/mulla-node';
import { FakeTransport } from '@kayko/mulla-node/testing';

const fake = new FakeTransport().pushJson({ id: 'chg_1', status: 'PENDING', amount: 5000 });
const mulla = new MullaClient('sk_test_abc_xyz', { transport: fake });

await checkout(mulla); // your code

fake.assertSent((request) => request.url.endsWith('/charges/initiate'));
fake.lastBody; // the JSON your code sent
```

To test failures, queue `pushError(400, 'INSUFFICIENT_BALANCE')` or `pushConnectionError()` instead.

**Sign test webhooks** with `WebhookSigner`:

```ts
import { WebhookSigner } from '@kayko/mulla-node/testing';

const { body, headers } = WebhookSigner.event(
  'charge.success',
  { charge: 'chg_1', reference: 'CHG1', amount: 5000, currency: 'RWF', status: 'SUCCESSFUL' },
  'my-test-secret', // the same secret your handler uses in tests
);

await request(app).post('/mulla/webhook').set(headers).send(body); // for example with supertest
```

### Go live

Before you switch to real money, check that:

- [ ] your merchant account is approved in the Mulla dashboard;
- [ ] `MULLA_SECRET_KEY` is a live key (`sk_live_`) with only the scopes you need;
- [ ] you registered your webhook URL **with the live key** and saved the new live secret as `MULLA_WEBHOOK_SECRET`;
- [ ] your webhook URL uses HTTPS and returns `200` for `mulla.webhookEndpoint.test()`;
- [ ] orders are marked paid only from a webhook or `retrieve()`, never from the return URL;
- [ ] `isDuplicate` skips events you've already handled;
- [ ] charges still `PENDING` after a while are treated as unpaid and checked with `retrieve()`, rather than waiting for a `charge.expired` webhook alone;
- [ ] if your key has an IP allowlist, your server's IP is on it.

## Reference

### Services and methods

| Service                 | Methods                                                                                                                         | Scope       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `mulla.charges`         | `initiate`, `createCheckout`, `retrieve`, `list`, `waitForFinalStatus`                                                          | `CHARGES`   |
| `mulla.checkout`        | `retrieve`, `pay`, `eventsUrl` (public; uses the session token)                                                                 | —           |
| `mulla.payouts`         | `initiate`, `retrieve`, `list`, `waitForFinalStatus`                                                                            | `PAYOUTS`   |
| `mulla.recharges`       | `initiate`, `retrieve`, `list`, `waitForFinalStatus`                                                                            | `RECHARGES` |
| `mulla.invoices`        | `create`, `retrieve`, `list`, `update`, `updateStatus`, `listPayments`, `retrievePayment`, `retrievePublic`, `pay`, `eventsUrl` | `INVOICES`  |
| `mulla.customers`       | `create`, `retrieve`, `list`, `update`, `blacklist`, `whitelist`                                                                | `CUSTOMERS` |
| `mulla.webhookEndpoint` | `create`, `retrieve`, `update`, `rotateSecret`, `test`                                                                          | —           |
| `mulla.referenceData`   | `banks`, `bankBranches`, `countries`, `currencies`, `scopes`                                                                    | —           |

`waitForFinalStatus(id, { timeoutMs, intervalMs })` checks every `intervalMs` (default 5000 ms, minimum 1000) until the status is final or `timeoutMs` (default 120000 ms) has passed. Either way it returns the latest object, so check its status.

### Client options

Pass them as the second argument: `new MullaClient(key, options)`. Unknown options throw an `InvalidArgumentError`.

| Option       | Default              | Description                                                                                           |
| ------------ | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `baseUrl`    | From the key prefix  | Server URL. Must use HTTPS, except for local hosts such as `localhost`.                               |
| `timeout`    | `30000`              | Time limit for each request, in milliseconds.                                                         |
| `maxRetries` | `2`                  | Extra attempts for failed requests that are safe to retry. `0` turns retries off.                     |
| `lang`       | API default          | Language of API messages: `en`, `fr`, `rw` or `sw`.                                                   |
| `appInfo`    | —                    | Your app's name and version (`'my-shop/1.4'`), added to the User-Agent.                               |
| `logger`     | —                    | `console`, pino, winston, or `(level, message, context) => {}`. Keys and bodies are never logged.     |
| `fetch`      | Global `fetch`       | A custom `fetch`, for example one that goes through a proxy.                                          |
| `middleware` | `[]`                 | Functions `(request, next) => next(request)` that can change requests, for example to add a trace ID. |
| `deviceId`   | Derived from the key | Sent as the `x-device-id` header.                                                                     |
| `transport`  | Built on `fetch`     | Replaces the HTTP layer. Mostly for tests (see `FakeTransport`).                                      |

### Per-request options

Pass them as the last argument of any method, for example `mulla.charges.initiate(params, { lang: 'rw' })`.

| Option           | Description                                                                   |
| ---------------- | ----------------------------------------------------------------------------- |
| `idempotencyKey` | Your own UUID. See [Avoid duplicate payments](#avoid-duplicate-payments).     |
| `timeout`        | Time limit for this request, in milliseconds.                                 |
| `lang`           | Language of this request's messages.                                          |
| `signal`         | An `AbortSignal` to cancel the request. A cancelled request is never retried. |
| `headers`        | Extra headers for this request.                                               |

### Environment variables

| Variable           | Used for                                                    |
| ------------------ | ----------------------------------------------------------- |
| `MULLA_SECRET_KEY` | The API key, when you don't pass one to `new MullaClient()` |
| `MULLA_BASE_URL`   | The server URL, when you don't pass `baseUrl`               |

The SDK never reads the webhook secret on its own. Pass it as `secret`; the examples use `MULLA_WEBHOOK_SECRET`.

### Statuses

A final status never changes again. Each object's `isFinal()` tells you if it has reached one.

| Object           | In progress                        | Final                                                     | `isSuccessful()` is true for |
| ---------------- | ---------------------------------- | --------------------------------------------------------- | ---------------------------- |
| Charge, recharge | `PENDING`                          | `SUCCESSFUL`, `FAILED`, `EXPIRED`                         | `SUCCESSFUL`                 |
| Payout           | `PENDING`, `APPROVED`, `SCHEDULED` | `COMPLETED`, `FAILED`, `REJECTED`, `CANCELLED`, `EXPIRED` | `COMPLETED`                  |
| Invoice          | `ISSUED`, `PENDING`, `OVERDUE`     | `PAID`, `CANCELLED`                                       | —                            |
| Invoice payment  | `PENDING`, `PROCESSING`            | `SUCCESSFUL`, `FAILED`, `CANCELLED`, `EXPIRED`            | `SUCCESSFUL`                 |

Every status is exported as a constant, for example `ChargeStatus.SUCCESSFUL`. Plain strings work too.

### Webhook events

| Event            | Sent when                               | `event.objectId()` |
| ---------------- | --------------------------------------- | ------------------ |
| `charge.success` | A charge succeeds                       | Charge ID          |
| `charge.failed`  | A charge fails                          | Charge ID          |
| `charge.expired` | A charge expires without an answer      | Charge ID          |
| `payout.success` | A payout completes                      | Payout ID          |
| `payout.failed`  | A payout fails                          | Payout ID          |
| `invoice.paid`   | An invoice is fully paid                | Invoice ID         |
| `webhook.test`   | You call `mulla.webhookEndpoint.test()` | —                  |

The `Event` object also has `id`, `type`, `data` (the payload) and the helpers `reference()`, `transactionId()`, `status()`, `amount()`, `currency()`, `metadata()`, `isCharge()`, `isPayout()`, `isInvoice()` and `isTest()`.

### Errors

| Error                        | HTTP status | Common causes                                                           |
| ---------------------------- | ----------- | ----------------------------------------------------------------------- |
| `InvalidRequestError`        | 400         | Invalid parameters, amount below the minimum, insufficient balance      |
| `AuthenticationError`        | 401         | The key is invalid, expired or revoked                                  |
| `PermissionError`            | 403         | Missing scope, IP not allowed, test/live mismatch, account not approved |
| `NotFoundError`              | 404         | No object with that ID                                                  |
| `ConflictError`              | 409         | A payment for this is already in progress                               |
| `IdempotencyError`           | 409         | The idempotency key was already used                                    |
| `RateLimitError`             | 429         | Too many requests. `retryAfter` says how many seconds to wait           |
| `ApiServerError`             | 500–599     | A problem on Mulla's side                                               |
| `ConnectionError`            | —           | No response (network, DNS, timeout). Check `requestMayHaveBeenSent`     |
| `SignatureVerificationError` | —           | A webhook signature is missing, wrong or too old                        |
| `InvalidArgumentError`       | —           | Wrong SDK usage (unknown field, empty ID…), raised before any request   |

All of them extend `MullaError`. The ones with an HTTP status also extend `ApiError`.

### Retry rules

The SDK retries a failed request up to `maxRetries` times, waiting longer each time (from 0.5 s up to 8 s). It follows the server's `Retry-After` header when there is one.

| Request                                         | Retried after                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Reads (`retrieve`, `list`)                      | Network errors and statuses 408, 429, 500, 502, 503, 504                             |
| Writes (`initiate`, `create`, `pay`, `update`…) | Statuses 429 and 503 (rejected before processing), or a connection that never opened |

A write that times out or gets a 500 is **not** retried, because Mulla may already have sent the prompt or the money. Retries reuse the same idempotency key.

### Response objects

Methods return typed objects (`Charge`, `Payout`, `Invoice`…) with camelCase fields, `Date` values and helpers such as `isSuccessful()` and `isFinal()`.

- `object.raw` holds the untouched API response.
- `object.get('some_field')` reads a field the SDK doesn't model yet.
- `JSON.stringify(object)` returns the raw API data.
- An unknown status or provider becomes `null` instead of throwing, so new API values don't break your app.

## Troubleshooting

| Problem                                                      | Likely cause and fix                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Webhook returns `400` saying the body "was already parsed"   | A JSON parser ran before the handler. Use `express.raw()` on that route, or `rawBody: true` in NestJS.                         |
| Webhook returns `400` because the signature doesn't match    | Wrong secret. Test and live endpoints have different secrets, and `rotateSecret()` replaces the old one.                       |
| `PermissionError` with `API_KEY_SCOPE_DENIED`                | The key lacks the scope for that service. Add it in the dashboard.                                                             |
| `PermissionError` with `API_KEY_ENVIRONMENT_MISMATCH`        | A test key is calling production, or the other way round. Remove `baseUrl` and let the key decide.                             |
| `PermissionError` with `API_KEY_IP_DENIED`                   | Your server's IP isn't on the key's allowlist.                                                                                 |
| `VALIDATION_FAILED` with "Invalid Phone Number"              | The number isn't a valid mobile number. Rwandan numbers are converted for you; other countries need the full `+` format.       |
| `InvalidArgumentError` about an unknown field                | A misspelled or snake_case field, such as `phone_number`. Use camelCase: `phoneNumber`.                                        |
| `InvalidArgumentError` about the base URL                    | `baseUrl` must use HTTPS, except for local hosts.                                                                              |
| `InvalidArgumentError` about a missing API key               | `MULLA_SECRET_KEY` isn't set in this process. With Node.js 20+, you can load a `.env` file with `node --env-file=.env app.js`. |
| `waitForFinalStatus` returns an object that is still pending | It timed out (after 2 minutes by default) and returned the latest state. Rely on webhooks, or raise `timeoutMs`.               |
| Charges end up `EXPIRED`                                     | The customer didn't approve the prompt in time. Ask them to check their phone, then start a new charge.                        |

## Versioning and compatibility

<!-- x-release-please-start-version -->

| Package version | Mulla API | Tested in CI on                   |
| --------------- | --------- | --------------------------------- |
| 0.0.1           | v1        | Node.js 20, 22 and 24; Bun latest |

<!-- x-release-please-end -->

- Deno and Cloudflare Workers are supported but not tested in CI.
- The package follows [semantic versioning](https://semver.org). Until 1.0.0, a minor release (0.**x**.0) may contain breaking changes. Patch releases never do.
- Every change is listed in [CHANGELOG.md](CHANGELOG.md).

## Support

- **Bugs and feature requests:** [open an issue](https://github.com/kaykorw/mulla-node-sdk/issues). Include the SDK version, your runtime version (`node -v`), and the error's `errorCode` and message. Never paste your API key or webhook secret.
- **Your account, payments or API keys:** contact Mulla support through your Mulla dashboard.
- **Security problems:** don't open a public issue. Report them privately through the repository's [Security tab](https://github.com/kaykorw/mulla-node-sdk/security).

## Contributing

Contributions are welcome. For anything bigger than a small fix, open an issue first so we can agree on the approach.

**1. Set up** (Node.js 20 or newer):

```bash
git clone https://github.com/kaykorw/mulla-node-sdk.git
cd mulla-node-sdk
npm install
```

**2. Make your change**, with tests in `tests/unit`. Update this README if the public API changes.

**3. Check everything** before you open a pull request:

```bash
npm run check   # lint, formatting, type check, tests, build and package checks
```

Other commands:

| Command                    | What it does                                                   |
| -------------------------- | -------------------------------------------------------------- |
| `npm test`                 | Run the unit tests                                             |
| `npm run test:watch`       | Re-run the unit tests on every change                          |
| `npm run lint`             | Check code style (ESLint and Prettier)                         |
| `npm run format`           | Fix formatting                                                 |
| `npm run typecheck`        | Check types                                                    |
| `npm run build`            | Build `dist/` (ES modules, CommonJS and type definitions)      |
| `npm run test:integration` | Test against the sandbox. Needs `MULLA_SECRET_KEY=sk_test_...` |

**4. Open a pull request** against `main`. CI must pass.

**Rules:**

- **No runtime dependencies.**
- **Same behaviour as the other Mulla SDKs:** same services, method names, errors, retry rules and webhook checks.
- **[Conventional Commits](https://www.conventionalcommits.org)** for commit messages (`feat:`, `fix:`, `docs:`, `chore:`). Releases and the changelog are generated from them, so `feat:` and `fix:` commits appear in the next release.

## License

MIT. See [LICENSE](LICENSE).
