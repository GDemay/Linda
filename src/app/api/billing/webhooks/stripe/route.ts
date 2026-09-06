import { getDb } from '@/lib/db/index.ts';
import { handleStripeWebhook } from '@/lib/billing/checkout.ts';
import { handle, json } from '@/lib/http.ts';

/**
 * Stripe webhook receiver (LIN-131). Reads the raw body before anything
 * else — signature verification covers the exact bytes Stripe sent, so no
 * JSON parsing may happen first. Acknowledges unknown event types so Stripe
 * stops redelivering; only checkout completion activates a plan.
 */
export const POST = handle(async (req) => {
  const raw = await req.text();
  const result = await handleStripeWebhook(getDb(), raw, req.headers.get('stripe-signature'));
  return json(result);
});
