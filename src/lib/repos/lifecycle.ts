import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';

/**
 * Onboarding lifecycle email state (LIN-203). The lifecycle_emails table is
 * the one-shot guard: a row per (workspace, kind) means the worker's periodic
 * scan can never double-send a nudge, no matter how often it runs.
 */

export type LifecycleEmailKind = 'welcome' | 'day2_nudge' | 'trial_expiry_nudge';

export type LifecycleEmailRecord = { kind: LifecycleEmailKind; via: string; sentAt: string };

export function findLifecycleEmail(db: Db, workspaceId: string, kind: LifecycleEmailKind): LifecycleEmailRecord | null {
  const r = db
    .prepare('SELECT kind, via, sent_at FROM lifecycle_emails WHERE workspace_id = ? AND kind = ?')
    .get(workspaceId, kind) as { kind: LifecycleEmailKind; via: string; sent_at: string } | undefined;
  return r ? { kind: r.kind, via: r.via, sentAt: r.sent_at } : null;
}

export function listLifecycleEmails(db: Db, workspaceId: string): LifecycleEmailRecord[] {
  const rows = db
    .prepare('SELECT kind, via, sent_at FROM lifecycle_emails WHERE workspace_id = ? ORDER BY sent_at ASC')
    .all(workspaceId) as { kind: LifecycleEmailKind; via: string; sent_at: string }[];
  return rows.map((r) => ({ kind: r.kind, via: r.via, sentAt: r.sent_at }));
}

/**
 * Idempotent: the first write wins, later calls are no-ops. A failed send
 * (via 'none') is still recorded — same policy as the LIN-113 magic-link
 * throttle: an inbox must never see the same nudge twice, and a mail outage
 * must not turn the worker into a retry spammer.
 */
export function markLifecycleEmailSent(db: Db, workspaceId: string, kind: LifecycleEmailKind, via: string): void {
  db.prepare(
    'INSERT INTO lifecycle_emails (workspace_id, kind, via, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
  ).run(workspaceId, kind, via, nowIso());
}

// ------------------------------------------------- workspace-level kill switch

export const LIFECYCLE_KILL_SWITCH_KEY = 'lifecycle_emails_disabled';

/** True when the workspace has opted out of transactional lifecycle nudges. */
export function lifecycleEmailsDisabled(db: Db, workspaceId: string): boolean {
  const r = db
    .prepare('SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?')
    .get(workspaceId, LIFECYCLE_KILL_SWITCH_KEY) as { value: string } | undefined;
  return r?.value === '1';
}

/** The workspace-level kill switch: disabled workspaces get no lifecycle email, ever. */
export function setLifecycleEmailsDisabled(db: Db, workspaceId: string, disabled: boolean): void {
  if (disabled) {
    db.prepare(
      `INSERT INTO workspace_settings (workspace_id, key, value, updated_at) VALUES (?, ?, '1', ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`,
    ).run(workspaceId, LIFECYCLE_KILL_SWITCH_KEY, nowIso());
  } else {
    db.prepare('DELETE FROM workspace_settings WHERE workspace_id = ? AND key = ?').run(
      workspaceId,
      LIFECYCLE_KILL_SWITCH_KEY,
    );
  }
}
