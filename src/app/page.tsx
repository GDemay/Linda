import Link from 'next/link';
import { buildMetadata } from '@/lib/seo.ts';
import { AGENT_CATALOG, AGENT_KEYS } from '@/lib/agents/catalog.ts';
import { CONVERSION_COPY, PRICING_COMMON, PRICING_TIERS } from '@/lib/pricing.ts';
import { PageEvent } from './components/PageEvent.tsx';

export const metadata = buildMetadata({
  title: 'Linda — your AI coworkers',
  description:
    'Linda gives small teams a workforce of AI agents for prospecting, marketing, SEO, screening, and admin. 100% self-serve. No demo booking, no sales call.',
  path: '/',
});

export default function Home() {
  return (
    <>
      <PageEvent name="landing_view" />
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

      <main className="shell stack" style={{ gap: 48 }}>
        {/* Hero Section */}
        <header className="stack" style={{ gap: 16, paddingTop: 24, textAlign: 'center', alignItems: 'center' }}>
          <div className="pill ok" style={{ width: 'fit-content' }}>
            Production Ready · 100% Self-Serve
          </div>
          <h1 style={{ fontSize: 42, maxWidth: 840, lineHeight: 1.15, margin: '8px 0' }}>
            Agents that onboard themselves.
          </h1>
          <p style={{ fontSize: 18, maxWidth: 680, lineHeight: 1.6, margin: 0 }}>
            {CONVERSION_COPY.jtbdLine}. Linda is an AI agent workforce for the work that repeats —
            prospecting, content, SEO, support, screening, and admin. You sign up, connect your tools,
            and it starts. There&apos;s no setup call, because there&apos;s nothing for us to set up.
          </p>
          <div className="row" style={{ marginTop: 12, justifyContent: 'center', alignItems: 'center' }}>
            <Link href="/signup">
              <button className="primary" style={{ padding: '12px 28px', fontSize: 16 }}>
                Start free 14-day trial
              </button>
            </Link>
            <span style={{ fontSize: 15 }}>
              <b>{CONVERSION_COPY.flatPriceAnchor}</b>
            </span>
            <Link href="/pricing">
              <button style={{ padding: '12px 24px', fontSize: 16 }}>
                View transparent pricing
              </button>
            </Link>
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 14 }}>
              {CONVERSION_COPY.riskReversalLine}
            </span>
          </div>
        </header>

        {/* Value Proposition / 3 Steps */}
        <section className="card stack" style={{ gap: 24, padding: 32, background: 'var(--surface)' }}>
          <div className="stack" style={{ gap: 6, textAlign: 'center' }}>
            <h2>Three steps, none of them a meeting</h2>
            <p className="muted">Eliminate human bottlenecks from day one.</p>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div className="stack" style={{ gap: 8 }}>
              <div className="pill" style={{ width: 'fit-content' }}>Step 1</div>
              <h3 style={{ fontSize: 17 }}>Sign up in seconds</h3>
              <p className="muted">
                Sign up with your name and email. That&apos;s the entire gate. No approval queue, no sales
                gatekeeper.
              </p>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="pill" style={{ width: 'fit-content' }}>Step 2</div>
              <h3 style={{ fontSize: 17 }}>Connect your tools</h3>
              <p className="muted">
                Pick the services you use. Linda reads what it needs and configures itself around how you already work.
              </p>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="pill" style={{ width: 'fit-content' }}>Step 3</div>
              <h3 style={{ fontSize: 17 }}>Autonomous execution</h3>
              <p className="muted">
                First task completes automatically. Workflows execute cleanly without human babysitting.
              </p>
            </div>
          </div>
        </section>

        {/* Agent Catalog / Workforce */}
        <section className="stack" style={{ gap: 20 }}>
          <div className="spread">
            <div>
              <h2>Meet your autonomous workforce</h2>
              <p className="muted">Specialized agents working asynchronously around the clock.</p>
            </div>
            <span className="pill ok">8 Active Roles</span>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {AGENT_KEYS.map((key) => {
              const agent = AGENT_CATALOG[key];
              return (
                <article key={key} className="card stack" style={{ gap: 10, justifyContent: 'space-between' }}>
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="spread">
                      <h3 style={{ fontSize: 16 }}>{agent.name}</h3>
                      <span className="pill">{agent.role}</span>
                    </div>
                    <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{agent.blurb}</p>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Role: {agent.role}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Transparent Pricing Overview */}
        <section className="stack" style={{ gap: 20 }}>
          <div className="stack" style={{ gap: 6, textAlign: 'center' }}>
            <h2>Transparent pricing with zero surprises</h2>
            <p className="muted">
              Every tier has a published price. Every agent is included on every tier.
            </p>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {PRICING_TIERS.map((tier) => (
              <article key={tier.key} className="card stack" style={{ gap: 12 }}>
                <div className="spread">
                  <h3>{tier.name}</h3>
                  <span className="pill">{tier.seats} seat{tier.seats === 1 ? '' : 's'}</span>
                </div>
                <div>
                  <span style={{ fontSize: 32, fontWeight: 700 }}>${tier.monthlyUsd}</span>
                  <span className="muted" style={{ fontSize: 14 }}> /month</span>
                </div>
                <p className="muted" style={{ fontSize: 13 }}>
                  ${tier.annualUsd}/year billed annually (2 months free).
                </p>
                <p className="muted" style={{ fontSize: 14 }}>{tier.blurb}</p>
                <Link href="/signup" style={{ marginTop: 'auto' }}>
                  <button className="primary" style={{ width: '100%' }}>Start 14-day trial</button>
                </Link>
              </article>
            ))}
          </div>

          <div className="card spread" style={{ padding: 20 }}>
            <div>
              <p style={{ fontWeight: 600, margin: 0 }}>Included on all tiers:</p>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
                All 8 agents · All 15 native connectors · {PRICING_COMMON.trialDays}-day free trial with {PRICING_COMMON.trialRequiresCard ? 'card' : 'no credit card required'}
              </p>
            </div>
            <Link href="/pricing">
              <button>Detailed feature breakdown →</button>
            </Link>
          </div>
        </section>

        {/* Production Readiness & CTA */}
        <section className="card stack" style={{ gap: 16, padding: 36, textAlign: 'center', alignItems: 'center' }}>
          <h2>You could be running before this tab closes.</h2>
          <p className="muted" style={{ maxWidth: 560, fontSize: 16 }}>
            Every screen is built. Every workflow completes. Join hundreds of founders and small teams saving dozens of hours each week.
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <Link href="/signup">
              <button className="primary" style={{ padding: '12px 28px', fontSize: 16 }}>
                Create your workspace now
              </button>
            </Link>
            <Link href="/changelog">
              <button style={{ padding: '12px 24px', fontSize: 16 }}>
                View changelog
              </button>
            </Link>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px', textAlign: 'center' }}>
        <p className="muted" style={{ fontSize: 13 }}>
          © {new Date().getFullYear()} Linda. All rights reserved. Self-serve autonomous workforce for modern teams.
        </p>
      </footer>
    </>
  );
}
