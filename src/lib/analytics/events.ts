import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { id } from '../ids.ts';

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
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Events an anonymous client beacon may record; everything else is server-only. */
export const PUBLIC_BEACON_EVENTS = ['landing_view', 'signup_view', 'login_view'] as const;

export function recordEvent(db: Db, name: EventName, data: Record<string, unknown> = {}): void {
  db.prepare('INSERT INTO analytics_events (id, name, data, created_at) VALUES (?, ?, ?, ?)').run(
    id(),
    name,
    JSON.stringify(data),
    nowIso(),
  );
}

export type EventCount = { name: EventName; count: number; lastAt: string | null };

export function eventStats(db: Db): EventCount[] {
  const rows = db
    .prepare(
      `SELECT name, COUNT(*) AS n, MAX(created_at) AS last_at
       FROM analytics_events GROUP BY name ORDER BY n DESC`,
    )
    .all() as { name: string; n: number; last_at: string | null }[];
  return rows.map((r) => ({ name: r.name as EventName, count: Number(r.n), lastAt: r.last_at }));
}
