import type { Db } from '../db/index.ts';
import { CREDIT_CONVERSION } from '../pricing.ts';
import { appendUsage, findSpendCap, setSpendCap, sumUsageCreditsSince, usageSourceExists } from '../repos/billing.ts';
import { findWorkspace } from '../repos/accounts.ts';
import { listTasksWithTokens } from '../repos/tasks.ts';
import { listSucceededRunUsage, recordActivity } from '../repos/workflows.ts';
import { AppError } from '../repos/types.ts';
import { FEATURE_AGENTS_RUN, pauseAllAgents, requireFeature, resolvePlan, type PlanEntitlements } from './entitlements.ts';

/**
 * Usage metering + the hard spend cap (LIN-52 W10). All meters derive from
 * the append-only usage_ledger; there is no mutable counter. The cap is
 * user-set (spend_caps table), defaults to the plan's monthlyCredits, and
 * enforces: 80% -> notify once per month, 100% -> pause every agent with a
 * visible reason. Nothing runs past the cap silently.
 */

/** Published conversion (trust page / pricing copy): 1 credit ~= 1k tokens. */
export const TOKENS_PER_CREDIT = CREDIT_CONVERSION.tokensPerCredit;

/** Overage beyond the plan allowance, charged by the local billing provider. */
export const OVERAGE_USD_PER_CREDIT = CREDIT_CONVERSION.overageUsdPerCredit;

/** Rough per-step token estimate used to meter workflow runs, which have no token column. */
export const WORKFLOW_RUN_TOKENS_PER_STEP = 800;

const DAY_MS = 24 * 60 * 60 * 1000;

export function creditsForTokens(tokens: number): number {
  return tokens / TOKENS_PER_CREDIT;
}

export function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type UsageMeter = {
  /** Calendar-month window, ISO bounds. */
  periodStart: string;
  creditsUsed: number;
  /** The effective hard cap: the user-set limit, defaulting to plan credits. */
  limitCredits: number;
  limitSource: 'user_set' | 'plan_default';
  ratio: number;
  /** True once usage has reached the cap — agents are paused at this point. */
  capped: boolean;
};

export function usageMeter(
  db: Db,
  workspaceId: string,
  entitlements: PlanEntitlements,
  now: Date = new Date(),
): UsageMeter {
  const periodStart = monthStartIso(now);
  const creditsUsed = sumUsageCreditsSince(db, workspaceId, periodStart);
  const cap = findSpendCap(db, workspaceId);
  const limitCredits = cap?.monthlyLimitCredits ?? entitlements.monthlyCredits;
  const ratio = limitCredits > 0 ? creditsUsed / limitCredits : creditsUsed > 0 ? 1 : 0;
  return {
    periodStart,
    creditsUsed,
    limitCredits,
    limitSource: cap ? 'user_set' : 'plan_default',
    ratio,
    capped: limitCredits > 0 ? creditsUsed >= limitCredits : creditsUsed > 0,
  };
}

/**
 * The single gate for metered execution. Throws `payment_required` when the
 * plan doesn't allow running agents or when the cap is already reached, so
 * callers fail loudly instead of silently overspending.
 */
export function assertWithinCap(db: Db, workspaceId: string, now: Date = new Date()): void {
  const entitlements = requireFeature(db, workspaceId, FEATURE_AGENTS_RUN, now);
  const meter = usageMeter(db, workspaceId, entitlements, now);
  if (meter.capped) {
    throw new AppError(
      'payment_required',
      `spend cap reached: ${meter.creditsUsed.toFixed(2)}/${meter.limitCredits} credits this month — agents are paused, raise the cap in billing settings to resume`,
      { creditsUsed: meter.creditsUsed, limitCredits: meter.limitCredits },
    );
  }
}

/**
 * Appends usage and enforces the cap's side effects. Called right after any
 * metered action completes, so the action that crosses the line is also the
 * one that pauses the workspace.
 */
export function recordUsage(
  db: Db,
  input: {
    workspaceId: string;
    agent: string;
    source: 'task' | 'workflow_run' | 'seed' | 'grant';
    sourceId?: string | null;
    tokens: number;
    reason: string;
    occurredAt?: string;
  },
  now: Date = new Date(),
): void {
  if (input.tokens === 0) return;
  appendUsage(db, {
    workspaceId: input.workspaceId,
    agent: input.agent,
    source: input.source,
    sourceId: input.sourceId ?? null,
    credits: creditsForTokens(input.tokens),
    tokens: input.tokens,
    reason: input.reason,
    occurredAt: input.occurredAt ?? now.toISOString(),
  });
  enforceSpendCap(db, input.workspaceId, now);
}

/** 80% -> one notification per month; 100% -> pause agents + notify. */
export function enforceSpendCap(db: Db, workspaceId: string, now: Date = new Date()): void {
  const { entitlements } = resolvePlan(db, workspaceId, now);
  const meter = usageMeter(db, workspaceId, entitlements, now);

  if (meter.ratio >= 1 && !entitlements.readOnly) {
    pauseAllAgents(db, workspaceId, 'spend_cap', `Spend cap reached (${meter.limitCredits} credits/month) — raise the cap to resume`);
    recordActivity(db, {
      workspaceId,
      actorType: 'system',
      kind: 'billing.spend_cap_reached',
      summary: `Spend cap reached: agents paused at ${meter.creditsUsed.toFixed(2)}/${meter.limitCredits} credits`,
      data: { creditsUsed: meter.creditsUsed, limitCredits: meter.limitCredits },
    });
    return;
  }

  if (meter.ratio >= 0.8 && !notifiedThisMonth(db, workspaceId, now)) {
    recordActivity(db, {
      workspaceId,
      actorType: 'system',
      kind: 'billing.spend_cap_warning',
      summary: `Usage at ${Math.round(meter.ratio * 100)}% of the monthly cap (${meter.creditsUsed.toFixed(2)}/${meter.limitCredits} credits)`,
      data: { creditsUsed: meter.creditsUsed, limitCredits: meter.limitCredits, month: monthStartIso(now).slice(0, 7) },
    });
  }
}

function notifiedThisMonth(db: Db, workspaceId: string, now: Date): boolean {
  const r = db
    .prepare(`SELECT 1 AS hit FROM activity_events
              WHERE workspace_id = ? AND kind IN ('billing.spend_cap_warning', 'billing.spend_cap_reached')
                AND created_at >= ? LIMIT 1`)
    .get(workspaceId, monthStartIso(now)) as { hit: number } | undefined;
  return Boolean(r);
}

export function setMonthlyLimit(db: Db, workspaceId: string, monthlyLimitCredits: number): void {
  if (!Number.isFinite(monthlyLimitCredits) || monthlyLimitCredits < 0) {
    throw new AppError('invalid', 'monthly limit must be a non-negative number of credits');
  }
  setSpendCap(db, workspaceId, monthlyLimitCredits);
  enforceSpendCap(db, workspaceId);
}

/**
 * Backfills the ledger from pre-billing history: tasks.tokens_used exactly,
 * plus an estimate per finished workflow run. Idempotent via the
 * (source, source_id) uniqueness check.
 */
export function seedUsageFromHistory(db: Db, workspaceId: string, now: Date = new Date()): number {
  if (!findWorkspace(db, workspaceId)) throw new AppError('not_found', `workspace ${workspaceId} not found`);
  let seeded = 0;

  for (const t of listTasksWithTokens(db, workspaceId)) {
    if (alreadyMetered(db, 'task', t.id)) continue;
    appendUsage(db, {
      workspaceId,
      agent: t.agent,
      source: 'seed',
      sourceId: t.id,
      credits: creditsForTokens(t.tokensUsed),
      tokens: t.tokensUsed,
      reason: 'seed:task',
      occurredAt: t.createdAt,
    });
    seeded++;
  }

  for (const r of listSucceededRunUsage(db, workspaceId)) {
    if (alreadyMetered(db, 'workflow_run', r.runId)) continue;
    const tokens = Math.max(1, r.stepCount) * WORKFLOW_RUN_TOKENS_PER_STEP;
    appendUsage(db, {
      workspaceId,
      agent: r.workspaceAgentId,
      source: 'seed',
      sourceId: r.runId,
      credits: creditsForTokens(tokens),
      tokens,
      reason: 'seed:workflow_run',
      occurredAt: r.createdAt,
    });
    seeded++;
  }

  if (seeded > 0) enforceSpendCap(db, workspaceId, now);
  return seeded;
}

/** A source is metered if it has a live usage row OR an earlier seed row. */
function alreadyMetered(db: Db, source: 'task' | 'workflow_run', sourceId: string): boolean {
  return usageSourceExists(db, source, sourceId) || usageSourceExists(db, 'seed', sourceId);
}
