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

describe('stripeCreateSession — session create form', () => {
  it('sends the product tax_code under product_data (Managed Payments requirement)', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const captured: { url: string; body: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      captured.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const res = await startCheckout(
        d,
        { workspaceId: workspace.id, plan: 'starter', origin: 'https://linda.example' },
        envWith({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_y' }),
      );
      expect(res.provider).toBe('stripe');
      expect(res.sessionId).toBe('cs_test_1');
      expect(captured).toHaveLength(1);
      const form = new URLSearchParams(captured[0].body);
      // Without a tax code on the line item, Stripe Managed Payments accounts
      // reject session creation with a 400 ("product tax code is missing").
      expect(form.get('line_items[0][price_data][product_data][tax_code]')).toBe('txcd_10103000');
      // And it must be under product_data — the other placements are unknown params.
      expect(form.get('line_items[0][price_data][tax_code]')).toBeNull();
      expect(form.get('line_items[0][tax_code]')).toBeNull();
      expect(form.get('line_items[0][price_data][product_data][name]')).toBe('Linda Starter plan');
    } finally {
      globalThis.fetch = realFetch;
    }
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

describe('two workspaces buying in the same month (LIN-209 regression)', () => {
  it('gives the second customer of the month distinct invoice numbers — no UNIQUE 500', async () => {
    const d = db();
    const a = await newAccount(d);
    const b = await newAccount(d);
    await onboard(d, a.workspace.id);
    await onboard(d, b.workspace.id);

    // Both buy in the same calendar month: the old per-workspace counter
    // minted INV-YYYYMM-0001 twice and the second insert blew the global
    // UNIQUE on invoices.number (SQLITE 2067 → HTTP 500).
    fulfillCheckout(d, a.workspace.id, 'starter');
    fulfillCheckout(d, b.workspace.id, 'starter');

    const numsA = listInvoices(d, a.workspace.id).map((i) => i.number);
    const numsB = listInvoices(d, b.workspace.id).map((i) => i.number);
    expect(numsA.length).toBe(1);
    expect(numsB.length).toBe(1);
    expect(numsA[0]).not.toBe(numsB[0]);
    expect([...numsA, ...numsB].every((n) => /^INV-\d{6}-\d{4}$/.test(n))).toBe(true);

    // Both customers are actually on the paid plan with a paid invoice.
    expect(billingOverview(d, b.workspace.id).plan.key).toBe('starter');
    expect(listInvoices(d, b.workspace.id)[0].status).toBe('paid');
  });

  it('rolls the whole activation back when the invoice write fails — no partial subscription', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    // Break the invoice insert only: occupy every plausible number for this
    // month so the old collision resurfaces if sequencing regresses.
    const ym = new Date().toISOString().slice(0, 10).replace(/-/g, '').slice(0, 6);
    for (let i = 1; i <= 3; i++) {
      d.prepare(
        `INSERT INTO invoices (id, workspace_id, number, status, period_start, period_end, currency, subtotal_usd, total_usd, issued_at, paid_at)
         VALUES (?, ?, ?, 'paid', ?, ?, 'usd', 0, 0, ?, ?)`,
      ).run(`seed-${i}`, workspace.id, `INV-${ym}-${String(i).padStart(4, '0')}`, '2026-01-01', '2026-01-31', new Date().toISOString(), null);
    }
    fulfillCheckout(d, workspace.id, 'starter');
    // Sequencing skipped the occupied numbers instead of colliding…
    const nums = listInvoices(d, workspace.id).map((i) => i.number);
    expect(nums).toHaveLength(4); // 3 seeds + 1 new
    expect(new Set(nums).size).toBe(nums.length);
    // …and the subscription write and the invoice write committed together.
    expect(billingOverview(d, workspace.id).plan.key).toBe('starter');
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
