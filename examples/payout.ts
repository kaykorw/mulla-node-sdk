/**
 * Payout: sends money from your Mulla balance to a phone.
 *
 *   MULLA_SECRET_KEY=sk_test_... npx tsx examples/payout.ts 250788000000
 */
import { InvalidRequestError, MullaClient } from '@mulla/nodejs';

const mulla = new MullaClient();

try {
  const payout = await mulla.payouts.initiate({
    provider: 'MTN_RW',
    amount: 1000,
    phoneNumber: process.argv[2] ?? '250788000000',
    reason: 'Supplier invoice 42',
  });
  console.log(`Payout ${payout.id}: ${payout.status}`);
} catch (error) {
  if (error instanceof InvalidRequestError && error.errorCode === 'INSUFFICIENT_BALANCE') {
    console.error('Top up your balance first: mulla.recharges.initiate(...)');
  } else {
    throw error;
  }
}
