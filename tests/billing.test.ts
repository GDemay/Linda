import { describe, expect, it } from 'vitest';
import {
  PLAN_ENTITLEMENTS,
  entitlementsFor,
  expireDueTrials,
  requireFeature,
  resolvePlan,
  FEATURE_AGENTS_RUN,
} from '../src/lib/billing/entitlements.ts';
import {
  assertWithinCap,
  creditsForTokens,
  recordUsage,
  seedUsageFromHistory,
  setMonthlyLimit,
  TOKENS_PER_CREDIT,
} from '../src/lib/billing/metering.ts';
import { LocalBillingProvider } from '../src/lib/billing/provider.ts';
import { billingOverview } from '../src/lib/billing/service.ts';
import { runTask } from '../src/lib/tasks/engine.ts';
import { findWorkspace, listWorkspaceAgents } from '../src/lib/repos/accounts.ts';
import { listUsage } from '../src/lib/repos/billing.ts';
import { createTask } from '../src/lib/repos/tasks.ts';
import { listActivity } from '../src/lib/repos/workflows.ts';
import { AppError } from '../src/lib/repos/types.ts';
import { PRICING_TIERS } from '../src/lib/pricing.ts';
import { db, fixedClock, newAccount, onboard } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('entitlements — the single source of truth', () => {
  it('keeps every plan price in sync with the published tiers', () => {
    for (const tier of PRICING_TIERS) {
      expect(PLAN_ENTITLEMENTS[tier.key].monthlyUsd).toBe(tier.monthlyUsd);
      expect(PLAN_ENTITLEMENTS[tier.key].seats).toBe(tier.seats);
    }
  });

  it('defines trial and free as part of the plan vocabulary', () => {
    expect(PLAN_ENTITLEMENTS.trial.readOnly).toBe(false);
    expect(PLAN_ENTITLEMENTS.trial.monthlyCredits).toBeGreaterThan(0);
    expect(PLAN_ENTITLEMENTS.free.readOnly).toBe(true);
    expect(PLAN_ENTITLEMENTS.free.monthlyCredits).toBe(0);
    expect(PLAN_ENTITLEMENTS.free.featureFlags).toEqual([]);
  });

  it('publishes the credit conversion (1 credit ~= 1k tokens)', () => {
    expect(TOKENS_PER_CREDIT).toBe(1000);
    expect(creditsForTokens(2500)).toBe(2.5);
  });

  it('falls back to free for unknown plan values, never up', () => {
    expect(entitlementsFor('nonsense')).toMatchObject({ key: 'free', readOnly: true });
  });
});

describe('trial end-state (AC9)', () => {
  it('downgrades an expired trial to free with no human action', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);

    // Age the workspace past 14 days by rewinding its creation date.
    const ws = findWorkspace(d, workspace.id)!;
    rewindCreatedAt(d, workspace.id, 15 * DAY);

    const resolved = resolvePlan(d, workspace.id);
    expect(resolved.plan).toBe('free');
    expect(resolved.downgradedFromTrial).toBe(true);

    // Workspace persisted the downgrade; agents paused with a visible reason.
    expect(findWorkspace(d, workspace.id)!.plan).toBe('free');
    const agents = listWorkspaceAgents(d, workspace.id);
    expect(agents.length).toBeGreaterThan(0);
    for (const a of agents) {
      expect(a.status).toBe('paused');
      expect(a.config.pausedReason).toBe('trial_ended');
    }

    // Never a charge: the downgrade produced no invoice.
    expect(LocalBillingProvider.listInvoices(d, workspace.id)).toEqual([]);

    const events = listActivity(d, workspace.id, 200).map((e) => e.kind);
    expect(events).toContain('billing.trial_expired');
    void ws;
  });

  it('is idempotent — a second resolve does not re-downgrade', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    rewindCreatedAt(d, workspace.id, 20 * DAY);
    expect(resolvePlan(d, workspace.id).downgradedFromTrial).toBe(true);
    expect(resolvePlan(d, workspace.id).downgradedFromTrial).toBe(false);
  });

  it('leaves a live trial alone and reports days left', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const resolved = resolvePlan(d, workspace.id);
    expect(resolved.plan).toBe('trial');
    expect(resolved.trial?.daysLeft).toBeLessThanOrEqual(14);
    expect(resolved.trial?.daysLeft).toBeGreaterThan(13);
  });

  it('expireDueTrials downgrades due trials from the worker path', async () => {
    const d = db();
    const a = await newAccount(d);
    const b = await newAccount(d);
    rewindCreatedAt(d, a.workspace.id, 30 * DAY);
    const downgraded = expireDueTrials(d);
    expect(downgraded).toContain(a.workspace.id);
    expect(downgraded).not.toContain(b.workspace.id);
  });

  it('blocks execution on the free tier with a visible reason', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    rewindCreatedAt(d, workspace.id, 15 * DAY);
    expect(() => requireFeature(d, workspace.id, FEATURE_AGENTS_RUN)).toThrow(AppError);
    try {
      runTask(d, { workspaceId: workspace.id, agent: 'phone', input: 'hello' });
      expect.unreachable('task should not run on a read-only tier');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('payment_required');
      expect((err as AppError).message).toContain('read-only');
    }
  });
});

describe('usage ledger + meters', () => {
  it('derives the month meter from append-only rows, never a counter', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const now = new Date('2026-09-05T12:00:00.000Z');

    recordUsage(d, { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 1000, reason: 'inbound_reply' }, now);
    recordUsage(d, { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 2500, reason: 'call_summary' }, now);

    const rows = listUsage(d, workspace.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'task')).toBe(true);

    const overview = billingOverview(d, workspace.id, now);
    expect(overview.usage.creditsUsed).toBeCloseTo(3.5, 6);
    expect(overview.usage.limitCredits).toBe(PLAN_ENTITLEMENTS.trial.monthlyCredits);
    expect(overview.usage.limitSource).toBe('plan_default');
  });

  it('only counts usage inside the current calendar month', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    recordUsage(
      d,
      { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 900_000, reason: 'old' },
      new Date('2026-08-20T12:00:00.000Z'),
    );
    const overview = billingOverview(d, workspace.id, new Date('2026-09-05T12:00:00.000Z'));
    expect(overview.usage.creditsUsed).toBe(0);
  });

  it('seeds legacy rows (pre-billing tasks + finished runs), idempotently', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);

    // A task from before the ledger existed: inserted at the repo level with
    // no usage row, exactly what migration-time history looks like.
    createTask(d, {
      workspaceId: workspace.id,
      agent: 'phone',
      category: 'Phone',
      title: 'Legacy call summary',
      input: 'old call',
      tokensUsed: 3_500,
    });

    const first = seedUsageFromHistory(d, workspace.id);
    expect(first).toBeGreaterThan(0);
    const seeded = listUsage(d, workspace.id).filter((r) => r.reason === 'seed:task');
    expect(seeded).toHaveLength(1);
    expect(seeded[0].tokens).toBe(3_500);

    const before = listUsage(d, workspace.id).length;
    const second = seedUsageFromHistory(d, workspace.id);
    expect(second).toBe(0);
    expect(listUsage(d, workspace.id).length).toBe(before);
  });
});

describe('hard spend cap (W10)', () => {
  it('notifies once at 80% and pauses every agent at 100%', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    const now = new Date('2026-09-05T12:00:00.000Z');
    const cap = 100;
    setMonthlyLimit(d, workspace.id, cap);

    recordUsage(d, { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 80 * 1000, reason: 'warmup' }, now);
    let events = listActivity(d, workspace.id, 100);
    expect(events.some((e) => e.kind === 'billing.spend_cap_warning')).toBe(true);
    expect(events.some((e) => e.kind === 'billing.spend_cap_reached')).toBe(false);

    // A second warning in the same month stays silent (deduped).
    recordUsage(d, { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 1 * 1000, reason: 'more' }, now);
    events = listActivity(d, workspace.id, 100);
    expect(events.filter((e) => e.kind === 'billing.spend_cap_warning')).toHaveLength(1);

    recordUsage(d, { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 20 * 1000, reason: 'crossing' }, now);
    events = listActivity(d, workspace.id, 100);
    expect(events.some((e) => e.kind === 'billing.spend_cap_reached')).toBe(true);

    const agents = listWorkspaceAgents(d, workspace.id);
    expect(agents.length).toBeGreaterThan(0);
    for (const a of agents) {
      expect(a.status).toBe('paused');
      expect(a.config.pausedReason).toBe('spend_cap');
      expect(typeof a.config.pausedSummary).toBe('string');
    }
  });

  it('blocks tasks once the cap is reached — nothing runs past it silently', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const now = new Date('2026-09-05T12:00:00.000Z');
    setMonthlyLimit(d, workspace.id, 0.1); // 100 tokens

    expect(() => assertWithinCap(d, workspace.id, now)).not.toThrow();
    recordUsage(d, { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 200, reason: 'test' }, now);
    expect(() => assertWithinCap(d, workspace.id, now)).toThrow(AppError);

    try {
      runTask(d, { workspaceId: workspace.id, agent: 'phone', input: 'Should not run' });
      expect.unreachable('task should be blocked at the cap');
    } catch (err) {
      expect((err as AppError).code).toBe('payment_required');
      expect((err as AppError).message).toContain('spend cap reached');
    }
  });

  it('rejects invalid caps', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(() => setMonthlyLimit(d, workspace.id, -5)).toThrow(AppError);
    expect(() => setMonthlyLimit(d, workspace.id, Number.NaN)).toThrow(AppError);
  });

  it('exposes the cap and pause reasons through the billing overview', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    const now = new Date('2026-09-05T12:00:00.000Z');
    setMonthlyLimit(d, workspace.id, 50);
    recordUsage(d, { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 60_000, reason: 'burst' }, now);

    const overview = billingOverview(d, workspace.id, now);
    expect(overview.usage.limitSource).toBe('user_set');
    expect(overview.usage.limitCredits).toBe(50);
    expect(overview.usage.capped).toBe(true);
    expect(overview.creditConversion.tokensPerCredit).toBe(1000);
    const paused = overview.agents.filter((a) => a.status === 'paused');
    expect(paused.length).toBeGreaterThan(0);
    expect(paused.every((a) => a.pausedReason === 'spend_cap')).toBe(true);
  });
});

describe('LocalBillingProvider — realistic invoices', () => {
  it('creates a subscription and issues an invoice with a subscription line', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    const sub = LocalBillingProvider.createSubscription(d, workspace.id, 'team');
    expect(sub.status).toBe('active');
    expect(findWorkspace(d, workspace.id)!.plan).toBe('team');

    const invoices = LocalBillingProvider.listInvoices(d, workspace.id);
    expect(invoices).toHaveLength(1);
    const inv = invoices[0];
    expect(inv.number).toMatch(/^INV-\d{6}-\d{4}$/);
    expect(inv.status).toBe('paid');
    expect(inv.paidAt).toBe(inv.issuedAt);
    expect(inv.lineItems).toHaveLength(1);
    expect(inv.lineItems[0].kind).toBe('subscription');
    expect(inv.lineItems[0].unitUsd).toBe(149);
    expect(inv.totalUsd).toBe(149);
  });

  it('adds an overage line when the month exceeded the plan allowance', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const now = new Date('2026-09-05T12:00:00.000Z');

    // Starter includes 10k credits; burn 11k before subscribing.
    recordUsage(d, { workspaceId: workspace.id, agent: 'phone', source: 'task', tokens: 11_000_000, reason: 'seed' }, now);
    LocalBillingProvider.createSubscription(d, workspace.id, 'starter', now);

    const inv = LocalBillingProvider.listInvoices(d, workspace.id)[0];
    const lines = inv.lineItems;
    expect(lines.map((l) => l.kind)).toEqual(['subscription', 'overage']);
    expect(lines[0].unitUsd).toBe(49);
    expect(lines[1].quantity).toBe(1000); // 11k used - 10k allowance
    expect(inv.totalUsd).toBeCloseTo(49 + 1000 * 0.005, 6);
    // Totals always reconcile to the line items.
    expect(inv.totalUsd).toBeCloseTo(
      lines.reduce((sum, l) => sum + l.amountUsd, 0),
      6,
    );
  });

  it('changes plan, cancels to free with no charge, and numbers invoices sequentially', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const now = new Date('2026-09-05T12:00:00.000Z');

    LocalBillingProvider.createSubscription(d, workspace.id, 'starter', now);
    LocalBillingProvider.changePlan(d, workspace.id, 'scale', now);
    expect(findWorkspace(d, workspace.id)!.plan).toBe('scale');

    const sub = LocalBillingProvider.cancel(d, workspace.id, now);
    expect(sub.status).toBe('canceled');
    expect(findWorkspace(d, workspace.id)!.plan).toBe('free');

    const invoices = LocalBillingProvider.listInvoices(d, workspace.id);
    expect(invoices).toHaveLength(2);
    expect(invoices[0].number).not.toBe(invoices[1].number);
    // Cancellation itself issues no invoice.
    const events = listActivity(d, workspace.id, 100);
    expect(events.some((e) => e.kind === 'billing.subscription_canceled')).toBe(true);
  });

  it('refuses to purchase the trial or free keys', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(() => LocalBillingProvider.createSubscription(d, workspace.id, 'trial')).toThrow(AppError);
    expect(() => LocalBillingProvider.createSubscription(d, workspace.id, 'free')).toThrow(AppError);
  });

  it('lets an expired-trial workspace buy a plan and resume execution', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    rewindCreatedAt(d, workspace.id, 15 * DAY);
    resolvePlan(d, workspace.id); // triggers the downgrade

    LocalBillingProvider.createSubscription(d, workspace.id, 'team');
    const agents = listWorkspaceAgents(d, workspace.id);
    // Subscription to a running plan unblocks the workspace at the gate level;
    // agents were paused by the downgrade and stay paused until resumed.
    expect(() => requireFeature(d, workspace.id, FEATURE_AGENTS_RUN)).not.toThrow();
    expect(agents.every((a) => a.status === 'paused')).toBe(true);
  });
});

// Rewinds a workspace's creation date so its trial window is in the past.
function rewindCreatedAt(d: ReturnType<typeof db>, workspaceId: string, ms: number): void {
  const ws = findWorkspace(d, workspaceId)!;
  const past = new Date(new Date(ws.createdAt).getTime() - ms).toISOString();
  d.prepare('UPDATE workspaces SET created_at = ? WHERE id = ?').run(past, workspaceId);
}
