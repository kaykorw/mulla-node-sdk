import { enumValue, WebhookEventType } from '../enums.js';

/**
 * A verified webhook event.
 *
 *     event.type          "charge.success"
 *     event.eventType     WebhookEventType.CHARGE_SUCCESS (null for unknown future events)
 *     event.id            unique event id: use it to ignore duplicate deliveries
 *     event.data          the raw payload data
 *     event.objectId()    id of the charge / payout / invoice concerned
 */
export class Event {
  /** The known event type, or null for an event added after this SDK version. */
  readonly eventType: WebhookEventType | null;

  constructor(
    readonly id: string,
    readonly type: string,
    readonly data: Readonly<Record<string, unknown>>,
  ) {
    this.eventType = enumValue(WebhookEventType, type);
  }

  /** @param payload decoded { event, event_id, data } */
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

  /** Id of the charge, payout or invoice the event is about. */
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

  /** Your metadata from the original charge/payout, when the server includes it. */
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
