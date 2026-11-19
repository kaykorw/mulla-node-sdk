/**
 * Hosted checkout: Mulla's page collects the network and phone number.
 *
 *   MULLA_SECRET_KEY=sk_test_... npx tsx examples/hosted-checkout.ts
 */
import { MullaClient } from '@kayko/mulla-node';

const mulla = new MullaClient();

const session = await mulla.charges.createCheckout({
  amount: 25_000,
  reason: 'Order #1001',
  metadata: { orderId: 1001 },
  successUrl: 'https://shop.example/thanks',
  cancelUrl: 'https://shop.example/cart',
});

// Redirect the customer here (e.g. res.redirect(session.checkoutUrl) in Express).
console.log(session.checkoutUrl);

// Return URLs are not signed: confirm the payment with the webhook, or:
const charge = await mulla.charges.retrieve(session.charge!);
console.log(charge.status);
