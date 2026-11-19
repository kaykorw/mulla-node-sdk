import type { WebhookEventType } from '../enums.js';
import type { Event } from './event.js';

export type EventListener = (event: Event) => unknown;

const ANY = '*';

/**
 * Observer: register listeners per event type and dispatch verified events to them.
 *
 *     const dispatcher = new EventDispatcher()
 *       .on(WebhookEventType.CHARGE_SUCCESS, (e) => markOrderPaid(e.metadata()?.orderId))
 *       .on(WebhookEventType.CHARGE_FAILED, (e) => markOrderFailed(e))
 *       .onAny((e) => logger.info(e.type));
 *
 *     await dispatcher.dispatch(event);
 */
export class EventDispatcher {
  readonly #listeners = new Map<string, EventListener[]>();

  on(type: WebhookEventType | (string & {}), listener: EventListener): this {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);

    return this;
  }

  onAny(listener: EventListener): this {
    return this.on(ANY, listener);
  }

  hasListeners(type: WebhookEventType | (string & {})): boolean {
    return this.#listeners.has(type) || this.#listeners.has(ANY);
  }

  /**
   * Calls the listeners for the event's type, then the wildcard ones, one after another
   * (awaiting async listeners). A listener that throws stops the dispatch.
   *
   * @returns the number of listeners called
   */
  async dispatch(event: Event): Promise<number> {
    const listeners = [...(this.#listeners.get(event.type) ?? []), ...(this.#listeners.get(ANY) ?? [])];
    for (const listener of listeners) {
      await listener(event);
    }

    return listeners.length;
  }
}
