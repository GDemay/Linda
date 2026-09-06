import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_RETRIES,
  activationPhase,
  isSubscriptionActive,
  waitForActivation,
} from '../src/lib/billing/activation.ts';
import { startCheckout } from '../src/lib/billing/checkout.ts';
import { LocalBillingProvider } from '../src/lib/billing/provider.ts';
import { billingOverview } from '../src/lib/billing/service.ts';
import { listInvoices } from '../src/lib/repos/billing.ts';
import { db, newAccount, onboard } from './helpers.ts';

const neverSleep = () => Promise.resolve();

describe('isSubscriptionActive — the success gate (LIN-142)', () => {
  it('is true only when the bought plan is live', () => {
    expect(isSubscriptionActive({ plan: 'starter', status: 'active' }, 'starter')).toBe(true);
    // Webhook still in flight: no subscription row at all.
    expect(isSubscriptionActive(null, 'starter')).toBe(false);
    // Still on trial/free while the overview lags the payment.
    expect(isSubscriptionActive({ plan: 'trial', status: 'active' }, 'starter')).toBe(false);
    // Paid, but a different plan than the one just purchased.
    expect(isSubscriptionActive({ plan: 'team', status: 'active' }, 'starter')).toBe(false);
    // Right plan, but canceled — never claim active.
    expect(isSubscriptionActive({ plan: 'starter', status: 'canceled' }, 'starter')).toBe(false);
  });

  it('without an expected plan, any active paid plan counts', () => {
    expect(isSubscriptionActive({ plan: 'scale', status: 'active' }, null)).toBe(true);
    expect(isSubscriptionActive({ plan: 'free', status: 'active' }, null)).toBe(false);
    expect(isSubscriptionActive({ plan: 'trial', status: 'active' }, null)).toBe(false);
  });
});

describe('activationPhase — honest interim vs delayed copy', () => {
  it('reports active the moment the subscription is live', () => {
    expect(activationPhase({ plan: 'team', status: 'active' }, 'team', 0)).toBe('active');
  });

  it('reports activating while the poll budget lasts (webhook delay)', () => {
    expect(activationPhase(null, 'starter', 1)).toBe('activating');
  });

  it('reports delayed once the budget is spent without activation', () => {
    expect(activationPhase(null, 'starter', 0)).toBe('delayed');
    expect(activationPhase({ plan: 'trial', status: 'active' }, 'starter', 0)).toBe('delayed');
  });
});

describe('waitForActivation — the poll driver', () => {
  it('resolves active on the first read when the plan is already live', async () => {
    const phases: string[] = [];
    const phase = await waitForActivation(() => ({ plan: 'starter', status: 'active' }), {
      expectedPlan: 'starter',
      sleep: neverSleep,
      onPhase: (p) => phases.push(p),
    });
    expect(phase).toBe('active');
    expect(phases).toEqual(['active']);
  });

  it('polls through the webhook delay and turns active mid-poll', async () => {
    const reads = [
      null, // redirect landed before the webhook
      null, // still in flight
      { plan: 'team', status: 'active' as const }, // webhook applied
    ];
    const sleeps: number[] = [];
    const phases: string[] = [];
    const phase = await waitForActivation(() => reads.shift() ?? null, {
      expectedPlan: 'team',
      intervalMs: 2000,
      sleep: async (ms) => { sleeps.push(ms); },
      onPhase: (p) => phases.push(p),
    });
    expect(phase).toBe('active');
    expect(sleeps).toEqual([2000, 2000]);
    expect(phases).toEqual(['activating', 'activating', 'active']);
  });

  it('gives up honestly (delayed) after the full retry budget', async () => {
    let reads = 0;
    const sleeps: number[] = [];
    const phase = await waitForActivation(
      () => {
        reads += 1;
        return null;
      },
      { expectedPlan: 'starter', sleep: async (ms) => { sleeps.push(ms); } },
    );
    expect(phase).toBe('delayed');
    expect(reads).toBe(ACTIVATION_RETRIES + 1);
    expect(sleeps.length).toBe(ACTIVATION_RETRIES);
  });

  it('retries: 0 degenerates to a single read — the cancelled landing never polls', async () => {
    let reads = 0;
    const sleeps: number[] = [];
    const phase = await waitForActivation(
      () => {
        reads += 1;
        return { plan: 'trial', status: 'active' };
      },
      { expectedPlan: null, retries: 0, sleep: async (ms) => { sleeps.push(ms); } },
    );
    expect(phase).toBe('delayed'); // phase is only rendered on checkout=success
    expect(reads).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe('end-to-end against the real billing stack', () => {
  it('local checkout is active on first read, and the purchase shows as a paid invoice', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    await startCheckout(
      d,
      { workspaceId: workspace.id, plan: 'starter', origin: 'http://localhost:3000' },
      { ...process.env, CHECKOUT_PROVIDER: 'local' } as NodeJS.ProcessEnv,
    );

    // The success page's gate: billing overview reports the live subscription.
    const overview = billingOverview(d, workspace.id);
    const phase = await waitForActivation(() => overview.subscription, {
      expectedPlan: 'starter',
      sleep: neverSleep,
    });
    expect(phase).toBe('active');

    // And the receipt the page links: latest invoice is paid, for the plan.
    const invoices = listInvoices(d, workspace.id);
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices[0].status).toBe('paid');
    expect(invoices[0].lineItems.some((li) => li.kind === 'subscription')).toBe(true);
  });

  it('a webhook that lands mid-poll flips the gate from activating to active', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);

    let fulfilled = false;
    const phase = await waitForActivation(
      () => {
        // Simulate the Stripe webhook applying after the second read.
        if (!fulfilled) {
          fulfilled = true;
          return billingOverview(d, workspace.id).subscription; // null — webhook not yet landed
        }
        LocalBillingProvider.createSubscription(d, workspace.id, 'team');
        return billingOverview(d, workspace.id).subscription;
      },
      { expectedPlan: 'team', sleep: neverSleep },
    );
    expect(phase).toBe('active');
  });

  it('a canceled subscription never reads as active', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    LocalBillingProvider.createSubscription(d, workspace.id, 'starter');
    LocalBillingProvider.cancel(d, workspace.id);

    const overview = billingOverview(d, workspace.id);
    expect(overview.subscription?.status).toBe('canceled');
    const phase = await waitForActivation(() => overview.subscription, {
      expectedPlan: 'starter',
      retries: 1,
      sleep: neverSleep,
    });
    expect(phase).toBe('delayed');
  });
});
