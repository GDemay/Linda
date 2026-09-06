import Link from 'next/link';
import { buildMetadata, productJsonLd } from '@/lib/seo.ts';
import { JsonLd } from '../components/JsonLd.tsx';
import { CONVERSION_COPY, CREDIT_CONVERSION, PRICING_COMMON, PRICING_TIERS } from '@/lib/pricing.ts';
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
      {/* LIN-206: Product/Offer with the exact tier prices rendered below. */}
      <JsonLd data={productJsonLd()} />
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
          {/* LIN-204: the trial terms belong at the top, next to the decision —
              not buried below the tier cards. */}
          <p style={{ fontSize: 15, margin: 0 }}>
            <b>{CONVERSION_COPY.riskReversalLine}.</b>
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
              {/* LIN-204: publish the included monthly credits per card —
                  entitlements already read from these numbers (LIN-131), so
                  the card states what the plan actually ships with instead of
                  deferring to "caps being finalized." */}
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Includes {tier.monthlyCredits.toLocaleString('en-US')} task credits/mo.
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
            {/* LIN-204: replaced "caps being finalized / fair use applies" —
                vagueness reads as a hidden limit. The credit allowance is
                published per card above; this states the conversion and the
                cap honestly. */}
            Volume is measured in task credits: 1 credit ≈ {CREDIT_CONVERSION.tokensPerCredit.toLocaleString('en-US')}{' '}
            tokens, overage is ${CREDIT_CONVERSION.overageUsdPerCredit}/credit, and your workspace spend
            cap bounds the total — no surprise bills. Above Scale&apos;s 20 seats it&apos;s a custom deal,
            but every published tier here is self-serve, start to finish.
          </p>
        </section>

        {/* LIN-204: answer the two pre-signup questions support would get, in
            code, with no human on our side. Both answers are verified against
            billing behavior (trial auto-downgrades to a read-only free
            workspace; payment only enters via explicit checkout). */}
        <section className="stack">
          <h2>Before you start</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div className="card stack" style={{ gap: 6, padding: 20 }}>
              <h3 style={{ fontSize: 16, margin: 0 }}>Do I need a credit card?</h3>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                No. The trial takes a name and work email — that&apos;s the entire gate. You only ever
                pay by explicitly choosing a plan and checking out.
              </p>
            </div>
            <div className="card stack" style={{ gap: 6, padding: 20 }}>
              <h3 style={{ fontSize: 16, margin: 0 }}>What happens when the trial ends?</h3>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Your workspace switches to read-only until you pick a plan. Nothing is charged
                automatically — ever.
              </p>
            </div>
            <div className="card stack" style={{ gap: 6, padding: 20 }}>
              <h3 style={{ fontSize: 16, margin: 0 }}>What if I&apos;m not sure it&apos;s real?</h3>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Everything on this page is live in production. Read the{' '}
                <Link href="/build">public build log</Link> — what shipped, and exactly when.
              </p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
