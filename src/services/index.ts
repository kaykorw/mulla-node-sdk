import { ApiScope, type InvoiceStatus } from '../enums.js';
import type { RequestOptions } from '../http/request-options.js';
import type { CollectionPromise } from '../models/collection.js';
import {
  Charge,
  CheckoutSession,
  Customer,
  Invoice,
  MullaObject,
  PaymentInitiation,
  PaymentTransaction,
  Payout,
  Recharge,
  WebhookEndpoint,
  WebhookTestResult,
} from '../models/index.js';
import type {
  BankBranchFilters,
  BankFilters,
  ChargeListFilters,
  CountryFilters,
  CreateCheckoutParams,
  CreateInvoiceParams,
  CreatePayoutParams,
  CreateWebhookEndpointParams,
  CurrencyFilters,
  CustomerListFilters,
  CustomerParams,
  InitiateChargeParams,
  InitiateRechargeParams,
  InvoiceListFilters,
  PayInvoiceParams,
  PayoutListFilters,
  PayParams,
  RechargeListFilters,
  ScopeFilters,
  UpdateInvoiceParams,
  UpdateWebhookEndpointParams,
  WaitOptions,
} from '../params.js';
import { InvalidArgumentError } from '../errors.js';
import { encodeRfc3986 } from '../support/normalizer.js';
import { BaseService } from './base.js';

export { BaseService } from './base.js';

/** Collect money from customers. Requires the CHARGES scope. */
export class ChargeService extends BaseService {
  protected readonly resource = 'charges';
  protected override readonly scope = ApiScope.CHARGES;

  /**
   * Sends a payment prompt to the customer's phone. Returns a PENDING charge;
   * wait for the webhook or call waitForFinalStatus().
   */
  async initiate(params: InitiateChargeParams, options?: RequestOptions): Promise<Charge> {
    return this.postModel(Charge, 'charges/initiate', this.params('initiate', 'initiateCharge', params), options);
  }

  /** Creates a hosted checkout session. Redirect the customer to `session.checkoutUrl`. */
  async createCheckout(params: CreateCheckoutParams, options?: RequestOptions): Promise<CheckoutSession> {
    return this.postModel(
      CheckoutSession,
      'charges/checkout',
      this.params('createCheckout', 'createCheckout', params),
      options,
    );
  }

  async retrieve(id: string, options?: RequestOptions): Promise<Charge> {
    return this.getModel(Charge, `charges/${BaseService.id(id, 'charge id')}`, {}, options);
  }

  /** Await it for one page, or `for await` it to walk every page. */
  list(filters: ChargeListFilters = {}, options?: RequestOptions): CollectionPromise<Charge> {
    return this.listModels(Charge, 'charges', () => this.params('list', 'chargeFilters', filters), options);
  }

  /**
   * Polls the charge until it is SUCCESSFUL, FAILED or EXPIRED, or until the timeout.
   * Returns the latest charge either way. Prefer webhooks in production; use this for
   * scripts, CLIs, or as a fallback.
   */
  async waitForFinalStatus(id: string, options?: WaitOptions): Promise<Charge> {
    return this.pollUntilFinal(() => this.retrieve(id), options);
  }
}

/**
 * Public checkout endpoints, authorised by the session token (not by your API key).
 * Use these to build your own checkout UI on top of a session created with
 * `mulla.charges.createCheckout()`.
 */
export class CheckoutService extends BaseService {
  protected readonly resource = 'checkout';
  async retrieve(id: string, token: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.getModel(CheckoutSession, `checkout/${BaseService.id(id, 'checkout id')}`, { token }, options);
  }

  /** Starts payment of a checkout session: sends the prompt to the customer's phone. */
  async pay(id: string, token: string, params: PayParams, options?: RequestOptions): Promise<CheckoutSession> {
    return this.send(
      CheckoutSession,
      'POST',
      `checkout/${BaseService.id(id, 'checkout id')}/pay`,
      { token },
      this.params('pay', 'pay', params),
      options,
    );
  }

  /**
   * URL of the Server-Sent Events stream for a session. Browsers can listen to it with
   * `new EventSource(url)` to get live status updates without polling.
   */
  eventsUrl(id: string, token: string): string {
    return `${this.config.baseUrl}/checkout/${BaseService.id(id, 'checkout id')}/events?token=${encodeRfc3986(token)}`;
  }
}

/** Send money to mobile money wallets. Requires the PAYOUTS scope. */
export class PayoutService extends BaseService {
  protected readonly resource = 'payouts';
  protected override readonly scope = ApiScope.PAYOUTS;

  /**
   * The amount is reserved from your balance immediately.
   * Throws InvalidRequestError (INSUFFICIENT_BALANCE) when your balance is too low.
   */
  async initiate(params: CreatePayoutParams, options?: RequestOptions): Promise<Payout> {
    return this.postModel(Payout, 'payouts/initiate', this.params('initiate', 'createPayout', params), options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<Payout> {
    return this.getModel(Payout, `payouts/${BaseService.id(id, 'payout id')}`, {}, options);
  }

  list(filters: PayoutListFilters = {}, options?: RequestOptions): CollectionPromise<Payout> {
    return this.listModels(Payout, 'payouts', () => this.params('list', 'payoutFilters', filters), options);
  }

  async waitForFinalStatus(id: string, options?: WaitOptions): Promise<Payout> {
    return this.pollUntilFinal(() => this.retrieve(id), options);
  }
}

/** Top up your Mulla balance. Requires the RECHARGES scope. */
export class RechargeService extends BaseService {
  protected readonly resource = 'recharges';
  protected override readonly scope = ApiScope.RECHARGES;

  async initiate(params: InitiateRechargeParams, options?: RequestOptions): Promise<Recharge> {
    return this.postModel(Recharge, 'recharge/initiate', this.params('initiate', 'initiateRecharge', params), options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<Recharge> {
    return this.getModel(Recharge, `recharge/${BaseService.id(id, 'recharge id')}`, {}, options);
  }

  list(filters: RechargeListFilters = {}, options?: RequestOptions): CollectionPromise<Recharge> {
    return this.listModels(Recharge, 'recharge', () => this.params('list', 'rechargeFilters', filters), options);
  }

  async waitForFinalStatus(id: string, options?: WaitOptions): Promise<Recharge> {
    return this.pollUntilFinal(() => this.retrieve(id), options);
  }
}

/** Invoices and invoice payments. Requires the INVOICES scope (except the public methods). */
export class InvoiceService extends BaseService {
  protected readonly resource = 'invoices';
  protected override readonly scope = ApiScope.INVOICES;

  async create(params: CreateInvoiceParams, options?: RequestOptions): Promise<Invoice> {
    return this.postModel(Invoice, 'invoices', this.params('create', 'createInvoice', params), options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<Invoice> {
    return this.getModel(Invoice, `invoices/${BaseService.id(id, 'invoice id')}`, {}, options);
  }

  list(filters: InvoiceListFilters = {}, options?: RequestOptions): CollectionPromise<Invoice> {
    return this.listModels(Invoice, 'invoices', () => this.params('list', 'invoiceFilters', filters), options);
  }

  async update(id: string, params: UpdateInvoiceParams, options?: RequestOptions): Promise<Invoice> {
    return this.patchModel(
      Invoice,
      `invoices/${BaseService.id(id, 'invoice id')}`,
      this.params('update', 'updateInvoice', params),
      options,
    );
  }

  /** Allowed transitions: ISSUED, CANCELLED, OVERDUE. */
  async updateStatus(id: string, status: InvoiceStatus | (string & {}), options?: RequestOptions): Promise<Invoice> {
    if (typeof status !== 'string' || status === '') {
      throw new InvalidArgumentError('invoices.updateStatus() needs a status, e.g. InvoiceStatus.CANCELLED.');
    }

    return this.patchModel(Invoice, `invoices/${BaseService.id(id, 'invoice id')}/status`, { status }, options);
  }

  listPayments(id: string, options?: RequestOptions): CollectionPromise<PaymentTransaction> {
    return this.listModels(
      PaymentTransaction,
      () => `invoices/${BaseService.id(id, 'invoice id')}/payments`,
      () => ({}),
      options,
    );
  }

  async retrievePayment(id: string, transactionId: string, options?: RequestOptions): Promise<PaymentTransaction> {
    return this.getModel(
      PaymentTransaction,
      `invoices/${BaseService.id(id, 'invoice id')}/payments/${BaseService.id(transactionId, 'transaction id')}`,
      {},
      options,
    );
  }

  /** Public view of an invoice (what the customer sees). */
  async retrievePublic(id: string, options?: RequestOptions): Promise<Invoice> {
    return this.getModel(Invoice, `invoice/${BaseService.id(id, 'invoice id')}`, {}, options);
  }

  /** Public: starts payment of an invoice from the customer's phone. */
  async pay(id: string, params: PayInvoiceParams, options?: RequestOptions): Promise<PaymentInitiation> {
    return this.postModel(
      PaymentInitiation,
      `invoice/${BaseService.id(id, 'invoice id')}/pay`,
      this.params('pay', 'payInvoice', params),
      options,
    );
  }

  /**
   * Public Server-Sent Events URL that streams the invoice's payment status.
   * Open it from a browser (`new EventSource(url)`) to update an invoice page live.
   */
  eventsUrl(id: string): string {
    return `${this.config.baseUrl}/invoice/${BaseService.id(id, 'invoice id')}/events`;
  }
}

/** Manage your customers. Requires the CUSTOMERS scope. */
export class CustomerService extends BaseService {
  protected readonly resource = 'customers';
  protected override readonly scope = ApiScope.CUSTOMERS;

  async create(params: CustomerParams, options?: RequestOptions): Promise<Customer> {
    return this.postModel(Customer, 'customers', this.params('create', 'customer', params), options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<Customer> {
    return this.getModel(Customer, `customers/${BaseService.id(id, 'customer id')}`, {}, options);
  }

  list(filters: CustomerListFilters = {}, options?: RequestOptions): CollectionPromise<Customer> {
    return this.listModels(Customer, 'customers', () => this.params('list', 'customerFilters', filters), options);
  }

  /** Note: the API requires fullName on update too. */
  async update(id: string, params: CustomerParams, options?: RequestOptions): Promise<Customer> {
    return this.patchModel(
      Customer,
      `customers/${BaseService.id(id, 'customer id')}`,
      this.params('update', 'customer', params),
      options,
    );
  }

  /** Blocks the customer from paying. Returns { message }. */
  async blacklist(id: string, options?: RequestOptions): Promise<MullaObject> {
    return this.patchModel(MullaObject, `customers/${BaseService.id(id, 'customer id')}/blacklist`, {}, options);
  }

  async whitelist(id: string, options?: RequestOptions): Promise<MullaObject> {
    return this.patchModel(MullaObject, `customers/${BaseService.id(id, 'customer id')}/whitelist`, {}, options);
  }
}

/** Configure where Mulla sends webhooks (one endpoint per merchant). */
export class WebhookEndpointService extends BaseService {
  protected readonly resource = 'webhookEndpoint';
  /** Store the returned `endpoint.secret`: it is shown only once. */
  async create(params: CreateWebhookEndpointParams, options?: RequestOptions): Promise<WebhookEndpoint> {
    const body = this.params('create', 'createWebhookEndpoint', params);

    return this.postModel(WebhookEndpoint, 'webhooks', { is_active: true, ...body }, options);
  }

  async retrieve(options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.getModel(WebhookEndpoint, 'webhooks', {}, options);
  }

  async update(changes: UpdateWebhookEndpointParams, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.patchModel(
      WebhookEndpoint,
      'webhooks',
      this.params('update', 'updateWebhookEndpoint', changes),
      options,
    );
  }

  /** Issues a new signing secret. The old one stops working immediately. */
  async rotateSecret(options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.postModel(WebhookEndpoint, 'webhooks/rotate-secret', {}, options);
  }

  /** Sends a signed "webhook.test" event to your endpoint and reports what it answered. */
  async test(options?: RequestOptions): Promise<WebhookTestResult> {
    return this.postModel(WebhookTestResult, 'webhooks/test', {}, options);
  }
}

/** Read-only reference data: banks, bank branches, countries, currencies, API scopes. */
export class ReferenceDataService extends BaseService {
  protected readonly resource = 'referenceData';
  /** `country` is required. */
  banks(filters: BankFilters, options?: RequestOptions): CollectionPromise<MullaObject> {
    return this.listModels(MullaObject, 'banks', () => this.params('banks', 'bankFilters', filters), options);
  }

  /** `code` or `swift` is required. */
  bankBranches(filters: BankBranchFilters, options?: RequestOptions): CollectionPromise<MullaObject> {
    return this.listModels(
      MullaObject,
      'banks/branches',
      () => {
        const query = this.params('bankBranches', 'bankBranchFilters', filters);
        if (query.code === undefined && query.swift === undefined) {
          throw new InvalidArgumentError('referenceData.bankBranches() needs a code or a swift filter.');
        }

        return query;
      },
      options,
    );
  }

  countries(filters: CountryFilters = {}, options?: RequestOptions): CollectionPromise<MullaObject> {
    return this.listModels(
      MullaObject,
      'countries',
      () => this.params('countries', 'countryFilters', filters),
      options,
    );
  }

  currencies(filters: CurrencyFilters = {}, options?: RequestOptions): CollectionPromise<MullaObject> {
    return this.listModels(
      MullaObject,
      'currencies',
      () => this.params('currencies', 'currencyFilters', filters),
      options,
    );
  }

  scopes(filters: ScopeFilters = {}, options?: RequestOptions): CollectionPromise<MullaObject> {
    return this.listModels(MullaObject, 'scopes', () => this.params('scopes', 'scopeFilters', filters), options);
  }
}
