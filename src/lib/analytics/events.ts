import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { id } from '../ids.ts';
import { leadAudience } from './leads.ts';

/**
 * Zero-cost cookieless funnel events (LIN-67 / audit fix #6). Events are
 * recorded server-side where the action happens; the two page-view events
 * arrive from a fire-and-forget client beacon. No visitor identifiers are
 * stored — name + coarse context only.
 */

export const EVENT_NAMES = [
  'landing_view',
  'signup_view',
  'signup_success',
  'signup_error',
  'login_view',
  'magic_link_sent',
  'magic_link_throttled',
  'first_task_dispatched',
  // LIN-153: one-click starter launches from the dashboard empty state.
  // Server-side, workspace-scoped — carries { workspaceId, agent, starter }.
  'starter_task_launched',
  // Pricing funnel (LIN-111): pricing_view is a client beacon; signup_start
  // and signup_complete are recorded server-side on the signup POST.
  'pricing_view',
  'signup_start',
  'signup_complete',
  // Upgrade funnel (LIN-131): upgrade_view is a client beacon on the
  // authenticated upgrade page; checkout_start/checkout_complete are
  // recorded server-side where the money path actually changes state.
  'upgrade_view',
  'checkout_start',
  'checkout_complete',
  // Pre-expiry nudges (LIN-143): both are client beacons from the dashboard,
  // carrying { kind: 'trial_days' | 'usage_cap' } so nudge CTR is measurable
  // per surface in the funnel events.
  'upgrade_nudge_view',
  'upgrade_nudge_click',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Events an anonymous client beacon may record; everything else is server-only. */
export const PUBLIC_BEACON_EVENTS = [
  'landing_view',
  'signup_view',
  'login_view',
  'pricing_view',
  'upgrade_view',
  'upgrade_nudge_view',
  'upgrade_nudge_click',
] as const;

export function recordEvent(db: Db, name: EventName, data: Record<string, unknown> = {}): void {
  db.prepare('INSERT INTO analytics_events (id, name, data, created_at) VALUES (?, ?, ?, ?)').run(
    id(),
    name,
    JSON.stringify(data),
    nowIso(),
  );
}

export type EventAudienceSplit = {
  external: number;
  internal: number;
  /** Events whose workspace can no longer be resolved (deleted data, bad rows). */
  unknown: number;
};

export type EventCount = {
  name: EventName;
  count: number;
  lastAt: string | null;
  /**
   * LIN-111: external/internal split for workspace-scoped events. Computed
   * from the event's data.workspaceId joined to the workspace owner, so the
   * split covers historical rows too, not just events emitted with an
   * audience tag. Present only when at least one row of the event carries a
   * workspaceId.
   */
  byAudience?: EventAudienceSplit;
  /**
   * LIN-157: signup attribution keyed by the referral tag the event carried —
   * `utm:source/medium/campaign` for utm campaign links (e.g.
   * utm:github/readme/lin141) or a plain `ref=` tag (e.g. reddit_community).
   * Present only when at least one row of the event carries a tag, so
   * campaigns are countable in /api/stats without another endpoint.
   */
  byCampaign?: Record<string, number>;
};

/** First (earliest-created) owner email per workspace — the audience key. */
function workspaceOwnerEmails(db: Db): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT m.workspace_id AS wid, u.email_lower AS email
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.role = 'owner'
       ORDER BY m.created_at ASC`,
    )
    .all() as { wid: string; email: string }[];
  const map = new Map<string, string>();
  for (const r of rows) if (!map.has(r.wid)) map.set(r.wid, r.email);
  return map;
}

/**
 * Per-name audience split for workspace-scoped events (LIN-111): rows whose
 * data JSON carries a workspaceId are classified via the workspace owner's
 * email using the same internal/external rule as the leads pipeline.
 */
function audienceSplits(db: Db): Map<string, EventAudienceSplit> {
  const rows = db
    .prepare(`SELECT name, data FROM analytics_events WHERE data LIKE '%"workspaceId"%'`)
    .all() as { name: string; data: string }[];
  if (rows.length === 0) return new Map();

  const owners = workspaceOwnerEmails(db);
  const splits = new Map<string, EventAudienceSplit>();
  for (const r of rows) {
    let workspaceId: string | undefined;
    try {
      workspaceId = (JSON.parse(r.data) as { workspaceId?: string })?.workspaceId;
    } catch {
      workspaceId = undefined;
    }
    const email = workspaceId ? owners.get(workspaceId) : undefined;
    const split = splits.get(r.name) ?? { external: 0, internal: 0, unknown: 0 };
    if (!email) split.unknown++;
    else if (leadAudience(email) === 'internal') split.internal++;
    else split.external++;
    splits.set(r.name, split);
  }
  return splits;
}

/**
 * Per-name referral-tag breakdown (LIN-157): rows whose data JSON carries a
 * non-null referralSource (as signup_success/signup_complete do), grouped by
 * tag value so utm campaigns and ref= channels are countable per event.
 */
function campaignSplits(db: Db): Map<string, Record<string, number>> {
  const rows = db
    .prepare(`SELECT name, data FROM analytics_events WHERE data LIKE '%"referralSource"%'`)
    .all() as { name: string; data: string }[];
  if (rows.length === 0) return new Map();

  const splits = new Map<string, Record<string, number>>();
  for (const r of rows) {
    let tag: string | undefined;
    try {
      tag = (JSON.parse(r.data) as { referralSource?: string | null })?.referralSource ?? undefined;
    } catch {
      tag = undefined;
    }
    if (!tag) continue;
    const counts = splits.get(r.name) ?? {};
    counts[tag] = (counts[tag] ?? 0) + 1;
    splits.set(r.name, counts);
  }
  return splits;
}

export function eventStats(db: Db): EventCount[] {
  const rows = db
    .prepare(
      `SELECT name, COUNT(*) AS n, MAX(created_at) AS last_at
       FROM analytics_events GROUP BY name ORDER BY n DESC`,
    )
    .all() as { name: string; n: number; last_at: string | null }[];
  const splits = audienceSplits(db);
  const campaigns = campaignSplits(db);
  return rows.map((r) => {
    const entry: EventCount = { name: r.name as EventName, count: Number(r.n), lastAt: r.last_at };
    const split = splits.get(r.name);
    if (split) entry.byAudience = split;
    const campaign = campaigns.get(r.name);
    if (campaign) entry.byCampaign = campaign;
    return entry;
  });
}
