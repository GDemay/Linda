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
  // Pricing funnel (LIN-111): pricing_view is a client beacon; signup_start
  // and signup_complete are recorded server-side on the signup POST.
  'pricing_view',
  'signup_start',
  'signup_complete',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Events an anonymous client beacon may record; everything else is server-only. */
export const PUBLIC_BEACON_EVENTS = ['landing_view', 'signup_view', 'login_view', 'pricing_view'] as const;

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

export function eventStats(db: Db): EventCount[] {
  const rows = db
    .prepare(
      `SELECT name, COUNT(*) AS n, MAX(created_at) AS last_at
       FROM analytics_events GROUP BY name ORDER BY n DESC`,
    )
    .all() as { name: string; n: number; last_at: string | null }[];
  const splits = audienceSplits(db);
  return rows.map((r) => {
    const entry: EventCount = { name: r.name as EventName, count: Number(r.n), lastAt: r.last_at };
    const split = splits.get(r.name);
    if (split) entry.byAudience = split;
    return entry;
  });
}
