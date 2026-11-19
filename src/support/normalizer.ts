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

export function buildQuery(query: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(normalize(query) as Record<string, unknown>)) {
    const value = typeof raw === 'boolean' ? (raw ? 'true' : 'false') : String(raw);
    parts.push(`${encodeRfc3986(key)}=${encodeRfc3986(value)}`);
  }

  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;

  return proto === Object.prototype || proto === null;
}
