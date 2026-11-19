import type { ChargeStatus, Currency, InvoiceStatus, PayoutStatus, Provider, RechargeStatus } from './enums.js';
import { InvalidArgumentError } from './errors.js';
import { isPlainObject, normalize } from './support/normalizer.js';

/** Known values autocomplete; any other string is still accepted (for values added later). */
type Open<T extends string> = T | (string & {});

/** Your own key/value data, returned on the object (e.g. { orderId: 1001 }). Sent as-is. */
export type Metadata = Record<string, unknown>;

/** A Mulla customer id, or `{ id }`. */
export type CustomerRef = string | { id: string };

/** Fields shared by direct charges and checkout sessions. */
export interface ChargeFields {
  /** Amount in the currency's major unit (RWF). Minimum 10. */
  amount: number;
  currency?: Open<Currency>;
  /** Short description shown to the customer, e.g. "Order #1001". */
  reason?: string;
  /** Name of the app/site that created the charge (max 255 chars). */
  application?: string;
  notes?: string;
  billingDetails?: Record<string, unknown>;
  shippingDetails?: Record<string, unknown>;
  metadata?: Metadata;
  /** Link the charge to an existing Mulla customer. */
  customer?: CustomerRef;
}

/** Direct charge: sends a payment prompt to the customer's phone. */
export interface InitiateChargeParams extends ChargeFields {
  provider: Open<Provider>;
  /** Customer's mobile money number, e.g. "250788000000". */
  phoneNumber: string;
}

/** Hosted checkout: Mulla's page collects the provider and phone number. */
export interface CreateCheckoutParams extends ChargeFields {
  /** Where the customer lands after paying. Confirm the payment server-side. */
  successUrl: string;
  /** Where the customer lands if they cancel. */
  cancelUrl: string;
}

/** Send money from your Mulla balance to a phone. */
export interface CreatePayoutParams {
  provider: Open<Provider>;
  amount: number;
  phoneNumber: string;
  reason: string;
  metadata?: Metadata;
}

/** Top up your Mulla balance from a mobile money wallet. */
export interface InitiateRechargeParams {
  provider: Open<Provider>;
  amount: number;
  phoneNumber: string;
  reason?: string;
  metadata?: Metadata;
}

/** Create or update a customer. fullName is required in both cases. */
export interface CustomerParams {
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
  companyName?: string;
  countryOfOrigin?: string;
  city?: string;
  metadata?: Metadata;
}

export interface InvoiceItemParams {
  name: string;
  unitPrice: number;
  quantity?: number;
  description?: string;
  taxRate?: number;
  imageUrl?: string;
  metadata?: Metadata;
}

export interface CreateInvoiceParams {
  customer: CustomerRef;
  items: InvoiceItemParams[];
  invoiceNumber?: string;
  dueDate?: Date | string;
  notes?: string;
  application?: string;
  billingDetails?: Record<string, unknown>;
  shippingDetails?: Record<string, unknown>;
  metadata?: Metadata;
}

/** Every field is optional on update. */
export type UpdateInvoiceParams = Partial<CreateInvoiceParams>;

export interface PayParams {
  provider: Open<Provider>;
  phoneNumber: string;
}

export interface PayInvoiceParams extends PayParams {
  notes?: string;
}

export interface CreateWebhookEndpointParams {
  url: string;
  /** Default true. */
  isActive?: boolean;
}

export interface UpdateWebhookEndpointParams {
  url?: string;
  isActive?: boolean;
}

export interface WaitOptions {
  /** Give up after this many ms (default 120000). The latest object is returned either way. */
  timeoutMs?: number;
  /** Time between polls in ms (default 5000, minimum 1000). */
  intervalMs?: number;
}

// ---- list filters ----------------------------------------------------------------------

export interface PageFilters {
  page?: number;
  limit?: number;
}

export interface SortFilters {
  sortField?: string;
  sortDirection?: 'ASC' | 'DESC';
}

export interface DateFilters {
  startDate?: Date | string;
  endDate?: Date | string;
}

export interface ChargeListFilters extends PageFilters, SortFilters, DateFilters {
  status?: Open<ChargeStatus>;
  keyword?: string;
}

export interface PayoutListFilters extends PageFilters, SortFilters, DateFilters {
  status?: Open<PayoutStatus>;
  keyword?: string;
}

export interface RechargeListFilters extends PageFilters, DateFilters {
  status?: Open<RechargeStatus>;
  keyword?: string;
}

export interface InvoiceListFilters extends PageFilters, SortFilters, DateFilters {
  status?: Open<InvoiceStatus>;
  keyword?: string;
  /** Customer id. */
  customer?: string;
}

export interface CustomerListFilters extends PageFilters, SortFilters {
  keyword?: string;
  isActive?: boolean;
}

export interface BankFilters extends PageFilters {
  /** Required, e.g. "RW". */
  country: string;
  keyword?: string;
  name?: string;
  swift?: string;
}

/** `code` or `swift` is required. */
export interface BankBranchFilters extends PageFilters {
  code?: string;
  swift?: string;
  keyword?: string;
}

export interface CountryFilters extends PageFilters {
  keyword?: string;
  iso?: string;
  currency?: string;
  isSupported?: boolean;
}

export interface CurrencyFilters extends PageFilters {
  keyword?: string;
  code?: string;
  isSupported?: boolean;
}

export interface ScopeFilters extends PageFilters {
  keyword?: string;
}

// ---- mapping to the API's field names --------------------------------------------------

type Transform = (value: unknown) => unknown;
/** camelCase SDK name => API name, or [API name, transform]. */
export type FieldMap = Readonly<Record<string, string | readonly [string, Transform]>>;

const customerRef: Transform = (value) => (typeof value === 'string' ? { id: value } : value);

const CHARGE_FIELDS: FieldMap = {
  amount: 'amount',
  currency: 'currency',
  reason: 'reason',
  application: 'application',
  notes: 'notes',
  billingDetails: 'billing_details',
  shippingDetails: 'shipping_details',
  metadata: 'metadata',
  customer: ['customer', customerRef],
};

const INVOICE_ITEM: FieldMap = {
  name: 'name',
  unitPrice: 'unit_price',
  quantity: 'quantity',
  description: 'description',
  taxRate: 'tax_rate',
  imageUrl: 'image_url',
  metadata: 'metadata',
};

const INVOICE: FieldMap = {
  customer: ['customer', customerRef],
  items: [
    'items',
    (items) =>
      Array.isArray(items)
        ? items.map((item, i) => mapFields(`items[${i}]`, item, INVOICE_ITEM, ['name', 'unitPrice']))
        : items,
  ],
  invoiceNumber: 'invoice_number',
  dueDate: 'due_date',
  notes: 'notes',
  application: 'application',
  billingDetails: 'billing_details',
  shippingDetails: 'shipping_details',
  metadata: 'metadata',
};

const PAGE: FieldMap = { page: 'page', limit: 'limit' };
const SORT: FieldMap = { sortField: 'sortField', sortDirection: 'sortDirection' };
const DATES: FieldMap = { startDate: 'start_date', endDate: 'end_date' };

/** @internal Field maps and required fields for every request body and filter. */
export const SCHEMAS = {
  initiateCharge: {
    fields: { ...CHARGE_FIELDS, provider: 'provider', phoneNumber: 'phone_number' },
    required: ['provider', 'amount', 'phoneNumber'],
  },
  createCheckout: {
    fields: { ...CHARGE_FIELDS, successUrl: 'success_url', cancelUrl: 'cancel_url' },
    required: ['amount', 'successUrl', 'cancelUrl'],
  },
  createPayout: {
    fields: {
      provider: 'provider',
      amount: 'amount',
      phoneNumber: 'phone_number',
      reason: 'reason',
      metadata: 'metadata',
    },
    required: ['provider', 'amount', 'phoneNumber', 'reason'],
  },
  initiateRecharge: {
    fields: {
      provider: 'provider',
      amount: 'amount',
      phoneNumber: 'phone_number',
      reason: 'reason',
      metadata: 'metadata',
    },
    required: ['provider', 'amount', 'phoneNumber'],
  },
  customer: {
    fields: {
      fullName: 'full_name',
      email: 'email',
      phone: 'phone',
      address: 'address',
      companyName: 'company_name',
      countryOfOrigin: 'country_of_origin',
      city: 'city',
      metadata: 'metadata',
    },
    required: ['fullName'],
  },
  createInvoice: { fields: INVOICE, required: ['customer', 'items'] },
  updateInvoice: { fields: INVOICE, required: [] },
  pay: { fields: { provider: 'provider', phoneNumber: 'phone_number' }, required: ['provider', 'phoneNumber'] },
  payInvoice: {
    fields: { provider: 'provider', phoneNumber: 'phone_number', notes: 'notes' },
    required: ['provider', 'phoneNumber'],
  },
  createWebhookEndpoint: { fields: { url: 'url', isActive: 'is_active' }, required: ['url'] },
  updateWebhookEndpoint: { fields: { url: 'url', isActive: 'is_active' }, required: [] },

  chargeFilters: { fields: { ...PAGE, ...SORT, ...DATES, status: 'status', keyword: 'keyword' }, required: [] },
  payoutFilters: { fields: { ...PAGE, ...SORT, ...DATES, status: 'status', keyword: 'keyword' }, required: [] },
  rechargeFilters: { fields: { ...PAGE, ...DATES, status: 'status', keyword: 'keyword' }, required: [] },
  invoiceFilters: {
    fields: { ...PAGE, ...SORT, ...DATES, status: 'status', keyword: 'keyword', customer: 'customer' },
    required: [],
  },
  customerFilters: { fields: { ...PAGE, ...SORT, keyword: 'keyword', isActive: 'is_active' }, required: [] },
  bankFilters: {
    fields: { ...PAGE, country: 'country', keyword: 'keyword', name: 'name', swift: 'swift' },
    required: ['country'],
  },
  bankBranchFilters: { fields: { ...PAGE, code: 'code', swift: 'swift', keyword: 'keyword' }, required: [] },
  countryFilters: {
    fields: { ...PAGE, keyword: 'keyword', iso: 'iso', currency: 'currency', isSupported: 'is_supported' },
    required: [],
  },
  currencyFilters: {
    fields: { ...PAGE, keyword: 'keyword', code: 'code', isSupported: 'is_supported' },
    required: [],
  },
  scopeFilters: { fields: { ...PAGE, keyword: 'keyword' }, required: [] },
} as const satisfies Record<string, { fields: FieldMap; required: readonly string[] }>;

export type SchemaName = keyof typeof SCHEMAS;

/**
 * @internal Maps SDK params to the API's field names. Unknown keys and missing required fields
 * are reported before anything is sent (the API rejects unknown fields too).
 */
export function toApi(context: string, schema: SchemaName, input: unknown): Record<string, unknown> {
  const { fields, required } = SCHEMAS[schema];

  return normalize(mapFields(context, input ?? {}, fields, required)) as Record<string, unknown>;
}

function mapFields(
  context: string,
  input: unknown,
  fields: FieldMap,
  required: readonly string[],
): Record<string, unknown> {
  if (!isPlainObject(input)) {
    throw new InvalidArgumentError(`${context} expects an object.`);
  }

  const unknown = Object.keys(input).filter((key) => !Object.hasOwn(fields, key));
  if (unknown.length > 0) {
    const snakeHint = unknown.some((key) => key.includes('_')) ? ' Use camelCase names (e.g. phoneNumber).' : '';
    throw new InvalidArgumentError(
      `${context} got unknown field(s): ${unknown.join(', ')}.${snakeHint} Allowed: ${Object.keys(fields).join(', ')}.`,
    );
  }

  const missing = required.filter((key) => input[key] === undefined || input[key] === null || input[key] === '');
  if (missing.length > 0) {
    throw new InvalidArgumentError(`${context} is missing required field(s): ${missing.join(', ')}.`);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    const spec = fields[key]!;
    if (typeof spec === 'string') {
      out[spec] = value;
    } else {
      out[spec[0]] = spec[1](value);
    }
  }

  return out;
}
