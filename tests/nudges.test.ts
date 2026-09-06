import { describe, expect, it } from 'vitest';
import {
  TRIAL_NUDGE_DAYS_LEFT,
  USAGE_NUDGE_RATIO,
  dashboardNudges,
  trialNudge,
  usageNudge,
  type NudgeBilling,
} from '../src/lib/billing/nudges.ts';
import { billingOverview } from '../src/lib/billing/service.ts';
import { setMonthlyLimit, recordUsage } from '../src/lib/billing/metering.ts';
import { findWorkspace } from '../src/lib/repos/accounts.ts';
import { db, newAccount } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;

/** A healthy live trial far from any threshold, mutated per test. */
function baseBilling(over: Partial<NudgeBilling> = {}): NudgeBilling {
  return {
    plan: { readOnly: false },
    trial: { daysLeft: 14 },
    usage: { creditsUsed: 0, limitCredits: 5000, ratio: 0, capped: false },
    ...over,
  };
}

describe('trial nudge — final week of the trial (LIN-143)', () => {
  it('shows at the 7-day boundary (inclusive)', () => {
    expect(trialNudge(baseBilling({ trial: { daysLeft: TRIAL_NUDGE_DAYS_LEFT } }))).toEqual({
      kind: 'trial_days',
      daysLeft: 7,
    });
  });

  it('does not show with more than 7 days left', () => {
    expect(trialNudge(baseBilling({ trial: { daysLeft: 8 } }))).toBeNull();
  });

  it('shows on the last day and reports the count', () => {
    expect(trialNudge(baseBilling({ trial: { daysLeft: 1 } }))).toEqual({ kind: 'trial_days', daysLeft: 1 });
  });

  it('never shows once the trial is gone (expired trial is the hard prompt)', () => {
    expect(trialNudge(baseBilling({ trial: null }))).toBeNull();
  });

  it('never shows on a read-only workspace', () => {
    expect(trialNudge(baseBilling({ plan: { readOnly: true }, trial: { daysLeft: 3 } }))).toBeNull();
  });
});

describe('usage nudge — approaching the monthly cap (LIN-143)', () => {
  it('shows at the 80% boundary (inclusive)', () => {
    expect(usageNudge(baseBilling({ usage: { creditsUsed: 4000, limitCredits: 5000, ratio: USAGE_NUDGE_RATIO, capped: false } }))).toEqual({
      kind: 'usage_cap',
      ratio: 0.8,
      creditsUsed: 4000,
      limitCredits: 5000,
    });
  });

  it('does not show below 80%', () => {
    expect(usageNudge(baseBilling({ usage: { creditsUsed: 3950, limitCredits: 5000, ratio: 0.79, capped: false } }))).toBeNull();
  });

  it('yields to the hard prompt once capped — never two banners for one limit', () => {
    expect(usageNudge(baseBilling({ usage: { creditsUsed: 5100, limitCredits: 5000, ratio: 1.02, capped: true } }))).toBeNull();
  });

  it('ignores the degenerate ratio when there is no credit allowance', () => {
    expect(usageNudge(baseBilling({ usage: { creditsUsed: 3, limitCredits: 0, ratio: 1, capped: false } }))).toBeNull();
  });
});

describe('dashboardNudges — composition and order', () => {
  it('shows time pressure first, then capacity, when both thresholds are crossed', () => {
    const both = dashboardNudges(
      baseBilling({ trial: { daysLeft: 5 }, usage: { creditsUsed: 4500, limitCredits: 5000, ratio: 0.9, capped: false } }),
    );
    expect(both.map((n) => n.kind)).toEqual(['trial_days', 'usage_cap']);
  });

  it('is empty for a fresh workspace far from both thresholds', () => {
    expect(dashboardNudges(baseBilling())).toEqual([]);
  });
});

describe('nudges against the real billing overview', () => {
  it('a fresh trial workspace gets no nudge', async () => {
    const d = db();
    const acct = await newAccount(d);
    expect(dashboardNudges(billingOverview(d, acct.workspace.id))).toEqual([]);
  });

  it('a trial in its final week gets the days-left nudge (boundary at day 7)', async () => {
    const d = db();
    const acct = await newAccount(d);
    const ws = findWorkspace(d, acct.workspace.id);
    if (!ws) throw new Error('workspace not found');
    const nowAtDay7 = new Date(new Date(ws.createdAt).getTime() + 7 * DAY);
    const nowAtDay6point5 = new Date(new Date(ws.createdAt).getTime() + 6.5 * DAY);
    expect(dashboardNudges(billingOverview(d, acct.workspace.id, nowAtDay7)).map((n) => n.kind)).toEqual(['trial_days']);
    // 14 - 6.5 = 7.5 → ceil = 8 days left: still below the threshold.
    expect(dashboardNudges(billingOverview(d, acct.workspace.id, nowAtDay6point5))).toEqual([]);
  });

  it('80% of the monthly credits surfaces the usage nudge, capped does not', async () => {
    const d = db();
    const acct = await newAccount(d);
    const wsId = acct.workspace.id;
    setMonthlyLimit(d, wsId, 100); // trial allowance: 100 credits = 100k tokens
    // 79k tokens = 79% → no nudge yet.
    recordUsage(d, { workspaceId: wsId, agent: 'assistant', source: 'task', tokens: 79_000, reason: 'test' });
    expect(dashboardNudges(billingOverview(d, wsId)).map((n) => n.kind)).toEqual([]);
    // +2k tokens → 81% → nudge (not capped).
    recordUsage(d, { workspaceId: wsId, agent: 'assistant', source: 'task', tokens: 2_000, reason: 'test' });
    expect(dashboardNudges(billingOverview(d, wsId)).map((n) => n.kind)).toEqual(['usage_cap']);
    // Past the cap the hard prompt owns the message: nudge suppressed.
    recordUsage(d, { workspaceId: wsId, agent: 'assistant', source: 'task', tokens: 30_000, reason: 'test' });
    expect(usageNudge(billingOverview(d, wsId))).toBeNull();
  });
});
