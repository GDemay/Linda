import type { Db } from '../db/index.ts';
import { listWorkspaceAgents } from '../repos/accounts.ts';
import { findSubscription } from '../repos/billing.ts';
import { resolvePlan } from './entitlements.ts';
import { OVERAGE_USD_PER_CREDIT, TOKENS_PER_CREDIT, usageMeter } from './metering.ts';

/**
 * Everything the billing UI needs in one round trip: plan entitlements,
 * the month's meter, the cap, trial state, and each agent's pause reason
 * (spend cap, trial end, cancellation — all visible, never silent).
 */
export function billingOverview(db: Db, workspaceId: string, now: Date = new Date()) {
  const resolved = resolvePlan(db, workspaceId, now);
  const meter = usageMeter(db, workspaceId, resolved.entitlements, now);
  const subscription = findSubscription(db, workspaceId);
  const agents = listWorkspaceAgents(db, workspaceId);
  return {
    plan: resolved.entitlements,
    trial: resolved.trial,
    downgradedFromTrial: resolved.downgradedFromTrial,
    subscription,
    usage: meter,
    creditConversion: {
      tokensPerCredit: TOKENS_PER_CREDIT,
      overageUsdPerCredit: OVERAGE_USD_PER_CREDIT,
      description: `1 credit ≈ ${TOKENS_PER_CREDIT.toLocaleString('en-US')} tokens`,
    },
    agents: agents.map((a) => ({
      key: a.agentKey,
      name: a.displayName,
      status: a.status,
      pausedReason: (a.config.pausedReason as string | undefined) ?? null,
      pausedSummary: (a.config.pausedSummary as string | undefined) ?? null,
    })),
  };
}
