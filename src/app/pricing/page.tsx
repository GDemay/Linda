import Link from 'next/link';
import { buildMetadata } from '@/lib/seo.ts';
import { CONVERSION_COPY, PRICING_COMMON, PRICING_TIERS } from '@/lib/pricing.ts';
import { PageEvent } from '../components/PageEvent.tsx';

export const metadata = buildMetadata({
  title: 'Pricing — Linda',
  description:
    'Client approvals and reporting without the Slack back-and-forth. From $49/mo flat — no per-minute billing. 14-day free trial, no credit card.',
  path: '/pricing',
});

export default function PricingPage() {
  return (
    <>
      {/* LIN-111: pricing funnel entry — pricing_view → signup_start → signup_complete. */}
      <PageEvent name="pricing_view" />
      <nav className="topbar">
        <div className="inner">
          <Link href="/" className="brand">
            Linda
          </Link>
          <div className="row">
            <Link href="/pricing">Pricing</Link>
            <Link href="/changelog">Changelog</Link>
            <Link href="/build">Build log</Link>
            <Link href="/trust">Trust</Link>
            <Link href="/login">Log in</Link>
            <Link href="/signup">
              <button className="primary">Get started</button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="shell stack">
        <header className="stack" style={{ gap: 8, marginBottom: 8 }}>
          <h1>Pricing</h1>
          <p style={{ fontSize: 18, maxWidth: 620, margin: 0 }}>
            {CONVERSION_COPY.jtbdLine}.
          </p>
          <p className="muted" style={{ fontSize: 16, maxWidth: 620 }}>
            No &quot;contact us,&quot; no promo codes. Every agent and every integration is on every tier
            — you pay for seats and volume, not for which coworker you&apos;re allowed to hire.
          </p>
        </header>

        <section className="grid">
          {PRICING_TIERS.map((tier) => (
            <article key={tier.key} className="card stack" style={{ gap: 10 }}>
              <div className="spread">
                <h3>{tier.name}</h3>
                <span className="pill">{tier.seats} seat{tier.seats === 1 ? '' : 's'}</span>
              </div>
              <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
                ${tier.monthlyUsd}
                <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>
                  {' '}
                  /month
                </span>
              </p>
              <p className="muted" style={{ margin: 0 }}>
                ${tier.annualUsd}/year billed annually — two months free.
              </p>
              <p className="muted">{tier.blurb}</p>
              <Link href="/signup">
                <button className="primary">Start free trial</button>
              </Link>
              <p className="muted" style={{ margin: 0, textAlign: 'center', fontSize: 14 }}>
                {CONVERSION_COPY.riskReversalLine}
              </p>
              {tier.key === 'starter' && (
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                  <b>{CONVERSION_COPY.flatPriceAnchor}.</b> {CONVERSION_COPY.flatPriceContrast}
                </p>
              )}
            </article>
          ))}
        </section>

        <section className="stack">
          <h2>Included on every tier</h2>
          <ul>
            <li>All agents — phone, marketing, SEO, sales, finance, legal, recruiting, chief of staff.</li>
            <li>All integrations.</li>
            <li>
              {PRICING_COMMON.trialDays}-day free trial,{' '}
              {PRICING_COMMON.trialRequiresCard ? 'credit card required' : 'no credit card required'}.
            </li>
          </ul>
          <p className="muted">
            Task volume caps by tier are being finalized against per-task cost data; fair use applies
            until published. Above Scale&apos;s 20-seat cap, that&apos;s a custom deal — reach out — but
            every published tier here is self-serve, start to finish.
          </p>
        </section>
      </main>
    </>
  );
}
