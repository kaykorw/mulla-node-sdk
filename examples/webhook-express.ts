/**
 * Webhook endpoint with Express. Needs: npm install express
 *
 *   MULLA_WEBHOOK_SECRET=... npx tsx examples/webhook-express.ts
 */
// @ts-expect-error express is not a dependency of the SDK; install it in your app.
import express from 'express';
import { createNodeWebhookHandler, WebhookEventType } from '@mulla/nodejs';

const app = express();

// The webhook route gets the RAW body (signatures are computed over the exact bytes).
// Register it before app.use(express.json()).
app.post(
  '/mulla/webhook',
  express.raw({ type: 'application/json' }),
  createNodeWebhookHandler({
    secret: process.env.MULLA_WEBHOOK_SECRET!,
    on: {
      [WebhookEventType.CHARGE_SUCCESS]: async (event) => {
        console.log('Paid:', event.objectId(), event.reference(), event.amount());
      },
      [WebhookEventType.CHARGE_FAILED]: async (event) => {
        console.log('Failed:', event.objectId());
      },
    },
  }),
);

app.use(express.json());

app.listen(3000, () => console.log('Listening on http://localhost:3000/mulla/webhook'));
