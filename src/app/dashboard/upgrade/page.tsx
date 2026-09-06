'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';
import { CONVERSION_COPY, PRICING_TIERS, type PricingTier } from '@/lib/pricing.ts';
import { PageEvent } from '@/app/components/PageEvent.tsx';

/**
 * Upgrade page (LIN-131) — the paying end of the funnel. Reached from the
 * dashboard banner at cap/limit moments and from the pricing page after
 * login. Button click -> POST checkout -> redirect to the provider (Stripe)
 * or instant local fulfillment (dev); the provider is env-configured, the
 * UI never knows which one answered.
 */

type BillingOverview = {
  plan: { key: string; name: string; monthlyUsd: number; monthlyCredits: number; seats: number; readOnly: boolean };
  trial: { endsAt: string; daysLeft: number } | null;
  subscription: { plan: string; status: string } | null;
  checkout: { provider: 'stripe' | 'local' | 'none'; configured: boolean };
  usage: { creditsUsed: number; limitCredits: number; capped: boolean };
  agents: { name: string; status: string; pausedReason: string | null }[];
};

export default function UpgradePage() {
  return (
    <Suspense>
      <Upgrade />
    </Suspense>
  );
}

function Upgrade() {
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = params.get('workspace');
  const checkoutState = params.get('checkout'); // 'success' | 'cancelled'

  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setOverview(await api<BillingOverview>(`/workspaces/${workspaceId}/billing`));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      router.replace('/login');
      return;
    }
    load().catch((err) => setError((err as Error).message));
  }, [workspaceId, load, router]);

  async function upgrade(tier: PricingTier) {
    if (!workspaceId) return;
    setError(null);
    setBusyPlan(tier.key);
    try {
      const res = await api<{ provider: string; url: string | null }>(
        `/workspaces/${workspaceId}/billing/checkout`,
        { body: { plan: tier.key } },
      );
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setError('Checkout did not return a place to continue — please try again.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyPlan(null);
    }
  }

  const pausedByBilling =
    overview?.agents.filter((a) =>
      ['spend_cap', 'trial_ended', 'subscription_canceled'].includes(a.pausedReason ?? ''),
    ) ?? [];
  const currentPlanKey = overview?.subscription?.plan ?? overview?.plan.key;
  const percentUsed =
    overview && overview.usage.limitCredits > 0
      ? Math.round((overview.usage.creditsUsed / overview.usage.limitCredits) * 100)
      : 0;

  return (
    <>
      <PageEvent name="upgrade_view" />
      <nav className="topbar">
        <div className="inner">
          <Link href="/">Linda</Link>
          {workspaceId && (
            <div className="row">
              <Link href={`/dashboard?workspace=${encodeURIComponent(workspaceId)}`}>Back to dashboard</Link>
            </div>
          )}
        </div>
      </nav>

      <main className="shell stack">
        {checkoutState === 'success' && (
          <div className="card" style={{ borderColor: 'var(--ok, green)' }}>
            <b>Payment received — you&apos;re on.</b>{' '}
            {pausedByBilling.length > 0
              ? ` Your ${pausedByBilling.length} paused agent${pausedByBilling.length === 1 ? ' is' : 's are'} resuming now.`
              : ' Your plan is active.'}
          </div>
        )}
        {checkoutState === 'cancelled' && (
          <div className="card">
            <b>Checkout cancelled.</b> Nothing was charged — pick a plan whenever you&apos;re ready.
          </div>
        )}

        <header className="stack" style={{ gap: 8, marginBottom: 8 }}>
          <h1>Upgrade</h1>
          {overview && (
            <p className="muted" style={{ fontSize: 16, maxWidth: 620 }}>
              You&apos;re on the <b>{overview.plan.name}</b> plan
              {overview.trial
                ? ` — trial, ${overview.trial.daysLeft} day${overview.trial.daysLeft === 1 ? '' : 's'} left`
                : ''}
              {overview.usage.limitCredits > 0
                ? ` · ${overview.usage.creditsUsed.toFixed(0)}/${overview.usage.limitCredits.toLocaleString('en-US')} credits this month (${percentUsed}%)`
                : ''}
              . Every tier is one flat monthly price — {CONVERSION_COPY.flatPriceAnchor.toLowerCase()}.
            </p>
          )}
        </header>

        {error && (
          <div className="card" role="alert" style={{ borderColor: 'var(--warn, orange)' }}>
            {error}
          </div>
        )}

        {overview && !overview.checkout.configured && (
          <div className="card" role="alert">
            <b>Card checkout isn&apos;t switched on for this deployment yet.</b>
            <p className="muted" style={{ marginTop: 6 }}>
              Your workspace stays fully usable on its current plan in the meantime — we&apos;ll have
              payment live here shortly. Nothing expired and nothing was lost.
            </p>
          </div>
        )}

        <section className="grid">
          {PRICING_TIERS.map((tier) => {
            const isCurrent = currentPlanKey === tier.key;
            return (
              <article key={tier.key} className="card stack" style={{ gap: 10 }}>
                <div className="spread">
                  <h3>{tier.name}</h3>
                  <span className="pill">{tier.seats} seat{tier.seats === 1 ? '' : 's'}</span>
                </div>
                <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
                  ${tier.monthlyUsd}
                  <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> /month</span>
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  {tier.monthlyCredits.toLocaleString('en-US')} credits/mo included · overage billed per
                  credit, capped by your spend cap.
                </p>
                <p className="muted">{tier.blurb}</p>
                <button
                  className="primary"
                  disabled={isCurrent || busyPlan !== null || (overview !== null && !overview.checkout.configured)}
                  onClick={() => upgrade(tier)}
                >
                  {isCurrent ? 'Current plan' : busyPlan === tier.key ? 'Starting checkout…' : `Upgrade to ${tier.name}`}
                </button>
              </article>
            );
          })}
        </section>

        <p className="muted">
          Cancel any time from billing settings — cancellation moves the workspace to the free
          read-only tier, it never deletes anything. {CONVERSION_COPY.riskReversalLine}.
        </p>
      </main>
    </>
  );
}
