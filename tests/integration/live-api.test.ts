/**
 * Runs against a real Mulla server (sandbox or local stack). Skipped unless configured:
 *
 *   MULLA_SECRET_KEY=sk_test_... npm run test:integration                                        (sandbox, mfs.kayko.dev)
 *   MULLA_SECRET_KEY=sk_test_... MULLA_BASE_URL=http://localhost:5605/gateway npm run test:integration   (local stack)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MullaClient, NotFoundError } from '@kayko/mulla-node';

const key = process.env.MULLA_SECRET_KEY;

describe.skipIf(key === undefined || key === '')('live API', () => {
  let mulla: MullaClient;

  // Created here, not in the describe body: vitest runs that body even when the suite is skipped.
  beforeAll(() => {
    mulla = new MullaClient(key, { maxRetries: 1 });
  });

  it('lists charges', async () => {
    const page = await mulla.charges.list({ limit: 5 });

    expect(page.total).toBeGreaterThanOrEqual(0);
    expect(page.length).toBeLessThanOrEqual(5);
  });

  it('raises NotFoundError for an unknown charge', async () => {
    await expect(mulla.charges.retrieve('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('creates a hosted checkout session', async () => {
    const session = await mulla.charges.createCheckout({
      amount: 100,
      reason: 'mulla-node integration test',
      successUrl: 'http://localhost/success',
      cancelUrl: 'http://localhost/cancel',
      metadata: { source: 'mulla-node-tests' },
    });

    expect(session.checkoutUrl).toBeTruthy();
    expect(session.token).toBeTruthy();
    expect(session.charge).toBeTruthy();
  });
});
