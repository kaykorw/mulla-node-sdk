import {
  ChargeStatus,
  FINAL_STATUSES,
  InvoiceStatus,
  PaymentStatus,
  PayoutStatus,
  Provider,
  RechargeStatus,
} from '../enums.js';
import {
  bool,
  date,
  int,
  makeModels,
  Model,
  money,
  obj,
  oneOf,
  relationId,
  str,
  strings,
  type RawData,
} from './model.js';

export { Collection, CollectionPromise } from './collection.js';
export { Model, type RawData } from './model.js';

/**
 * A charge collects money from a customer's mobile money wallet.
 * It is created PENDING; the customer approves on their phone; it becomes
 * SUCCESSFUL, FAILED, or EXPIRED (after 10 minutes).
 */
export class Charge extends Model {
  readonly id: string;
  /** Human-friendly reference, e.g. "CHG..." */
  readonly reference: string | null;
  readonly amount: number | null;
  readonly feeAmount: number | null;
  readonly netAmount: number | null;
  readonly additionalFee: number | null;
  readonly currency: string | null;
  readonly phoneNumber: string | null;
  readonly provider: Provider | null;
  readonly status: ChargeStatus | null;
  readonly reason: string | null;
  readonly application: string | null;
  readonly notes: string | null;
  readonly billingDetails: Record<string, unknown> | null;
  readonly shippingDetails: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown> | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id') ?? '';
    this.reference = str(data, 'reference');
    this.amount = money(data, 'amount');
    this.feeAmount = money(data, 'fee_amount');
    this.netAmount = money(data, 'net_amount');
    this.additionalFee = money(data, 'additional_fee');
    this.currency = str(data, 'currency');
    this.phoneNumber = str(data, 'phone_number');
    this.provider = oneOf(data, 'provider', Provider);
    this.status = oneOf(data, 'status', ChargeStatus);
    this.reason = str(data, 'reason');
    this.application = str(data, 'application');
    this.notes = str(data, 'notes');
    this.billingDetails = obj(data, 'billing_details');
    this.shippingDetails = obj(data, 'shipping_details');
    this.metadata = obj(data, 'metadata');
    this.failureCode = str(data, 'failure_code');
    this.failureMessage = str(data, 'failure_message');
    this.expiresAt = date(data, 'expires_at');
    this.createdAt = date(data, 'created_at');
  }

  isPending(): boolean {
    return this.status === ChargeStatus.PENDING;
  }

  isSuccessful(): boolean {
    return this.status === ChargeStatus.SUCCESSFUL;
  }

  isFinal(): boolean {
    return this.status !== null && FINAL_STATUSES.charge.includes(this.status);
  }
}

/**
 * A hosted checkout session. Redirect your customer to `checkoutUrl`; Mulla sends
 * them back to `successUrl` or `cancelUrl`. Always confirm the result server-side
 * (webhook or `mulla.charges.retrieve(session.charge)`): return URLs are not signed.
 */
export class CheckoutSession extends Model {
  readonly id: string;
  /** Id of the underlying charge. */
  readonly charge: string | null;
  readonly reference: string | null;
  readonly amount: number | null;
  readonly feeAmount: number | null;
  readonly netAmount: number | null;
  readonly currency: string | null;
  readonly reason: string | null;
  readonly phoneNumber: string | null;
  readonly provider: Provider | null;
  readonly status: ChargeStatus | null;
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
  /** Only returned when the session is created. */
  readonly checkoutUrl: string | null;
  /** Only returned when the session is created. Needed for the public checkout endpoints. */
  readonly token: string | null;
  /** Keys: name, merchant_code, logo_url, support_email, support_phone. */
  readonly merchant: Record<string, unknown> | null;
  readonly expiresAt: Date | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id') ?? '';
    this.charge = relationId(data, 'charge');
    this.reference = str(data, 'reference');
    this.amount = money(data, 'amount');
    this.feeAmount = money(data, 'fee_amount');
    this.netAmount = money(data, 'net_amount');
    this.currency = str(data, 'currency');
    this.reason = str(data, 'reason');
    this.phoneNumber = str(data, 'phone_number');
    this.provider = oneOf(data, 'provider', Provider);
    this.status = oneOf(data, 'status', ChargeStatus);
    this.successUrl = str(data, 'success_url');
    this.cancelUrl = str(data, 'cancel_url');
    this.checkoutUrl = str(data, 'checkout_url');
    this.token = str(data, 'token');
    this.merchant = obj(data, 'merchant');
    this.expiresAt = date(data, 'expires_at');
  }

  isSuccessful(): boolean {
    return this.status === ChargeStatus.SUCCESSFUL;
  }

  isFinal(): boolean {
    return this.status !== null && FINAL_STATUSES.charge.includes(this.status);
  }
}

/**
 * A payout sends money from your Mulla balance to a mobile money wallet.
 * The amount is reserved from your balance as soon as the payout is created.
 */
export class Payout extends Model {
  readonly id: string;
  readonly provider: Provider | null;
  readonly amount: number | null;
  readonly feeAmount: number | null;
  readonly netAmount: number | null;
  readonly currency: string | null;
  readonly phoneNumber: string | null;
  readonly reason: string | null;
  readonly status: PayoutStatus | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly approvedAt: Date | null;
  readonly scheduledAt: Date | null;
  readonly completedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id') ?? '';
    this.provider = oneOf(data, 'provider', Provider);
    this.amount = money(data, 'amount');
    this.feeAmount = money(data, 'fee_amount');
    this.netAmount = money(data, 'net_amount');
    this.currency = str(data, 'currency');
    this.phoneNumber = str(data, 'phone_number');
    this.reason = str(data, 'reason');
    this.status = oneOf(data, 'status', PayoutStatus);
    this.failureCode = str(data, 'failure_code');
    this.failureMessage = str(data, 'failure_message');
    this.approvedAt = date(data, 'approved_at');
    this.scheduledAt = date(data, 'scheduled_at');
    this.completedAt = date(data, 'completed_at');
    this.expiresAt = date(data, 'expires_at');
    this.createdAt = date(data, 'created_at');
  }

  isSuccessful(): boolean {
    return this.status === PayoutStatus.COMPLETED;
  }

  isFinal(): boolean {
    return this.status !== null && FINAL_STATUSES.payout.includes(this.status);
  }
}

/**
 * A recharge tops up your own Mulla balance from a mobile money wallet
 * (for example, to fund payouts).
 */
export class Recharge extends Model {
  readonly id: string;
  readonly reference: string | null;
  readonly amount: number | null;
  readonly feeAmount: number | null;
  readonly netAmount: number | null;
  readonly phoneNumber: string | null;
  readonly provider: Provider | null;
  readonly status: RechargeStatus | null;
  readonly metadata: Record<string, unknown> | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly createdAt: Date | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id') ?? '';
    this.reference = str(data, 'reference');
    this.amount = money(data, 'amount');
    this.feeAmount = money(data, 'fee_amount');
    this.netAmount = money(data, 'net_amount');
    this.phoneNumber = str(data, 'phone_number');
    this.provider = oneOf(data, 'provider', Provider);
    this.status = oneOf(data, 'status', RechargeStatus);
    this.metadata = obj(data, 'metadata');
    this.failureCode = str(data, 'failure_code');
    this.failureMessage = str(data, 'failure_message');
    this.createdAt = date(data, 'created_at');
  }

  isSuccessful(): boolean {
    return this.status === RechargeStatus.SUCCESSFUL;
  }

  isFinal(): boolean {
    return this.status !== null && FINAL_STATUSES.charge.includes(this.status);
  }
}

export class InvoiceItem extends Model {
  readonly id: string | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly quantity: number | null;
  readonly unitPrice: number | null;
  readonly amount: number | null;
  readonly taxRate: number | null;
  readonly taxAmount: number | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id');
    this.name = str(data, 'name');
    this.description = str(data, 'description');
    this.imageUrl = str(data, 'image_url');
    this.quantity = int(data, 'quantity');
    this.unitPrice = money(data, 'unit_price');
    this.amount = money(data, 'amount');
    this.taxRate = money(data, 'tax_rate');
    this.taxAmount = money(data, 'tax_amount');
  }
}

/** An invoice your customer can pay through its public link. */
export class Invoice extends Model {
  readonly id: string;
  readonly invoiceNumber: string | null;
  readonly status: InvoiceStatus | null;
  readonly customer: string | null;
  readonly customerName: string | null;
  readonly customerEmail: string | null;
  readonly customerPhone: string | null;
  readonly subtotal: number | null;
  readonly taxAmount: number | null;
  readonly discountAmount: number | null;
  readonly totalAmount: number | null;
  readonly feeAmount: number | null;
  readonly currency: string | null;
  readonly notes: string | null;
  readonly application: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly items: readonly InvoiceItem[];
  readonly merchant: Record<string, unknown> | null;
  readonly issueDate: Date | null;
  readonly dueDate: Date | null;
  readonly createdAt: Date | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id') ?? '';
    this.invoiceNumber = str(data, 'invoice_number');
    this.status = oneOf(data, 'status', InvoiceStatus);
    this.customer = relationId(data, 'customer');
    this.customerName = str(data, 'customer_name');
    this.customerEmail = str(data, 'customer_email');
    this.customerPhone = str(data, 'customer_phone');
    this.subtotal = money(data, 'subtotal');
    this.taxAmount = money(data, 'tax_amount');
    this.discountAmount = money(data, 'discount_amount');
    this.totalAmount = money(data, 'total_amount');
    this.feeAmount = money(data, 'fee_amount');
    this.currency = str(data, 'currency');
    this.notes = str(data, 'notes');
    this.application = str(data, 'application');
    this.metadata = obj(data, 'metadata');
    this.items = makeModels(InvoiceItem, data.items);
    this.merchant = obj(data, 'merchant');
    this.issueDate = date(data, 'issue_date');
    this.dueDate = date(data, 'due_date');
    this.createdAt = date(data, 'created_at');
  }

  isPaid(): boolean {
    return this.status === InvoiceStatus.PAID;
  }

  isFinal(): boolean {
    return this.status !== null && FINAL_STATUSES.invoice.includes(this.status);
  }
}

/** One provider payment attempt (e.g. a payment made against an invoice). */
export class PaymentTransaction extends Model {
  readonly id: string;
  readonly transactionId: string | null;
  readonly provider: Provider | null;
  readonly amount: number | null;
  readonly feeAmount: number | null;
  readonly currency: string | null;
  readonly customerPhone: string | null;
  readonly status: PaymentStatus | null;
  readonly failureReason: string | null;
  readonly createdAt: Date | null;
  readonly completedAt: Date | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id') ?? '';
    this.transactionId = str(data, 'transaction_id');
    this.provider = oneOf(data, 'provider', Provider);
    this.amount = money(data, 'amount');
    this.feeAmount = money(data, 'fee_amount');
    this.currency = str(data, 'currency');
    this.customerPhone = str(data, 'customer_phone');
    this.status = oneOf(data, 'status', PaymentStatus);
    this.failureReason = str(data, 'failure_reason');
    this.createdAt = date(data, 'created_at');
    this.completedAt = date(data, 'completed_at');
  }

  isSuccessful(): boolean {
    return this.status === PaymentStatus.SUCCESSFUL;
  }

  isFinal(): boolean {
    return this.status !== null && FINAL_STATUSES.payment.includes(this.status);
  }
}

/** Result of paying an invoice: the started payment plus instructions for the customer. */
export class PaymentInitiation extends Model {
  readonly payment: PaymentTransaction | null;
  readonly message: string | null;
  /** Text to show the customer, e.g. "Approve the prompt on your phone". */
  readonly instructions: string | null;

  constructor(data: RawData) {
    super(data);
    const payment = obj(data, 'payment');
    this.payment = payment !== null ? new PaymentTransaction(payment) : null;
    this.message = str(data, 'message');
    this.instructions = str(data, 'instructions');
  }
}

export class Customer extends Model {
  readonly id: string;
  readonly fullName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly companyName: string | null;
  readonly countryOfOrigin: string | null;
  readonly city: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly isActive: boolean | null;
  readonly createdAt: Date | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id') ?? '';
    this.fullName = str(data, 'full_name');
    this.email = str(data, 'email');
    this.phone = str(data, 'phone');
    this.address = str(data, 'address');
    // The API returns camelCase on list/create and snake_case on retrieve.
    this.companyName = str(data, 'companyName') ?? str(data, 'company_name');
    this.countryOfOrigin = str(data, 'countryOfOrigin') ?? str(data, 'country_of_origin');
    this.city = str(data, 'city');
    this.metadata = obj(data, 'metadata');
    this.isActive = bool(data, 'is_active');
    this.createdAt = date(data, 'created_at');
  }
}

/**
 * Your account's webhook configuration (one per merchant).
 * The full `secret` is only returned on create and rotateSecret(); otherwise it is masked.
 */
export class WebhookEndpoint extends Model {
  readonly id: string;
  readonly url: string | null;
  readonly secret: string | null;
  readonly isActive: boolean | null;
  readonly events: readonly string[];
  /** IP addresses Mulla sends webhooks from; useful for firewall allowlists. */
  readonly egressIps: readonly string[];
  readonly signatureHeader: string | null;
  readonly signatureAlgorithm: string | null;
  readonly createdAt: Date | null;

  constructor(data: RawData) {
    super(data);
    this.id = str(data, 'id') ?? '';
    this.url = str(data, 'url');
    this.secret = str(data, 'secret');
    this.isActive = bool(data, 'is_active');
    this.events = strings(data, 'events');
    this.egressIps = strings(data, 'egress_ips');
    this.signatureHeader = str(data, 'signature_header');
    this.signatureAlgorithm = str(data, 'signature_algorithm');
    this.createdAt = date(data, 'created_at');
  }
}

/** Outcome of sending a test webhook to your endpoint. */
export class WebhookTestResult extends Model {
  /** True when your endpoint answered 2xx. */
  readonly ok: boolean;
  readonly statusCode: number | null;
  readonly responseBody: string | null;
  readonly error: string | null;

  constructor(data: RawData) {
    super(data);
    this.ok = bool(data, 'ok') ?? false;
    this.statusCode = int(data, 'status_code');
    this.responseBody = str(data, 'response_body');
    this.error = str(data, 'error');
  }
}

/**
 * Generic object for reference data (banks, branches, countries, currencies, scopes)
 * and short responses such as {"message": "..."}. Read fields with `get()` or `raw`:
 * `bank.get('name')`, `bank.raw.swift`.
 */
export class MullaObject extends Model {}
