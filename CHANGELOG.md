# Changelog

## [0.2.0](https://github.com/kaykorw/mulla-node-sdk/compare/v0.1.2...v0.2.0) (2026-11-27)


### Features

* enhance error handling with actionable hints and required scope in PermissionError ([b9ab570](https://github.com/kaykorw/mulla-node-sdk/commit/b9ab5704b84da19ef494cc5b29ab8c038d91a7bd))
* Refactor MullaClient configuration and options ([ffdb804](https://github.com/kaykorw/mulla-node-sdk/commit/ffdb804875147c72cae5942b3b40d98e4acd0b34))

## [0.1.2](https://github.com/kaykorw/mulla-node-sdk/compare/v0.1.1...v0.1.2) (2026-11-20)


### Bug Fixes

* update npm installation step for trusted publishing ([fb7d634](https://github.com/kaykorw/mulla-node-sdk/commit/fb7d63472fd16ce0a3859ebe4857b3318b359955))
* update npm installation step for trusted publishing ([a9a2ab9](https://github.com/kaykorw/mulla-node-sdk/commit/a9a2ab9538a0a3b89cdf314fb464e34c1345365e))

## [0.1.1](https://github.com/kaykorw/mulla-node-sdk/compare/v0.1.0...v0.1.1) (2026-11-20)


### Bug Fixes

* update import paths to use new package name '@mulla/nodejs' ([3e22578](https://github.com/kaykorw/mulla-node-sdk/commit/3e2257826d42c79ea86a724d6db8b35f0740c12a))

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
