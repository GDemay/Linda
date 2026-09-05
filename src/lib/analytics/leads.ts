import type { Db } from '../db/index.ts';
import { countTasks, listTasks } from '../repos/tasks.ts';

/**
 * Lead-visibility metrics (LIN-59). The legacy prototype exposed
 * `GET /api/stats` and `GET /api/leads` that the sales org polls to detect
 * new signups and attribute them to channels; this module reproduces that
 * contract on top of the platform's SQLite schema so downstream agents need
 * zero changes. See legacy/prototype/server.js for the original shape.
 */

// -------------------------------------------------------------
// Lead hygiene: normalization, dedupe, internal/external tagging
// -------------------------------------------------------------

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

const INTERNAL_EMAIL_PATTERNS = [
  /@agentmail\.to$/, // internal QA inboxes
  /@linda\.internal$/, // agent smoke-test accounts on the reserved QA domain
  /^audit\+/, // audit+lin49-style QA signups
  /^founder@redacted\.example$/, // founder smoke tests
];

export type LeadAudience = 'internal' | 'external';

export function leadAudience(email: string): LeadAudience {
  const norm = normalizeEmail(email);
  return INTERNAL_EMAIL_PATTERNS.some((re) => re.test(norm)) ? 'internal' : 'external';
}

export type Lead = {
  id: string;
  email: string;
  name: string;
  company: string;
  plan: string;
  /** 'active_trial' mirrors the prototype's trial status; 'active' otherwise. */
  status: 'active_trial' | 'active';
  audience: LeadAudience;
  createdAt: string;
  workspaceId: string | null;
  onboardingStep: string | null;
};

type LeadRow = {
  user_id: string;
  email_lower: string;
  name: string;
  user_created_at: string;
  workspace_id: string | null;
  workspace_name: string | null;
  plan: string | null;
  onboarding_step: string | null;
  legal_name: string | null;
};

/**
 * Every signup as a sales lead: one row per user, joined to their earliest
 * owned workspace. A user with several workspaces still counts once —
 * dedupe by normalized email keeps the first (earliest) submission, exactly
 * like the prototype's dedupeAndTagLeads.
 */
export function listLeads(db: Db): Lead[] {
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.email_lower, u.name, u.created_at AS user_created_at,
              w.id AS workspace_id, w.name AS workspace_name, w.plan, w.onboarding_step,
              cp.legal_name
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id AND m.role = 'owner'
       LEFT JOIN workspaces w ON w.id = m.workspace_id
       LEFT JOIN company_profiles cp ON cp.workspace_id = w.id
       ORDER BY u.created_at ASC, w.created_at ASC`,
    )
    .all() as LeadRow[];

  const byEmail = new Map<string, Lead>();
  for (const r of rows) {
    const key = normalizeEmail(r.email_lower);
    if (!key.includes('@')) continue;
    if (byEmail.has(key)) continue; // earliest row wins (query is ordered ASC)
    byEmail.set(key, {
      id: r.user_id,
      email: key,
      name: r.name,
      company: (r.legal_name || r.workspace_name || '').trim(),
      plan: r.plan || 'trial',
      status: r.workspace_id ? (r.plan === 'trial' ? 'active_trial' : 'active') : 'active_trial',
      audience: leadAudience(key),
      createdAt: r.user_created_at,
      workspaceId: r.workspace_id,
      onboardingStep: r.onboarding_step,
    });
  }

  return Array.from(byEmail.values()).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  );
}

export type LeadStats = {
  ok: true;
  /** Each executed task drives exactly one model request (prototype parity). */
  totalRequests: number;
  totalSignups: number;
  activeTrials: number;
  uniqueExternalSignups: number;
  externalActiveTrials: number;
  internalSignups: number;
  totalTasksExecuted: number;
  completedTasks: number;
  recentSignups: Lead[];
  recentTasks: {
    id: string;
    workspaceId: string;
    agent: string;
    category: string;
    title: string;
    status: string;
    createdAt: string;
  }[];
};

export function leadStats(db: Db): LeadStats {
  const leads = listLeads(db);
  const external = leads.filter((l) => l.audience === 'external');
  const tasks = listTasks(db, undefined, { limit: 5 });
  const totalTasks = countTasks(db);

  return {
    ok: true,
    totalRequests: totalTasks,
    totalSignups: leads.length,
    activeTrials: leads.filter((l) => l.status === 'active_trial').length,
    uniqueExternalSignups: external.length,
    externalActiveTrials: external.filter((l) => l.status === 'active_trial').length,
    internalSignups: leads.length - external.length,
    totalTasksExecuted: totalTasks,
    completedTasks: countCompletedTasks(db),
    recentSignups: leads.slice(0, 5),
    recentTasks: tasks.map((t) => ({
      id: t.id,
      workspaceId: t.workspaceId,
      agent: t.agent,
      category: t.category,
      title: t.title,
      status: t.status,
      createdAt: t.createdAt,
    })),
  };
}

function countCompletedTasks(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'completed'").get() as {
    n: number;
  };
  return Number(row.n);
}
