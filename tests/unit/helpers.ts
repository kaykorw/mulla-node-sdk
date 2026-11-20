import { MullaClient, type MullaOptions } from '@mulla/nodejs';
import { FakeTransport } from '@mulla/nodejs/testing';

export const KEY = 'sk_test_AbC123_s3cr3tRandomPart';
export const BASE = 'https://mulla.test/gateway/v1';

export interface TestClient {
  client: MullaClient;
  fake: FakeTransport;
  sleeps: number[];
}

export function makeClient(options: MullaOptions = {}): TestClient {
  const fake = new FakeTransport();
  const sleeps: number[] = [];
  const client = new MullaClient(KEY, {
    baseUrl: BASE,
    transport: fake,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });

  return { client, fake, sleeps };
}

export function charge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '9b2e5c1a-7d4f-4a3b-8c6e-1f2a3b4c5d6e',
    reference: 'CHG20261116ABCD',
    amount: 5000,
    fee_amount: 100,
    net_amount: 4900,
    currency: 'RWF',
    phone_number: '250788000000',
    provider: 'MTN_RW',
    status: 'PENDING',
    metadata: { order_id: 1001 },
    expires_at: '2026-11-16T10:10:00.000Z',
    created_at: '2026-11-16T10:00:00.000Z',
    ...overrides,
  };
}

export const CHARGE = { provider: 'MTN_RW', amount: 100, phoneNumber: '250788000000' } as const;

/** Runs fn and returns what it threw (fails the test if it did not throw). */
export async function caught(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected an error to be thrown');
}
