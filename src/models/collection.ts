import { makeModels, type Model, type ModelClass } from './model.js';

export type PageFetcher<T extends Model> = (page: number) => Promise<Collection<T>>;

/**
 * A page of results from a list endpoint.
 *
 *  - `for await (const item of collection)` walks EVERY item across all pages (fetched lazily)
 *  - `collection.data`                      only the items of this page
 *  - `await collection.nextPage()`          the next page, or null
 *
 * Iterator pattern: pagination is hidden behind a plain `for await`.
 */
export class Collection<T extends Model> implements AsyncIterable<T> {
  readonly #fetchPage: PageFetcher<T> | null;

  constructor(
    readonly data: readonly T[],
    readonly total: number,
    readonly page: number,
    readonly limit: number,
    readonly totalPages: number,
    fetchPage: PageFetcher<T> | null = null,
  ) {
    this.#fetchPage = fetchPage;
  }

  /**
   * Builds a collection from either the paginated shape
   * {data, total, page, limit, total_pages} or a plain JSON array.
   */
  static fromResponse<M extends Model>(
    Class: ModelClass<M>,
    response: unknown,
    fetchPage: PageFetcher<M> | null = null,
  ): Collection<M> {
    if (Array.isArray(response)) {
      const items = makeModels(Class, response);

      return new Collection(items, items.length, 1, Math.max(1, items.length), 1);
    }

    const body = (response !== null && typeof response === 'object' ? response : {}) as Record<string, unknown>;
    const items = makeModels(Class, body.data);
    const limit = toInt(body.limit, items.length);
    const total = toInt(body.total, items.length);

    return new Collection(
      items,
      total,
      toInt(body.page, 1),
      Math.max(1, limit),
      toInt(body.total_pages, limit > 0 ? Math.ceil(total / limit) : 1),
      fetchPage,
    );
  }

  hasMore(): boolean {
    return this.page < this.totalPages && this.#fetchPage !== null;
  }

  /** The next page, or null on the last page. */
  async nextPage(): Promise<Collection<T> | null> {
    if (this.#fetchPage === null || this.page >= this.totalPages) {
      return null;
    }

    return this.#fetchPage(this.page + 1);
  }

  /** Items on this page only. */
  get length(): number {
    return this.data.length;
  }

  isEmpty(): boolean {
    return this.data.length === 0;
  }

  first(): T | null {
    return this.data[0] ?? null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    yield* this.data;
    let page = await this.nextPage();
    while (page !== null && !page.isEmpty()) {
      yield* page.data;
      page = await page.nextPage();
    }
  }
}

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * What list methods return: await it for the first page, or iterate it directly
 * to walk every page:
 *
 *     const page = await mulla.charges.list({ limit: 20 });
 *     for await (const charge of mulla.charges.list()) { ... }
 */
export class CollectionPromise<T extends Model> implements PromiseLike<Collection<T>>, AsyncIterable<T> {
  readonly #load: () => Promise<Collection<T>>;
  #promise: Promise<Collection<T>> | null = null;

  /** The request starts on first use, so an unused list() call sends nothing. */
  constructor(load: () => Promise<Collection<T>>) {
    this.#load = load;
  }

  then<R1 = Collection<T>, R2 = never>(
    onFulfilled?: ((value: Collection<T>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return (this.#promise ??= this.#load()).then(onFulfilled, onRejected);
  }

  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<Collection<T> | R> {
    return this.then(undefined, onRejected);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    yield* await this;
  }
}
