/*
 * Enums are plain objects plus union types, so both `Provider.MTN_RW` and the string
 * 'MTN_RW' work wherever a value is expected.
 */

export const Provider = {
  MTN_RW: 'MTN_RW',
  AIRTEL_RW: 'AIRTEL_RW',
} as const;
export type Provider = (typeof Provider)[keyof typeof Provider];

const PROVIDER_LABELS: Record<Provider, string> = {
  MTN_RW: 'MTN Mobile Money',
  AIRTEL_RW: 'Airtel Money',
};

export function providerLabel(provider: Provider): string {
  return PROVIDER_LABELS[provider];
}

export const Language = {
  EN: 'en',
  FR: 'fr',
  RW: 'rw',
  SW: 'sw',
} as const;
export type Language = (typeof Language)[keyof typeof Language];

export const Currency = {
  RWF: 'RWF',
  USD: 'USD',
  UGX: 'UGX',
  KES: 'KES',
  TZS: 'TZS',
  BIF: 'BIF',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

export const ChargeStatus = {
  PENDING: 'PENDING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;
export type ChargeStatus = (typeof ChargeStatus)[keyof typeof ChargeStatus];

export const RechargeStatus = ChargeStatus;
export type RechargeStatus = ChargeStatus;

export const PayoutStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  SCHEDULED: 'SCHEDULED',
  EXPIRED: 'EXPIRED',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export const InvoiceStatus = {
  ISSUED: 'ISSUED',
  PENDING: 'PENDING',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const WebhookEventType = {
  CHARGE_SUCCESS: 'charge.success',
  CHARGE_FAILED: 'charge.failed',
  CHARGE_EXPIRED: 'charge.expired',
  PAYOUT_SUCCESS: 'payout.success',
  PAYOUT_FAILED: 'payout.failed',
  INVOICE_PAID: 'invoice.paid',
  WEBHOOK_TEST: 'webhook.test',
} as const;
export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

export const ApiScope = {
  CHARGES: 'CHARGES',
  PAYOUTS: 'PAYOUTS',
  INVOICES: 'INVOICES',
  RECHARGES: 'RECHARGES',
  CUSTOMERS: 'CUSTOMERS',
} as const;
export type ApiScope = (typeof ApiScope)[keyof typeof ApiScope];

export const FINAL_STATUSES = {
  charge: [ChargeStatus.SUCCESSFUL, ChargeStatus.FAILED, ChargeStatus.EXPIRED] as readonly ChargeStatus[],
  payout: [
    PayoutStatus.COMPLETED,
    PayoutStatus.FAILED,
    PayoutStatus.REJECTED,
    PayoutStatus.CANCELLED,
    PayoutStatus.EXPIRED,
  ] as readonly PayoutStatus[],
  invoice: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] as readonly InvoiceStatus[],
  payment: [
    PaymentStatus.SUCCESSFUL,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ] as readonly PaymentStatus[],
} as const;

export function enumValue<T extends string>(values: Record<string, T>, value: unknown): T | null {
  return typeof value === 'string' && (Object.values(values) as string[]).includes(value) ? (value as T) : null;
}
