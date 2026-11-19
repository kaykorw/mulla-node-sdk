/** Immutable HTTP response returned by a transport. */
export class Response {
  readonly statusCode: number;
  /** Header name (lower-cased) => value. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  #decoded: Record<string, unknown> | unknown[] | null | undefined;

  constructor(statusCode: number, headers: Record<string, string> = {}, body = '') {
    const lower: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      lower[name.toLowerCase()] = value;
    }
    this.statusCode = statusCode;
    this.headers = Object.freeze(lower);
    this.body = body;
  }

  header(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null;
  }

  isSuccessful(): boolean {
    return this.statusCode >= 200 && this.statusCode < 300;
  }

  /** Decoded JSON body, or null when the body is empty or not a JSON object/array. */
  json(): Record<string, unknown> | unknown[] | null {
    if (this.#decoded === undefined) {
      let data: unknown = null;
      if (this.body !== '') {
        try {
          data = JSON.parse(this.body);
        } catch {
          data = null;
        }
      }
      this.#decoded = data !== null && typeof data === 'object' ? (data as Record<string, unknown> | unknown[]) : null;
    }

    return this.#decoded;
  }
}
