# Changelog

## [0.1.0](https://github.com/kaykorw/mulla-node-sdk/compare/v0.0.1...v0.1.0) (2026-11-19)


### Features

* Added TypeScript configuration files & add unit tests for request pipeline, security, services, transport, and webhook functionalities ([ec9d167](https://github.com/kaykorw/mulla-node-sdk/commit/ec9d16726fb368a2ee4a09f18d33915779985dd3))

## [0.0.1] - 2026-11-19

### Added

- First release of the Node.js SDK, mirroring the PHP SDK: charges (direct and hosted checkout), public checkout,
  payouts, recharges, invoices, customers, webhook endpoint and reference data services.
- Typed camelCase params and models, enums, auto-paginating `for await` lists.
- Automatic idempotency keys, safe retries, client context headers, logging with secrets redacted.
- Webhook verification (v1 and timestamped v2), `EventDispatcher`, and handlers for the Fetch API
  (`createWebhookHandler`) and Node `req`/`res` (`createNodeWebhookHandler`).
- `@kayko/mulla-node/testing`: `FakeTransport` and `WebhookSigner`.
- ESM and CommonJS builds with types; Node 20+, Bun, Deno and Cloudflare Workers.
