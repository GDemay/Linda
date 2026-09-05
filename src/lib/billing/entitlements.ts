import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { PRICING_TIERS } from '../pricing.ts';
import {
  findWorkspace,
  listWorkspaceAgents,
  setWorkspacePlan,
  updateWorkspaceAgent,
} from '../repos/accounts.ts';
import { upsertSubscription } from '../repos/billing.ts';
import { recordActivity } from '../repos/workflows.ts';
import { AppError, type PlanKey, type Workspace } from '../repos/types.ts';

/**
 * Entitlements service (LIN-52 W10/W11) — the single source of truth for
 * what a plan allows. No other module may hard-code plan names to gate an
 * action; they ask this service instead.
 *
 * The tier prices live in lib/pricing.ts (published by LIN-5); this module
 * owns what each plan *entitles*, plus the `trial` and `free` keys so the
 * workspaces.plan column has a defined vocabulary.
 */

export type PlanEntitlements = {
  key: PlanKey;
  name: string;
  monthlyUsd: number;
  seats: number;
  /** How many workspaces one account may own on this plan. */
  workspaces: number;
  monthlyCredits: number;
  /** 'all' means every catalog agent; a list restricts to those agent keys. */
  agentIds: 'all' | string[];
  featureFlags: string[];
  /** Read-only tiers can view everything but run nothing. */
  readOnly: boolean;
};

export const FEATURE_AGENTS_RUN = 'agents.run';
export const FEATURE_WORKFLOWS_RUN = 'workflows.run';
export const FEATURE_INTEGRATIONS_CONNECT = 'integrations.connect';
const PAID_FEATURES = [FEATURE_AGENTS_RUN, FEATURE_WORKFLOWS_RUN, FEATURE_INTEGRATIONS_CONNECT];

function tierPrice(key: string): { name: string; monthlyUsd: number } {
  const tier = PRICING_TIERS.find((t) => t.key === key);
  if (!tier) throw new AppError('invalid', `no published price for plan '${key}'`);
  return { name: tier.name, monthlyUsd: tier.monthlyUsd };
}

export const PLAN_ENTITLEMENTS: Record<PlanKey, PlanEntitlements> = {
  trial: {
    key: 'trial',
    name: 'Trial',
    monthlyUsd: 0,
    seats: 5,
    workspaces: 1,
    monthlyCredits: 5_000,
    agentIds: 'all',
    featureFlags: PAID_FEATURES,
    readOnly: false,
  },
  free: {
    key: 'free',
    name: 'Free',
    monthlyUsd: 0,
    seats: 1,
    workspaces: 1,
    monthlyCredits: 0,
    agentIds: [],
    featureFlags: [],
    readOnly: true,
  },
  starter: { key: 'starter', ...entitle('starter', 10_000, 1) },
  team: { key: 'team', ...entitle('team', 40_000, 5) },
  scale: { key: 'scale', ...entitle('scale', 150_000, 20) },
};

function entitle(tierKey: string, monthlyCredits: number, seats: number) {
  const price = tierPrice(tierKey);
  return {
    name: price.name,
    monthlyUsd: price.monthlyUsd,
    seats,
    workspaces: 1,
    monthlyCredits,
    agentIds: 'all' as const,
    featureFlags: PAID_FEATURES,
    readOnly: false,
  };
}

export function isPlanKey(value: string): value is PlanKey {
  return value in PLAN_ENTITLEMENTS;
}

export function isPaidPlan(plan: string): boolean {
  return isPlanKey(plan) && PLAN_ENTITLEMENTS[plan].monthlyUsd > 0;
}

export function isTrialPlan(plan: string): boolean {
  return plan === 'trial';
}

export function entitlementsFor(plan: string): PlanEntitlements {
  if (!isPlanKey(plan)) {
    // Unknown values (e.g. hand-edited DB rows) fall back to free, never up.
    return PLAN_ENTITLEMENTS.free;
  }
  return PLAN_ENTITLEMENTS[plan];
}

// --------------------------------------------------------- trial end-state

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 14;

export function trialEndsAt(workspace: Workspace): string {
  return new Date(new Date(workspace.createdAt).getTime() + TRIAL_DAYS * DAY_MS).toISOString();
}

export type ResolvedPlan = {
  plan: PlanKey;
  entitlements: PlanEntitlements;
  /** Present while the workspace is still on an unexpired trial. */
  trial: { endsAt: string; daysLeft: number } | null;
  /** True on the read that performed the downgrade (AC9: no human action). */
  downgradedFromTrial: boolean;
};

/**
 * Resolves the workspace's effective plan. An expired trial is downgraded to
 * the free (read-only) tier here, automatically and exactly once: agents are
 * paused with a visible reason and the event lands in the activity trail.
 * Never a charge.
 */
export function resolvePlan(db: Db, workspaceId: string, now: Date = new Date()): ResolvedPlan {
  const ws = findWorkspace(db, workspaceId);
  if (!ws) throw new AppError('not_found', `workspace ${workspaceId} not found`);

  if (ws.plan !== 'trial') {
    const e = entitlementsFor(ws.plan);
    return { plan: e.key, entitlements: e, trial: null, downgradedFromTrial: false };
  }

  const endsAt = trialEndsAt(ws);
  if (now.getTime() < new Date(endsAt).getTime()) {
    return {
      plan: 'trial',
      entitlements: PLAN_ENTITLEMENTS.trial,
      trial: { endsAt, daysLeft: daysLeft(endsAt, now) },
      downgradedFromTrial: false,
    };
  }

  // Expired: downgrade to free, pause agents with a visible reason, log it.
  setWorkspacePlan(db, ws.id, 'free');
  upsertSubscription(db, {
    workspaceId: ws.id,
    plan: 'free',
    status: 'canceled',
    periodStart: ws.createdAt,
    periodEnd: nowIso(),
  });
  pauseAllAgents(db, ws.id, 'trial_ended', 'Trial ended — workspace is read-only until a plan is chosen');
  recordActivity(db, {
    workspaceId: ws.id,
    actorType: 'system',
    kind: 'billing.trial_expired',
    summary: 'Trial ended: workspace downgraded to the free plan (never a charge)',
    data: { from: 'trial', to: 'free', trialEndsAt: endsAt },
  });
  return { plan: 'free', entitlements: PLAN_ENTITLEMENTS.free, trial: null, downgradedFromTrial: true };
}

/** Worker entry point: downgrades every trial that has aged out, no human action. */
export function expireDueTrials(db: Db, now: Date = new Date()): string[] {
  const rows = db.prepare('SELECT id, created_at FROM workspaces WHERE plan = ?').all('trial') as {
    id: string;
    created_at: string;
  }[];
  const downgraded: string[] = [];
  for (const r of rows) {
    const endsAt = new Date(new Date(r.created_at).getTime() + TRIAL_DAYS * DAY_MS);
    if (endsAt.getTime() <= now.getTime() && resolvePlan(db, r.id, now).downgradedFromTrial) {
      downgraded.push(r.id);
    }
  }
  return downgraded;
}

function daysLeft(endsAt: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now.getTime()) / DAY_MS));
}

/** Pause with a machine-readable reason in config so the UI can show why. */
export function pauseAllAgents(db: Db, workspaceId: string, reason: string, summary: string): number {
  const paused = listWorkspaceAgents(db, workspaceId).filter((a) => a.status === 'active');
  for (const agent of paused) {
    updateWorkspaceAgent(db, workspaceId, agent.id, {
      status: 'paused',
      config: { ...agent.config, pausedReason: reason, pausedSummary: summary, pausedAt: nowIso() },
    });
  }
  return paused.length;
}

// --------------------------------------------------------------- gating

/** The gate every execution surface calls before doing metered work. */
export function requireFeature(db: Db, workspaceId: string, flag: string, now: Date = new Date()): PlanEntitlements {
  const resolved = resolvePlan(db, workspaceId, now);
  if (!resolved.entitlements.featureFlags.includes(flag)) {
    throw new AppError(
      'payment_required',
      `plan '${resolved.plan}' does not include ${flag}${
        resolved.entitlements.readOnly ? ' (read-only tier)' : ''
      } — upgrade to resume`,
      { plan: resolved.plan, flag },
    );
  }
  return resolved.entitlements;
}

/** Seat gating for future invite flows: the entitlements data plus one check. */
export function assertSeatsAvailable(db: Db, workspaceId: string, currentSeats: number): void {
  const { plan, entitlements } = resolvePlan(db, workspaceId);
  if (currentSeats >= entitlements.seats) {
    throw new AppError('payment_required', `plan '${plan}' allows ${entitlements.seats} seat(s)`, {
      plan,
      seats: entitlements.seats,
    });
  }
}
