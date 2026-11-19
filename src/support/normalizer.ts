/**
 * @internal Turns user input into plain JSON-ready data.
 * null/undefined values are dropped (the API rejects empty fields) and dates become ISO strings.
 */
export function normalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).map(normalize);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && item !== undefined) {
        out[key] = normalize(item);
      }
    }

    return out;
  }

  return value;
}

/** @internal Query string with booleans as "true"/"false" and RFC 3986 encoding ("?a=1&b=x%20y", or ""). */
export function buildQuery(query: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(normalize(query) as Record<string, unknown>)) {
    const value = typeof raw === 'boolean' ? (raw ? 'true' : 'false') : String(raw);
    parts.push(`${encodeRfc3986(key)}=${encodeRfc3986(value)}`);
  }

  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/** @internal encodeURIComponent plus the characters RFC 3986 reserves (! ' ( ) *). */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** @internal */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;

  return proto === Object.prototype || proto === null;
}
