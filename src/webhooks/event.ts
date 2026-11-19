import { enumValue, WebhookEventType } from '../enums.js';

export class Event {
  readonly eventType: WebhookEventType | null;

  constructor(
    readonly id: string,
    readonly type: string,
    readonly data: Readonly<Record<string, unknown>>,
  ) {
    this.eventType = enumValue(WebhookEventType, type);
  }

  static fromPayload(payload: Record<string, unknown>): Event {
    const data = payload.data;

    return new Event(
      scalar(payload.event_id) ?? '',
      scalar(payload.event) ?? '',
      data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
    );
  }

  is(type: WebhookEventType | (string & {})): boolean {
    return this.type === type;
  }

  isTest(): boolean {
    return this.eventType === WebhookEventType.WEBHOOK_TEST;
  }

  isCharge(): boolean {
    return this.type.startsWith('charge.');
  }

  isPayout(): boolean {
    return this.type.startsWith('payout.');
  }

  isInvoice(): boolean {
    return this.type.startsWith('invoice.');
  }

  objectId(): string | null {
    for (const key of ['charge', 'payout', 'invoice']) {
      const value = this.data[key];
      const id = scalar(value);
      if (id !== null) {
        return id;
      }
      if (value !== null && typeof value === 'object') {
        const nested = scalar((value as Record<string, unknown>).id);
        if (nested !== null) {
          return nested;
        }
      }
    }

    return null;
  }

  reference(): string | null {
    return scalar(this.data.reference);
  }

  transactionId(): string | null {
    return scalar(this.data.transaction_id);
  }

  status(): string | null {
    return scalar(this.data.status);
  }

  currency(): string | null {
    return scalar(this.data.currency);
  }

  amount(): number | null {
    const value = this.data.amount;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);

    return null;
  }

  metadata(): Record<string, unknown> | null {
    const value = this.data.metadata;

    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  toJSON(): { event: string; event_id: string; data: Record<string, unknown> } {
    return { event: this.type, event_id: this.id, data: { ...this.data } };
  }
}

function scalar(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}
