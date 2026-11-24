import { ConnectionError, Environment, Language, MullaClient, Provider, uuidV4, type Middleware } from '@mulla/nodejs';

const tracing: Middleware = (request, next) => next(request.withHeader('x-trace-id', uuidV4()));

const mulla = new MullaClient({
  api_key: process.env.MULLA_SECRET_KEY,
  environment: Environment.TEST,
  base_url: process.env.MULLA_BASE_URL,
  webhook_secret: process.env.MULLA_WEBHOOK_SECRET,
  webhook_url: process.env.MULLA_WEBHOOK_URL,
  timeout: 10_000,
  max_retries: 2,
  lang: Language.EN,
  app_info: { name: 'my-shop', version: '1.4.0', url: 'https://shop.example' },
  logger: console,
  middleware: [tracing],
});

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

  const final = await mulla.charges.waitForFinalStatus(charge.id, { timeoutMs: 120_000 });
  console.log(final.isSuccessful() ? 'Paid!' : `Not paid: ${final.status} ${final.failureMessage ?? ''}`);
} catch (error) {
  if (error instanceof ConnectionError && error.requestMayHaveBeenSent) {
    console.error('Mulla may have received the charge. Check its status before asking the customer again.');
  }
  throw error;
}
