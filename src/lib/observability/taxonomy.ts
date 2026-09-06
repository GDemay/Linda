import type { EventName } from '../analytics/events.ts';

/**
 * Sale-funnel event taxonomy (LIN-167). This is the shared vocabulary for
 * every analytics surface — the SQLite `analytics_events` table, the PostHog
 * mirror, and the dashboards that read them. One event name means one thing
 * everywhere; never invent a near-duplicate, extend EVENT_NAMES instead.
 *
 * The funnel we are selling against:
 *
 *   visitor ──▶ signup ──▶ activated ──▶ (revenue)
 *
 * - **visitor** — anonymous page beacons. No workspace exists yet.
 * - **signup** — the account-creation path on the signup POST.
 * - **activated** — the customer got value: onboarding started/finished and
 *   the first workflow actually ran. `onboarding_started` fires on the first
 *   company-profile save (not on mere page views); `onboarding_completed`
 *   fires when the onboarding state machine reaches `done`;
 *   `first_task_dispatched` fires once per workspace on first task dispatch.
 * - **revenue** — follow-on monetization of activated workspaces.
 *
 * PostHog (LIN-167) mirrors exactly the events listed in POSTHOG_EVENTS, with
 * the same names, so a PostHog funnel can be built as
 * `visitor → signup_success → onboarding_completed → first_task_dispatched`.
 */

export const FUNNEL_STAGES = ['visitor', 'signup', 'activated', 'revenue'] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_EVENTS: Record<FunnelStage, readonly EventName[]> = {
  visitor: ['landing_view', 'pricing_view', 'signup_view', 'login_view'],
  signup: ['signup_start', 'signup_success', 'signup_complete', 'signup_error'],
  activated: ['onboarding_started', 'onboarding_completed', 'first_task_dispatched', 'starter_task_launched'],
  revenue: ['checkout_start', 'checkout_complete', 'upgrade_view', 'upgrade_nudge_view', 'upgrade_nudge_click'],
};

/**
 * Internal events mirrored to PostHog when POSTHOG_KEY/POSTHOG_HOST are set.
 * Deliberately excludes high-volume diagnostics (magic_link_*) — PostHog is
 * for the funnel, SQLite analytics_events stays the system of record.
 */
export const POSTHOG_EVENTS: readonly EventName[] = [
  ...FUNNEL_EVENTS.visitor,
  ...FUNNEL_EVENTS.signup,
  ...FUNNEL_EVENTS.activated,
  ...FUNNEL_EVENTS.revenue,
];

/** The funnel stage an event belongs to, or null for diagnostic-only events. */
export function funnelStageFor(name: EventName): FunnelStage | null {
  for (const stage of FUNNEL_STAGES) if (FUNNEL_EVENTS[stage].includes(name)) return stage;
  return null;
}
