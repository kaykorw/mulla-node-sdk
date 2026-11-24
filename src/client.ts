import { MullaConfig, type MullaOptions } from './config.js';
import type { Environment } from './environment.js';
import { ApiRequestor } from './http/requestor.js';
import {
  ChargeService,
  CheckoutService,
  CustomerService,
  InvoiceService,
  PayoutService,
  RechargeService,
  ReferenceDataService,
  WebhookEndpointService,
  type BaseService,
} from './services/index.js';
import { InvalidArgumentError } from './errors.js';
import { INSPECT } from './support/runtime.js';
import { Webhook, type WebhookOptions } from './webhooks/webhook.js';

/**
 * Entry point to the Mulla API (Facade over all services).
 *
 *     const mulla = new MullaClient({ api_key: process.env.MULLA_SECRET_KEY });
 *     const charge = await mulla.charges.initiate({ provider: 'MTN_RW', amount: 5000, phoneNumber: '250788000000' });
 */
export class MullaClient {
  readonly #config: MullaConfig;
  readonly #requestor: ApiRequestor;
  readonly #services = new Map<string, BaseService>();

  /**
   * @param options Client options, or just the secret key as a shorthand.
   *   The SDK never reads environment variables: pass every value explicitly.
   */
  constructor(options: MullaOptions | string) {
    if (arguments.length > 1) {
      throw new InvalidArgumentError(
        'MullaClient takes a single options object: new MullaClient({ api_key, base_url, ... }).',
      );
    }
    this.#config = MullaConfig.create(options);
    this.#requestor = new ApiRequestor(this.#config);
  }

  get charges(): ChargeService {
    return this.service('charges', ChargeService);
  }

  get checkout(): CheckoutService {
    return this.service('checkout', CheckoutService);
  }

  get payouts(): PayoutService {
    return this.service('payouts', PayoutService);
  }

  get recharges(): RechargeService {
    return this.service('recharges', RechargeService);
  }

  get invoices(): InvoiceService {
    return this.service('invoices', InvoiceService);
  }

  get customers(): CustomerService {
    return this.service('customers', CustomerService);
  }

  get webhookEndpoint(): WebhookEndpointService {
    return this.service('webhookEndpoint', WebhookEndpointService);
  }

  get referenceData(): ReferenceDataService {
    return this.service('referenceData', ReferenceDataService);
  }

  get environment(): Environment {
    return this.#config.environment;
  }

  isLive(): boolean {
    return this.#config.environment === 'live';
  }

  get baseUrl(): string {
    return this.#config.baseUrl;
  }

  get config(): MullaConfig {
    return this.#config;
  }

  /** Webhook verifier using `secret`, or the client's `webhook_secret` option when omitted. */
  webhooks(secret?: string, options: WebhookOptions = {}): Webhook {
    const resolved = secret ?? this.#config.webhookSecret();
    if (resolved === null) {
      throw new InvalidArgumentError(
        'No webhook secret. Pass "webhook_secret" to new MullaClient({...}) or call mulla.webhooks(secret).',
      );
    }

    return new Webhook(resolved, options);
  }

  toJSON(): Record<string, unknown> {
    return { apiKey: this.#config.maskedApiKey(), environment: this.environment, baseUrl: this.baseUrl };
  }

  [INSPECT](): string {
    return `MullaClient ${JSON.stringify(this.toJSON())}`;
  }

  private service<T extends BaseService>(
    name: string,
    Service: new (requestor: ApiRequestor, config: MullaConfig) => T,
  ): T {
    let instance = this.#services.get(name);
    if (instance === undefined) {
      instance = new Service(this.#requestor, this.#config);
      this.#services.set(name, instance);
    }

    return instance as T;
  }
}
