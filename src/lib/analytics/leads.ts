import type { Db } from '../db/index.ts';
import { isTrialPlan } from '../billing/entitlements.ts';
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

// QA/automation signups (LIN-147). `example.com` and the reserved `.example`
// TLD (RFC 2606) can only ever be test traffic — `linda-qa-test.example` and
// `lin*-verify@example.com` style addresses all land here — so matching the
// whole domain class is safe and self-maintaining as QA prefixes evolve.
const QA_EMAIL_PATTERNS = [
  /@agentmail\.to$/, // internal QA inboxes
  /@linda\.internal$/, // agent smoke-test accounts on the reserved QA domain
  /@example\.com$/, // *-verify@example.com production checks
  /\.example$/, // any *.example host, incl. linda-qa-test.example
  /^audit\+/, // audit+lin49-style QA signups
  /^ceo-probe\+/, // agentmail probe inboxes
];

export function isQaTestEmail(email: string): boolean {
  const norm = normalizeEmail(email);
  return QA_EMAIL_PATTERNS.some((re) => re.test(norm));
}

// Extra exact-match internal addresses (e.g. the founder's) live in
// LINDA_INTERNAL_EMAILS — a comma-separated list — so personal addresses
// never have to be committed to the repo. Read per call (cheap, small lists)
// so tests and runtime config changes take effect without a reload.
function internalEmailsExact(): Set<string> {
  return new Set(
    (process.env.LINDA_INTERNAL_EMAILS ?? '')
      .split(',')
      .map((e) => normalizeEmail(e))
      .filter(Boolean),
  );
}

export type LeadAudience = 'internal' | 'external';

export function leadAudience(email: string): LeadAudience {
  const norm = normalizeEmail(email);
  return isQaTestEmail(norm) || internalEmailsExact().has(norm) ? 'internal' : 'external';
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
  /** Signup channel tag persisted at signup (LIN-111), e.g. 'reddit_community'. */
  referralSource: string | null;
  /**
   * True once the user has consumed a magic link — the strongest available
   * signal that the email address is reachable for outreach (LIN-111).
   */
  emailVerified: boolean;
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
  referral_source: string | null;
  email_verified_at: string | null;
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
              u.referral_source, u.email_verified_at,
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
      status: r.workspace_id ? (isTrialPlan(r.plan ?? 'trial') ? 'active_trial' : 'active') : 'active_trial',
      audience: leadAudience(key),
      referralSource: r.referral_source ?? null,
      emailVerified: !!r.email_verified_at,
      createdAt: r.user_created_at,
      workspaceId: r.workspace_id,
      onboardingStep: r.onboarding_step,
    });
  }

  return Array.from(byEmail.values()).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  );
}

/**
 * Public aggregate metrics — safe to serve unauthenticated (LIN-74).
 * Counts only; no per-user records.
 */
export type LeadStatsSummary = {
  ok: true;
  /** Each executed task drives exactly one model request (prototype parity). */
  totalRequests: number;
  totalSignups: number;
  activeTrials: number;
  uniqueExternalSignups: number;
  externalActiveTrials: number;
  internalSignups: number;
  /**
   * LIN-147: internal signups that matched the QA/automation patterns, split
   * out from staff addresses so a QA run inflating these is visible at a
   * glance instead of leaking into the external funnel. external = humans.
   */
  qaTestSignups: number;
  totalTasksExecuted: number;
  completedTasks: number;
};

export function leadStatsSummary(db: Db): LeadStatsSummary {
  const leads = listLeads(db);
  const external = leads.filter((l) => l.audience === 'external');

  return {
    ok: true,
    totalRequests: countTasks(db),
    totalSignups: leads.length,
    activeTrials: leads.filter((l) => l.status === 'active_trial').length,
    uniqueExternalSignups: external.length,
    externalActiveTrials: external.filter((l) => l.status === 'active_trial').length,
    internalSignups: leads.length - external.length,
    qaTestSignups: leads.filter((l) => isQaTestEmail(l.email)).length,
    totalTasksExecuted: countTasks(db),
    completedTasks: countCompletedTasks(db),
  };
}

/**
 * Per-user detail for the sales digest — PII (emails, names, workspaceIds).
 * Only the ADMIN_TOKEN-gated /api/stats and /api/leads may return this.
 */
export type LeadStatsDetail = {
  recentSignups: Lead[];
  /**
   * LIN-111: the full external contact list for trialist outreach (P1), not
   * just the five most recent signups. Same PII class as recentSignups —
   * admin-gated.
   */
  externalLeads: Lead[];
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

export function leadStatsDetail(db: Db): LeadStatsDetail {
  const leads = listLeads(db);
  const tasks = listTasks(db, undefined, { limit: 5 });

  return {
    recentSignups: leads.slice(0, 5),
    externalLeads: leads.filter((l) => l.audience === 'external'),
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
