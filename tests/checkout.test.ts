import { afterEach, describe, expect, it } from 'vitest';
import {
  fulfillCheckout,
  handleStripeWebhook,
  resolveCheckout,
  signStripePayload,
  startCheckout,
  verifyStripeSignature,
} from '../src/lib/billing/checkout.ts';
import { LocalBillingProvider } from '../src/lib/billing/provider.ts';
import { billingOverview } from '../src/lib/billing/service.ts';
import { findWorkspace, listWorkspaceAgents } from '../src/lib/repos/accounts.ts';
import { listInvoices } from '../src/lib/repos/billing.ts';
import { AppError } from '../src/lib/repos/types.ts';
import { db, newAccount, onboard } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

function envWith(over: Record<string, string | undefined>) {
  return { ...process.env, ...over } as NodeJS.ProcessEnv;
}

function rewindCreatedAt(d: ReturnType<typeof db>, workspaceId: string, ms: number): void {
  const ws = findWorkspace(d, workspaceId)!;
  const past = new Date(new Date(ws.createdAt).getTime() - ms).toISOString();
  d.prepare('UPDATE workspaces SET created_at = ? WHERE id = ?').run(past, workspaceId);
}

describe('checkout provider resolution (env-configurable adapter)', () => {
  it('defaults to none when no Stripe credentials exist', () => {
    expect(resolveCheckout({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toEqual({ provider: 'none', stripe: null });
  });

  it('auto-selects stripe when both secrets are present', () => {
    const r = resolveCheckout(envWith({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_y' }));
    expect(r.provider).toBe('stripe');
    expect(r.stripe).toEqual({ secretKey: 'sk_test_x', webhookSecret: 'whsec_y' });
  });

  it('honors an explicit CHECKOUT_PROVIDER', () => {
    expect(resolveCheckout(envWith({ CHECKOUT_PROVIDER: 'local' })).provider).toBe('local');
    expect(resolveCheckout(envWith({ CHECKOUT_PROVIDER: 'none', STRIPE_SECRET_KEY: 'k', STRIPE_WEBHOOK_SECRET: 'w' })).provider).toBe('none');
    expect(() => resolveCheckout(envWith({ CHECKOUT_PROVIDER: 'stripe' }))).toThrow(AppError);
  });

  it('exposes availability in the billing overview so the UI can render honestly', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(billingOverview(d, workspace.id).checkout).toEqual({ provider: 'none', configured: false });
  });
});

describe('startCheckout', () => {
  it('answers 402 payment_required when no provider is configured', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await expect(
      startCheckout(d, { workspaceId: workspace.id, plan: 'starter', origin: 'https://linda.example' }, {}),
    ).rejects.toMatchObject({ code: 'payment_required' });
  });

  it('local provider fulfills instantly and lands on the success view', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    const res = await startCheckout(
      d,
      { workspaceId: workspace.id, plan: 'starter', origin: 'http://localhost:3000' },
      envWith({ CHECKOUT_PROVIDER: 'local' }),
    );
    expect(res.provider).toBe('local');
    expect(res.url).toContain('/dashboard/upgrade?');
    expect(res.url).toContain('checkout=success');
    expect(billingOverview(d, workspace.id).plan.key).toBe('starter');
  });
});

describe('fulfillCheckout — the money-moved moment', () => {
  it('activates the plan and resumes agents billing paused (cap, trial end)', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    // Run the trial out: downgrade pauses every agent with pausedReason 'trial_ended'.
    rewindCreatedAt(d, workspace.id, 15 * DAY);
    const before = billingOverview(d, workspace.id);
    expect(before.plan.readOnly).toBe(true);

    const { subscription, alreadyActive } = fulfillCheckout(d, workspace.id, 'team');
    expect(alreadyActive).toBe(false);
    expect(subscription.plan).toBe('team');
    expect(findWorkspace(d, workspace.id)!.plan).toBe('team');

    // The customer paid: agents paused *by billing* come back immediately.
    const agents = listWorkspaceAgents(d, workspace.id);
    expect(agents.length).toBeGreaterThan(0);
    for (const a of agents) {
      expect(a.status).toBe('active');
      expect(a.config.pausedReason).toBeUndefined();
    }
    // An invoice exists for the new period — checkout completes the ledger.
    expect(LocalBillingProvider.listInvoices(d, workspace.id).length).toBeGreaterThan(0);
  });

  it('is idempotent — a redelivered webhook must not double-invoice', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    fulfillCheckout(d, workspace.id, 'starter');
    const invoices = listInvoices(d, workspace.id).length;
    const second = fulfillCheckout(d, workspace.id, 'starter');
    expect(second.alreadyActive).toBe(true);
    expect(listInvoices(d, workspace.id).length).toBe(invoices);
  });

  it('rejects non-purchasable plans (trial/free)', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(() => fulfillCheckout(d, workspace.id, 'trial')).toThrow(AppError);
    expect(() => fulfillCheckout(d, workspace.id, 'free')).toThrow(AppError);
  });
});

describe('Stripe webhook signature verification', () => {
  const secret = 'whsec_test';
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const nowSec = 1_800_000_000;

  it('accepts a correctly signed, recent payload', () => {
    const header = signStripePayload(payload, secret, nowSec);
    expect(verifyStripeSignature(payload, header, secret, nowSec)).toBe(true);
  });

  it('rejects a wrong secret, tampered payload, missing header, and stale timestamp', () => {
    const header = signStripePayload(payload, secret, nowSec);
    expect(verifyStripeSignature(payload, header, 'whsec_other', nowSec)).toBe(false);
    expect(verifyStripeSignature(payload + ' ', header, secret, nowSec)).toBe(false);
    expect(verifyStripeSignature(payload, null, secret, nowSec)).toBe(false);
    // Outside the 300s tolerance window.
    expect(verifyStripeSignature(payload, header, secret, nowSec + 400)).toBe(false);
  });
});

describe('handleStripeWebhook', () => {
  const secret = 'whsec_test';

  function stripeEvent(workspaceId: string, plan: string, paymentStatus = 'paid') {
    return JSON.stringify({
      id: 'evt_test',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: workspaceId, payment_status: paymentStatus, metadata: { workspaceId, plan } } },
    });
  }

  it('activates the plan from a signed checkout.session.completed event', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const payload = stripeEvent(workspace.id, 'starter');
    const env = envWith({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: secret });
    const header = signStripePayload(payload, secret, Math.floor(Date.now() / 1000));
    const result = await handleStripeWebhook(d, payload, header, env);
    expect(result.handled).toBe('checkout.session.completed');
    expect(findWorkspace(d, workspace.id)!.plan).toBe('starter');
  });

  it('rejects an unsigned or wrongly signed delivery', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const env = envWith({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: secret });
    const payload = stripeEvent(workspace.id, 'starter');
    await expect(handleStripeWebhook(d, payload, 't=1,v1=deadbeef', env)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(handleStripeWebhook(d, payload, null, env)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(findWorkspace(d, workspace.id)!.plan).toBe('trial');
  });

  it('acknowledges unrelated event types without acting', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } });
    const env = envWith({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: secret });
    const header = signStripePayload(payload, secret, Math.floor(Date.now() / 1000));
    const result = await handleStripeWebhook(d, payload, header, env);
    expect(result.handled).toBeNull();
  });

  it('waits for async payments instead of activating early', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const payload = stripeEvent(workspace.id, 'starter', 'processing');
    const env = envWith({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: secret });
    const header = signStripePayload(payload, secret, Math.floor(Date.now() / 1000));
    await handleStripeWebhook(d, payload, header, env);
    expect(findWorkspace(d, workspace.id)!.plan).toBe('trial');
  });
});
