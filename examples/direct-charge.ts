/**
 * Direct charge: sends a payment prompt to the customer's phone and waits for the result.
 *
 *   MULLA_SECRET_KEY=sk_test_... npx tsx examples/direct-charge.ts 250788000000
 */
import { ConnectionError, MullaClient, Provider, uuidV4 } from '@mulla/nodejs';

const mulla = new MullaClient(); // reads MULLA_SECRET_KEY

// Store this key with your order: if you retry, Mulla will not charge the customer twice.
const idempotencyKey = uuidV4();

try {
  const charge = await mulla.charges.initiate(
    {
      provider: Provider.MTN_RW,
      amount: 100,
      phoneNumber: process.argv[2] ?? '250788000000',
      reason: 'Order #1001',
      metadata: { orderId: 1001 },
    },
    { idempotencyKey },
  );
  console.log(`Prompt sent: ${charge.reference} (${charge.status})`);

  // In production, wait for the charge.success webhook instead of polling.
  const final = await mulla.charges.waitForFinalStatus(charge.id, { timeoutMs: 120_000 });
  console.log(final.isSuccessful() ? 'Paid!' : `Not paid: ${final.status} ${final.failureMessage ?? ''}`);
} catch (error) {
  if (error instanceof ConnectionError && error.requestMayHaveBeenSent) {
    console.error('Mulla may have received the charge. Check its status before asking the customer again.');
  }
  throw error;
}
