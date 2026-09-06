import crypto from 'node:crypto';
import type { Db } from '../db/index.ts';
import { recordEvent } from '../analytics/events.ts';
import { findSubscription } from '../repos/billing.ts';
import { AppError, type PlanKey, type Subscription } from '../repos/types.ts';
import { PLAN_ENTITLEMENTS, isPaidPlan, resumeBillingPausedAgents } from './entitlements.ts';
import { LocalBillingProvider } from './provider.ts';

/**
 * Pluggable checkout (LIN-131): the provider behind the upgrade button is
 * chosen by env, so a deployment can move from "checkout not configured" to
 * Stripe (or any future transaction-fee-only provider) with config only —
 * no code change, no UI change.
 *
 *   CHECKOUT_PROVIDER = 'stripe' | 'local' | 'none'   (default: auto)
 *   auto = stripe when STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are set,
 *          otherwise 'none'. 'local' fulfills instantly with no charge and
 *          exists for dev/test environments only — it must never be the
 *          silent default in production.
 *
 * Stripe is called over plain REST (form-encoded fetch, node:crypto HMAC
 * signature checks) — no SDK dependency, per the AGENTS.md dependency rule.
 */

export type CheckoutProviderKey = 'stripe' | 'local' | 'none';

export type CheckoutStart = {
  provider: CheckoutProviderKey;
  /** Absolute URL (Stripe) or app-relative path (local) to continue at; null when provider is 'none'. */
  url: string | null;
  /** Provider session id when one exists (Stripe: `cs_...`). */
  sessionId: string | null;
};

export type ResolvedCheckout = {
  provider: CheckoutProviderKey;
  stripe: { secretKey: string; webhookSecret: string } | null;
};

const PURCHASABLE_PLANS = ['starter', 'team', 'scale'] as const;
export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];

export function isPurchasablePlan(plan: string): plan is PurchasablePlan {
  return (PURCHASABLE_PLANS as readonly string[]).includes(plan);
}

export function resolveCheckout(env: Record<string, string | undefined> = process.env): ResolvedCheckout {
  const explicit = env.CHECKOUT_PROVIDER;
  if (explicit === 'local') return { provider: 'local', stripe: null };
  if (explicit === 'none') return { provider: 'none', stripe: null };
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (explicit === 'stripe') {
    if (!secretKey || !webhookSecret) {
      throw new AppError(
        'invalid',
        'CHECKOUT_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET',
      );
    }
    return { provider: 'stripe', stripe: { secretKey, webhookSecret } };
  }
  if (secretKey && webhookSecret) return { provider: 'stripe', stripe: { secretKey, webhookSecret } };
  return { provider: 'none', stripe: null };
}

// ------------------------------------------------------------ fulfillment

/**
 * Activates a paid plan after money actually moved (Stripe webhook, or the
 * local dev provider). Idempotent: a redelivered webhook must not issue a
 * second invoice. Resumes agents that billing paused, so an upgraded
 * workspace is immediately usable — the customer never waits on a human.
 */
export function fulfillCheckout(
  db: Db,
  workspaceId: string,
  plan: PlanKey,
  now: Date = new Date(),
): { subscription: Subscription; alreadyActive: boolean } {
  if (!isPaidPlan(plan)) throw new AppError('invalid', `plan '${plan}' is not purchasable`);
  const existing = findSubscription(db, workspaceId);
  if (existing && existing.plan === plan && existing.status === 'active') {
    return { subscription: existing, alreadyActive: true };
  }
  const provider = LocalBillingProvider;
  const subscription = existing
    ? provider.changePlan(db, workspaceId, plan, now)
    : provider.createSubscription(db, workspaceId, plan, now);
  const resumed = resumeBillingPausedAgents(db, workspaceId);
  recordEvent(db, 'checkout_complete', { workspaceId, plan, resumedAgents: resumed });
  return { subscription, alreadyActive: false };
}

// -------------------------------------------------------------- providers

/**
 * Starts checkout. Throws AppError('payment_required') when no provider is
 * configured — the route surfaces that as a 402 the upgrade page renders
 * honestly ("checkout not live on this deployment yet") instead of a broken
 * redirect.
 */
export async function startCheckout(
  db: Db,
  input: { workspaceId: string; plan: PurchasablePlan; origin: string },
  env: Record<string, string | undefined> = process.env,
): Promise<CheckoutStart> {
  const { provider, stripe } = resolveCheckout(env);
  if (provider === 'none') {
    throw new AppError(
      'payment_required',
      'checkout is not configured on this deployment yet',
      { provider: 'none', plan: input.plan },
    );
  }
  if (provider === 'local') {
    // Dev/test only: fulfill immediately, no charge, land on the success view.
    fulfillCheckout(db, input.workspaceId, input.plan);
    return {
      provider: 'local',
      url: `/dashboard/upgrade?workspace=${encodeURIComponent(input.workspaceId)}&checkout=success&plan=${input.plan}`,
      sessionId: null,
    };
  }
  return stripeCreateSession(stripe!, input);
}

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeCreateSession(
  creds: { secretKey: string },
  input: { workspaceId: string; plan: PurchasablePlan; origin: string },
): Promise<CheckoutStart> {
  const tier = PLAN_ENTITLEMENTS[input.plan];
  const form = new URLSearchParams({
    mode: 'subscription',
    client_reference_id: input.workspaceId,
    'metadata[workspaceId]': input.workspaceId,
    'metadata[plan]': input.plan,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(Math.round(tier.monthlyUsd * 100)),
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][product_data][name]': `Linda ${tier.name} plan`,
    // Managed Payments requires a product tax code on the line item; SaaS = txcd_10103000.
    // Must live under product_data — price_data[tax_code] / line_items[0][tax_code] are rejected.
    'line_items[0][price_data][product_data][tax_code]': 'txcd_10103000',
    'line_items[0][price_data][product_data][description]': `${tier.seats} seat(s), ${tier.monthlyCredits.toLocaleString('en-US')} credits/mo`,
    success_url: `${input.origin}/dashboard/upgrade?workspace=${encodeURIComponent(input.workspaceId)}&checkout=success&plan=${input.plan}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/dashboard/upgrade?workspace=${encodeURIComponent(input.workspaceId)}&checkout=cancelled`,
    // One screen, no account creation with Stripe — the Linda account already
    // exists; checkout exists only to take the card.
    'subscription_data[metadata][workspaceId]': input.workspaceId,
    'subscription_data[metadata][plan]': input.plan,
  });
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.id || !data.url) {
    throw new AppError(
      'payment_required',
      `Stripe checkout session could not be created: ${data.error?.message ?? res.status}`,
    );
  }
  return { provider: 'stripe', url: data.url, sessionId: data.id };
}

// --------------------------------------------------------------- webhooks

/** Stripe's documented scheme: `t=<ts>,v1=<hmac(t + '.' + payload)>`. */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!header) return false;
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=');
    if (k === 't') timestamp = v;
    else if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;
  const age = nowSec - Number(timestamp);
  if (!Number.isFinite(age) || age < -toleranceSec || age > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const a = Buffer.from(expected);
  for (const sig of signatures) {
    const b = Buffer.from(sig);
    if (b.length === a.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

export type WebhookResult = { received: true; handled: string | null; plan?: PlanKey };

/**
 * Verifies + applies a Stripe webhook. Only `checkout.session.completed`
 * (and its async-payment sibling) activate a plan; everything else is
 * acknowledged so Stripe stops redelivering.
 */
export async function handleStripeWebhook(
  db: Db,
  rawBody: string,
  signatureHeader: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<WebhookResult> {
  const { provider, stripe } = resolveCheckout(env);
  if (provider !== 'stripe' || !stripe) {
    throw new AppError('invalid', 'Stripe webhooks received but checkout is not configured for Stripe');
  }
  if (!verifyStripeSignature(rawBody, signatureHeader, stripe.webhookSecret)) {
    throw new AppError('unauthorized', 'invalid or expired webhook signature');
  }
  let event: {
    type?: string;
    data?: { object?: { client_reference_id?: string; payment_status?: string; metadata?: Record<string, string> } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new AppError('invalid', 'webhook body is not JSON');
  }
  const handled =
    event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';
  if (!handled) return { received: true, handled: null };

  const obj = event.data?.object ?? {};
  const workspaceId = obj.metadata?.workspaceId ?? obj.client_reference_id ?? null;
  const plan: string | null = obj.metadata?.plan ?? null;
  if (!workspaceId || !plan || !isPaidPlan(plan)) {
    throw new AppError('invalid', 'checkout.session.completed is missing workspace/plan metadata');
  }
  if (obj.payment_status && obj.payment_status !== 'paid') {
    // Async payment still pending — wait for async_payment_succeeded.
    return { received: true, handled: event.type ?? null, plan: undefined };
  }
  const { subscription } = fulfillCheckout(db, workspaceId, plan);
  return { received: true, handled: event.type ?? null, plan: subscription.plan };
}

/** Test helper: signs a payload the way Stripe does. */
export function signStripePayload(payload: string, secret: string, timestampSec: number): string {
  const mac = crypto.createHmac('sha256', secret).update(`${timestampSec}.${payload}`).digest('hex');
  return `t=${timestampSec},v1=${mac}`;
}
