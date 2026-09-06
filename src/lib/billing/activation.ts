import { PRICING_TIERS } from '../pricing.ts';

/**
 * Webhook-delay-safe checkout success (LIN-142). The `checkout=success`
 * landing page must never claim "plan active" from the URL param alone —
 * with Stripe, the activation webhook normally lands seconds after the
 * redirect, so the page reads the billing overview and reports an honest
 * interim state until `subscription` is actually active.
 *
 * Pure state + an injectable-clock poll driver, so the page stays thin and
 * tests run with a fake sleep.
 */

/** Poll budget: initial read plus up to N retries (e.g. 3 × 2s ≈ 6s of grace). */
export const ACTIVATION_RETRIES = 3;
export const ACTIVATION_RETRY_MS = 2000;

export type ActivationPhase = 'activating' | 'active' | 'delayed';

/** The slice of the billing overview the success gate needs. */
export type SubscriptionSnapshot = { plan: string; status: string } | null;

/**
 * Client-safe paid-plan check. The server-side `isPaidPlan` (entitlements.ts)
 * sits on the DB module graph, so this derives from the published tiers —
 * the single source of truth pricing.ts already shares with the UI.
 */
const paidPlanKeys = new Set<string>(PRICING_TIERS.map((t) => t.key));

/** True only when the paid plan the customer just bought is genuinely live. */
export function isSubscriptionActive(sub: SubscriptionSnapshot, expectedPlan: string | null): boolean {
  if (!sub || sub.status !== 'active') return false;
  if (expectedPlan) return sub.plan === expectedPlan;
  return paidPlanKeys.has(sub.plan);
}

/**
 * Maps one billing read to the honest success-view phase: `active` when the
 * subscription is live, otherwise `activating` while the poll budget lasts
 * and `delayed` once it is spent.
 */
export function activationPhase(
  sub: SubscriptionSnapshot,
  expectedPlan: string | null,
  retriesLeft: number,
): ActivationPhase {
  if (isSubscriptionActive(sub, expectedPlan)) return 'active';
  return retriesLeft > 0 ? 'activating' : 'delayed';
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reads billing, then polls while the subscription is not yet active.
 * `onPhase` fires after every read so the UI can render the interim state.
 * `retries: 0` degenerates to a single read — used for non-success landings.
 */
export async function waitForActivation(
  read: () => SubscriptionSnapshot | Promise<SubscriptionSnapshot>,
  opts: {
    expectedPlan: string | null;
    retries?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    onPhase?: (phase: ActivationPhase) => void;
  },
): Promise<ActivationPhase> {
  const retries = opts.retries ?? ACTIVATION_RETRIES;
  const intervalMs = opts.intervalMs ?? ACTIVATION_RETRY_MS;
  const sleep = opts.sleep ?? realSleep;

  let sub = await read();
  if (isSubscriptionActive(sub, opts.expectedPlan)) {
    opts.onPhase?.('active');
    return 'active';
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    opts.onPhase?.('activating');
    await sleep(intervalMs);
    sub = await read();
    if (isSubscriptionActive(sub, opts.expectedPlan)) {
      opts.onPhase?.('active');
      return 'active';
    }
  }
  opts.onPhase?.('delayed');
  return 'delayed';
}
