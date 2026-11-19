import type { WebhookEventType } from '../enums.js';
import type { Event } from './event.js';

export type EventListener = (event: Event) => unknown;

const ANY = '*';

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

  async dispatch(event: Event): Promise<number> {
    const listeners = [...(this.#listeners.get(event.type) ?? []), ...(this.#listeners.get(ANY) ?? [])];
    for (const listener of listeners) {
      await listener(event);
    }

    return listeners.length;
  }
}
