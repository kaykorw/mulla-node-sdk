import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidV4(): string {
  return format(randomBytes(16));
}

export function uuidFromSeed(seed: string): string {
  return format(createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16));
}

export function isUuidV4(value: string): boolean {
  return V4.test(value);
}

export function isUuid(value: string): boolean {
  return ANY.test(value);
}

function format(source: Uint8Array): string {
  const bytes = Buffer.from(source);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
