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
import { INSPECT } from './support/runtime.js';
import { Webhook, type WebhookOptions } from './webhooks/webhook.js';

/**
 * Entry point to the Mulla API (Facade over all services).
 *
 *     const mulla = new MullaClient('sk_test_...');   // or set MULLA_SECRET_KEY
 *     const charge = await mulla.charges.initiate({ provider: 'MTN_RW', amount: 5000, phoneNumber: '250788000000' });
 */
export class MullaClient {
  readonly #config: MullaConfig;
  readonly #requestor: ApiRequestor;
  readonly #services = new Map<string, BaseService>();

  /**
   * @param apiKey  your secret key (sk_test_... or sk_live_...). Defaults to MULLA_SECRET_KEY.
   * @param options see MullaOptions
   */
  constructor(apiKey?: string, options: MullaOptions = {}) {
    this.#config = MullaConfig.create(apiKey, options);
    this.#requestor = new ApiRequestor(this.#config);
  }

  /** Collect money (direct push or hosted checkout). */
  get charges(): ChargeService {
    return this.service('charges', ChargeService);
  }

  /** Public checkout-session endpoints (token based). */
  get checkout(): CheckoutService {
    return this.service('checkout', CheckoutService);
  }

  /** Send money to phones. */
  get payouts(): PayoutService {
    return this.service('payouts', PayoutService);
  }

  /** Top up your Mulla balance. */
  get recharges(): RechargeService {
    return this.service('recharges', RechargeService);
  }

  /** Invoices and invoice payments. */
  get invoices(): InvoiceService {
    return this.service('invoices', InvoiceService);
  }

  get customers(): CustomerService {
    return this.service('customers', CustomerService);
  }

  /** Your webhook configuration. */
  get webhookEndpoint(): WebhookEndpointService {
    return this.service('webhookEndpoint', WebhookEndpointService);
  }

  /** Banks, countries, currencies, scopes. */
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

  /** A webhook verifier for your endpoint's secret. */
  webhooks(secret: string, options: WebhookOptions = {}): Webhook {
    return new Webhook(secret, options);
  }

  toJSON(): Record<string, unknown> {
    return { apiKey: this.#config.maskedApiKey(), environment: this.environment, baseUrl: this.baseUrl };
  }

  [INSPECT](): string {
    return `MullaClient ${JSON.stringify(this.toJSON())}`;
  }

  /** Factory: services are created on first use and reused afterwards. */
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
