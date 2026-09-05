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
    blurb: 'One operator, every agent, no ramp-up.',
  },
  {
    key: 'team',
    name: 'Team',
    monthlyUsd: 149,
    annualUsd: 1490,
    seats: 5,
    blurb: 'A growing team that needs more than one seat at the wheel.',
  },
  {
    key: 'scale',
    name: 'Scale',
    monthlyUsd: 399,
    annualUsd: 3990,
    seats: 20,
    blurb: 'Higher volume, still self-serve — no sales call required.',
  },
];

export const PRICING_COMMON = {
  trialDays: 14,
  trialRequiresCard: false,
  allAgentsIncluded: true,
  allIntegrationsIncluded: true,
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
