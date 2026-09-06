/**
 * Pre-expiry trial nudges (LIN-143). Pure, client-safe: no db imports, so
 * the dashboard component can call these directly on the billing overview
 * it already fetches. A trialist should meet the upgrade CTA while the
 * workspace still works — not hit the read-only wall cold and churn.
 *
 * These are the *soft* nudges; the hard prompt in the dashboard (LIN-131)
 * still owns the post-facto states: trial ended (read-only), cap reached,
 * agents paused by a billing limit.
 */

/** Show the days-left nudge in the final week of the trial. */
export const TRIAL_NUDGE_DAYS_LEFT = 7;

/** Show the approaching-cap nudge at 80% of the monthly credits. */
export const USAGE_NUDGE_RATIO = 0.8;

/** The slice of the billing overview the nudges need. */
export type NudgeBilling = {
  plan: { readOnly: boolean };
  trial: { daysLeft: number } | null;
  usage: { ratio: number; capped: boolean; creditsUsed: number; limitCredits: number };
};

export type TrialNudge = { kind: 'trial_days'; daysLeft: number };
export type UsageNudge = { kind: 'usage_cap'; ratio: number; creditsUsed: number; limitCredits: number };
export type UpgradeNudge = TrialNudge | UsageNudge;

/**
 * "X days left in your trial" — only while the trial is live (overview
 * reports `trial` as null once expired) and the workspace is not read-only.
 */
export function trialNudge(billing: NudgeBilling): TrialNudge | null {
  if (billing.plan.readOnly || !billing.trial) return null;
  return billing.trial.daysLeft <= TRIAL_NUDGE_DAYS_LEFT ? { kind: 'trial_days', daysLeft: billing.trial.daysLeft } : null;
}

/**
 * Approaching the monthly credit cap — the warning before the wall. Suppressed
 * at `capped` (100%): there the hard LIN-131 prompt takes over, so we never
 * stack two upgrade banners on the same limit.
 */
export function usageNudge(billing: NudgeBilling): UsageNudge | null {
  if (billing.plan.readOnly || billing.usage.capped || billing.usage.limitCredits <= 0) return null;
  return billing.usage.ratio >= USAGE_NUDGE_RATIO
    ? {
        kind: 'usage_cap',
        ratio: billing.usage.ratio,
        creditsUsed: billing.usage.creditsUsed,
        limitCredits: billing.usage.limitCredits,
      }
    : null;
}

/** Both nudges in display order: time pressure first, then capacity. */
export function dashboardNudges(billing: NudgeBilling): UpgradeNudge[] {
  return [trialNudge(billing), usageNudge(billing)].filter((n): n is UpgradeNudge => n !== null);
}
