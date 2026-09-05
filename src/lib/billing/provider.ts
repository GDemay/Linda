import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { setWorkspacePlan } from '../repos/accounts.ts';
import {
  findSubscription,
  insertInvoice,
  listInvoices,
  upsertSubscription,
  type InvoiceLineInput,
} from '../repos/billing.ts';
import { recordActivity } from '../repos/workflows.ts';
import { AppError, type Invoice, type PlanKey, type Subscription } from '../repos/types.ts';
import { PLAN_ENTITLEMENTS, isPaidPlan, pauseAllAgents, resolvePlan } from './entitlements.ts';
import { OVERAGE_USD_PER_CREDIT, usageMeter } from './metering.ts';

/**
 * LocalBillingProvider (LIN-52): writes realistic invoice records —
 * subscription + overage line items — so swapping in Stripe later needs no
 * UI change. Everything is local SQLite; no external charge ever happens.
 */

export type BillingProvider = {
  createSubscription(db: Db, workspaceId: string, plan: PlanKey, now?: Date): Subscription;
  changePlan(db: Db, workspaceId: string, plan: PlanKey, now?: Date): Subscription;
  cancel(db: Db, workspaceId: string, now?: Date): Subscription;
  listInvoices(db: Db, workspaceId: string): Invoice[];
};

const PERIOD_DAYS = 30;

export const LocalBillingProvider: BillingProvider = {
  createSubscription(db, workspaceId, plan, now = new Date()) {
    requirePaidPlan(plan);
    requireWorkspaceRow(db, workspaceId, now);
    const sub = writeSubscription(db, workspaceId, plan, 'active', now);
    recordActivity(db, {
      workspaceId,
      actorType: 'system',
      kind: 'billing.subscription_created',
      summary: `Subscribed to the ${PLAN_ENTITLEMENTS[plan].name} plan`,
      data: { plan, monthlyUsd: PLAN_ENTITLEMENTS[plan].monthlyUsd },
    });
    return sub;
  },

  changePlan(db, workspaceId, plan, now = new Date()) {
    requirePaidPlan(plan);
    requireWorkspaceRow(db, workspaceId, now);
    const current = findSubscription(db, workspaceId);
    const sub = writeSubscription(db, workspaceId, plan, 'active', now);
    recordActivity(db, {
      workspaceId,
      actorType: 'system',
      kind: 'billing.plan_changed',
      summary: `Plan changed to ${PLAN_ENTITLEMENTS[plan].name}`,
      data: { from: current?.plan ?? null, to: plan },
    });
    return sub;
  },

  cancel(db, workspaceId, now = new Date()) {
    requireWorkspaceRow(db, workspaceId, now);
    // Cancel = free tier, read-only from now on. No invoice: cancellation
    // itself is never a charge.
    const start = now.toISOString();
    const sub = upsertSubscription(db, { workspaceId, plan: 'free', status: 'canceled', periodStart: start, periodEnd: start });
    setWorkspacePlan(db, workspaceId, 'free');
    pauseAllAgents(db, workspaceId, 'subscription_canceled', 'Subscription canceled — workspace is read-only');
    recordActivity(db, {
      workspaceId,
      actorType: 'system',
      kind: 'billing.subscription_canceled',
      summary: 'Subscription canceled: workspace moved to the free plan (never a charge)',
      data: { to: 'free' },
    });
    return sub;
  },

  listInvoices(db, workspaceId) {
    return listInvoices(db, workspaceId);
  },
};

function requirePaidPlan(plan: PlanKey): void {
  if (!isPaidPlan(plan)) {
    throw new AppError('invalid', `plan '${plan}' is not purchasable — trial starts at signup, free is the downgrade tier`);
  }
}

function writeSubscription(
  db: Db,
  workspaceId: string,
  plan: PlanKey,
  status: Subscription['status'],
  now: Date,
): Subscription {
  const start = now.toISOString();
  const end = new Date(now.getTime() + PERIOD_DAYS * 24 * 3600 * 1000).toISOString();
  const sub = upsertSubscription(db, { workspaceId, plan, status, periodStart: start, periodEnd: end });
  setWorkspacePlan(db, workspaceId, plan);
  issueInvoiceForPeriod(db, workspaceId, plan, start, end, now);
  return sub;
}

/**
 * One invoice per billing event: the subscription line always, an overage
 * line when this month's usage exceeds the plan allowance. Numbers look
 * like real invoices (INV-YYYYMM-0001) and totals always reconcile to the
 * line items.
 */
function issueInvoiceForPeriod(db: Db, workspaceId: string, plan: PlanKey, start: string, end: string, now: Date): void {
  const entitlements = PLAN_ENTITLEMENTS[plan];
  const meter = usageMeter(db, workspaceId, entitlements, now);
  const lines: InvoiceLineInput[] = [
    {
      kind: 'subscription',
      description: `${entitlements.name} plan — ${entitlements.seats} seat(s), ${entitlements.monthlyCredits.toLocaleString('en-US')} credits/mo`,
      quantity: 1,
      unitUsd: entitlements.monthlyUsd,
    },
  ];
  const overage = Math.max(0, meter.creditsUsed - entitlements.monthlyCredits);
  if (overage > 0) {
    lines.push({
      kind: 'overage',
      description: `Overage — ${(overage).toLocaleString('en-US', { maximumFractionDigits: 2 })} credits beyond the ${entitlements.name} allowance`,
      quantity: overage,
      unitUsd: OVERAGE_USD_PER_CREDIT,
    });
  }
  insertInvoice(db, {
    workspaceId,
    status: 'paid',
    periodStart: start,
    periodEnd: end,
    issuedAt: nowIso(),
    lines,
  });
}

function requireWorkspaceRow(db: Db, workspaceId: string, now: Date) {
  // resolvePlan also performs an expired-trial downgrade first, so a plan
  // purchase from an expired trial lands on a clean state.
  return resolvePlan(db, workspaceId, now);
}
