import { enumValue } from '../enums.js';
import { MullaError } from '../errors.js';

export type RawData = Record<string, unknown>;

/**
 * Base for every API object. Typed camelCase properties for autocompletion, plus:
 *  - `model.raw`          the untouched API data (new fields appear here first)
 *  - `model.get('field')` read any raw field
 *  - `JSON.stringify(model)` serialises the raw data
 */
export abstract class Model {
  declare readonly raw: Readonly<RawData>;

  constructor(data: RawData) {
    Object.defineProperty(this, 'raw', { value: Object.freeze({ ...data }), enumerable: false });
  }

  get(field: string): unknown {
    return this.raw[field];
  }

  toJSON(): RawData {
    return { ...this.raw };
  }
}

export type ModelClass<T extends Model> = new (data: RawData) => T;

export function makeModel<T extends Model>(Class: ModelClass<T>, data: unknown): T {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new MullaError(`Mulla returned an empty or unexpected response where a ${Class.name} was expected.`);
  }

  return new Class(data as RawData);
}

export function makeModels<T extends Model>(Class: ModelClass<T>, items: unknown): T[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item): item is RawData => item !== null && typeof item === 'object' && !Array.isArray(item))
    .map((item) => new Class(item));
}

export function str(d: RawData, key: string): string | null {
  const v = d[key];

  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
}

export function bool(d: RawData, key: string): boolean | null {
  const v = d[key];
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === 0 || v === '0' || v === 'false' || v === 'off' || v === 'no' || v === '') return false;

  return null;
}

export function money(d: RawData, key: string): number | null {
  const v = d[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);

  return null;
}

export function int(d: RawData, key: string): number | null {
  const v = money(d, key);

  return v === null ? null : Math.trunc(v);
}

export function date(d: RawData, key: string): Date | null {
  const v = d[key];
  if (typeof v !== 'string' || v === '') return null;
  const parsed = new Date(v);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function obj(d: RawData, key: string): Record<string, unknown> | null {
  const v = d[key];

  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function strings(d: RawData, key: string): string[] {
  const v = d[key];

  return Array.isArray(v) ? v.map(String) : [];
}

/**
 * Unknown enum values map to null rather than failing, so a new server status
 * never breaks old SDK versions (the original value stays in `raw`).
 */
export function oneOf<T extends string>(d: RawData, key: string, values: Record<string, T>): T | null {
  return enumValue(values, d[key]);
}

export function relationId(d: RawData, key: string): string | null {
  const v = d[key];
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return str(v as RawData, 'id');
  }

  return str(d, key);
}
