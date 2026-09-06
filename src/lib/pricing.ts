/**
 * Published pricing (see pricing.md). Every tier has a real number — no
 * "contact us" — and self-serve reaches the top of the range, per the
 * structure that positioning depends on (LIN-5).
 */

export type PricingTier = {
  key: 'starter' | 'team' | 'scale';
  name: string;
  monthlyUsd: number;
  annualUsd: number;
  seats: number;
  blurb: string;
};

export const PRICING_TIERS: PricingTier[] = [
  {
    key: 'starter',
    name: 'Starter',
    monthlyUsd: 49,
    annualUsd: 490,
    seats: 1,
    blurb: 'Client approvals and reporting in one place — no Slack back-and-forth.',
  },
  {
    key: 'team',
    name: 'Team',
    monthlyUsd: 149,
    annualUsd: 1490,
    seats: 5,
    blurb: 'Your whole team assigns the work; clients approve in one place and reports ship on schedule.',
  },
  {
    key: 'scale',
    name: 'Scale',
    monthlyUsd: 399,
    annualUsd: 3990,
    seats: 20,
    blurb: 'Agency-volume client reporting and approvals — still self-serve, no sales call.',
  },
];

export const PRICING_COMMON = {
  trialDays: 14,
  trialRequiresCard: false,
  allAgentsIncluded: true,
  allIntegrationsIncluded: true,
};

/**
 * Conversion copy (LIN-112, hypotheses H1–H3 from LIN-51 §6). One source of
 * truth so the pricing page, landing hero, and signup CTA render the same
 * words an outbound email used — message-match depends on it.
 */
export const CONVERSION_COPY = {
  // H1 — flat-price anchor, placed beside the signup CTA.
  flatPriceAnchor: 'From $49/mo flat — no per-minute billing',
  // H1 contrast — factual, scoped to what Limova actually publishes
  // (verified 2026-09-06: €0.20/min metered AI phone calls on Pro, on top
  // of the subscription). Never overstate the competitor's model.
  flatPriceContrast:
    'Some AI platforms meter the extras — Limova, for example, charges €0.20/min for AI phone calls on top of its subscription. Every Linda tier is one flat monthly price.',
  // H2 — risk-reversal line, in the CTA block (not the FAQ).
  riskReversalLine: `${PRICING_COMMON.trialDays}-day free trial · no credit card · 30-second setup`,
  // H3 — the exact job-to-be-done our cold angle sells; the page must
  // answer in the same words the email asked the question.
  jtbdLine: 'Client approvals and reporting without the Slack back-and-forth',
};

/**
 * The credit conversion (LIN-52), published on the trust page before anyone
 * is billed a credit: 1 credit ~= 1k tokens. Overage beyond a plan's included
 * credits is charged per credit, capped by the workspace's hard spend cap.
 */
export const CREDIT_CONVERSION = {
  tokensPerCredit: 1_000,
  overageUsdPerCredit: 0.005,
};
