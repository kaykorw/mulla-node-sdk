/**
 * Webhook endpoint for the Next.js App Router. Save as app/api/mulla/webhook/route.ts.
 * The same handler works in Remix, SvelteKit, Hono, Bun.serve, Deno.serve and Cloudflare Workers.
 */
import { createWebhookHandler } from '@mulla/nodejs';

export const POST = createWebhookHandler({
  secret: process.env.MULLA_WEBHOOK_SECRET!,
  on: {
    'charge.success': async (event) => {
      // Mark the order paid. event.metadata() has your charge metadata when the server includes it.
      console.log('Paid:', event.objectId(), event.reference());
    },
    'payout.failed': async (event) => {
      console.log('Payout failed:', event.objectId());
    },
  },
});
