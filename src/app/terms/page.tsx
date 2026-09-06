import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata } from '@/lib/seo.ts';
import { PRICING_COMMON } from '@/lib/pricing.ts';

/**
 * Minimal Terms page (LIN-121): the signup footer promises linked terms, so
 * the page states the deal in plain English instead of shipping a 404. Facts
 * (trial length, card policy) come from PRICING_COMMON so they can't drift
 * from the pricing page. No design cycle — same shell as /changelog.
 */
export const metadata: Metadata = buildMetadata({
  title: 'Terms of Service — Linda',
  description: 'The plain-English terms you agree to when you use Linda.',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <>
      <nav className="topbar">
        <div className="inner">
          <Link href="/" className="brand">
            Linda
          </Link>
          <div className="row">
            <Link href="/pricing">Pricing</Link>
            <Link href="/changelog">Changelog</Link>
            <Link href="/trust">Trust</Link>
            <Link href="/login">Log in</Link>
            <Link href="/signup">
              <button className="primary">Get started</button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="shell narrow stack">
        <header>
          <h1>Terms of Service</h1>
          <p className="muted">Plain English. Last updated 2026-09-06.</p>
        </header>

        <section className="stack">
          <article className="card stack" style={{ gap: 6 }}>
            <h3>Your account &amp; trial</h3>
            <p className="muted">
              Signing up creates a workspace under your email. Every new workspace starts with a{' '}
              {PRICING_COMMON.trialDays}-day free trial.{' '}
              {PRICING_COMMON.trialRequiresCard
                ? 'A card is required to start the trial.'
                : 'No credit card is required to start the trial.'}{' '}
              When the trial ends your workspace moves to the free plan — we never charge you automatically.
            </p>
          </article>

          <article className="card stack" style={{ gap: 6 }}>
            <h3>What you pay for</h3>
            <p className="muted">
              Paid plans are billed per workspace at the published rates on the{' '}
              <Link href="/pricing">pricing page</Link>. Usage beyond a plan&apos;s included credits is metered and
              capped by your workspace&apos;s hard spend cap — you can set that cap yourself, and the{' '}
              <Link href="/trust">trust page</Link> publishes exactly how credits convert.
            </p>
          </article>

          <article className="card stack" style={{ gap: 6 }}>
            <h3>Your data &amp; your accounts</h3>
            <p className="muted">
              You keep ownership of everything you upload and everything your agents produce. Linda never sends
              anything from your connected accounts without your explicit approval. See the{' '}
              <Link href="/privacy">Privacy Policy</Link> for how data is handled.
            </p>
          </article>

          <article className="card stack" style={{ gap: 6 }}>
            <h3>Cancelling</h3>
            <p className="muted">
              You can stop using Linda at any time from inside the product. If a paid charge ever feels wrong, reply
              to any email from us and a human will sort it out.
            </p>
          </article>
        </section>
      </main>
    </>
  );
}
