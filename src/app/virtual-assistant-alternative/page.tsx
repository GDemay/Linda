import Link from 'next/link';
import { buildMetadata } from '@/lib/seo.ts';

export const metadata = buildMetadata({
  title: 'AI agents vs. a virtual assistant for your small business — Linda',
  description:
    'Honest comparison: what a $3,000/mo human VA still does better than AI agents, where async agents win, and the real cost math. No demo call required.',
  path: '/virtual-assistant-alternative',
});

const signupHref =
  '/signup?utm_source=seo&utm_medium=article&utm_campaign=lin141';

export default function VirtualAssistantAlternativePage() {
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
            <Link href="/build">Build log</Link>
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
          <h1>AI agents vs. a virtual assistant: the honest comparison</h1>
          <p className="muted">
            You are probably here because a VA missed weekend emails, quotes
            drifted, or the $3,000/month invoice stopped making sense. Here is
            the fair version of this comparison — including where hiring a
            human still wins.
          </p>
        </header>

        <section className="card stack" style={{ gap: 8 }}>
          <h2>Where a human VA still wins</h2>
          <ul className="stack" style={{ gap: 6, paddingLeft: 20 }}>
            <li>
              <strong>Judgment calls on relationships.</strong> An upset
              long-time client on the phone needs a human who can read the
              room. Route that to a person.
            </li>
            <li>
              <strong>Physical and off-platform work.</strong> Printing,
              errands, chasing signatures in person — agents cannot do any of
              it.
            </li>
            <li>
              <strong>Deeply unstructured, changing tasks.</strong> If the job
              is &quot;figure out what our ops need this quarter,&quot; that is
              a strategist, not an assistant — human or AI.
            </li>
          </ul>
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <h2>Where async AI agents win</h2>
          <ul className="stack" style={{ gap: 6, paddingLeft: 20 }}>
            <li>
              <strong>Latency.</strong> A VA sleeps, takes holidays, and sits
              in another timezone. The lead that arrives Friday 18:30 gets
              answered Friday 18:30 — every time — by an agent that does not.
            </li>
            <li>
              <strong>Consistency.</strong> Agents follow the same SOP on run
              1,000 as on run 1. No grammar drift, no forgotten steps, no
              re-training when someone quits.
            </li>
            <li>
              <strong>Cost shape.</strong> $49/month flat versus roughly
              $2,500–$4,000/month for a full-time overseas VA — or
              $60,000+/year for a local one. No per-minute surprises.
            </li>
            <li>
              <strong>Review instead of micromanage.</strong> Drafts queue up;
              you approve in seconds. You stop managing a person and start
              auditing work.
            </li>
          </ul>
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <h2>The actual cost math</h2>
          <p>
            A solo founder spending 12 hours a week on intake, reporting, and
            follow-up at a conservative $40/hour of their own time is paying an
            implicit ~$1,900/month. A full-time VA replaces maybe 60% of it
            (they still need supervision) at $3,000/month. A flat $49/month
            agent tier that removes the repetitive 70% outright is the
            cheapest line item of the three — and the only one you can cancel
            without a conversation.
          </p>
          <p className="muted" style={{ fontSize: 14 }}>
            Published prices, no &quot;contact sales&quot; tier:{' '}
            <Link href="/pricing">$49 / $149 / $399 per month</Link>. 14-day
            trial, no credit card.
          </p>
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <h2>When Linda is the wrong choice</h2>
          <p>
            If your work is mostly calls and physical tasks, keep the VA. If
            you need someone to push back on strategy, hire a person. If you
            want a human to be accountable for judgment, no agent should have
            that job yet — ours draft, you approve, and external actions stay
            behind an approval gate until you say otherwise.
          </p>
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <h2>Frequently asked</h2>
          <dl className="stack" style={{ gap: 10 }}>
            <div>
              <dt>
                <strong>What can I try in a trial without a demo call?</strong>
              </dt>
              <dd className="muted">
                Everything. Sign up, type a task in plain English, and one of
                the eight agents runs it. That first task is the whole
                evaluation — no onboarding meeting, no card.
              </dd>
            </div>
            <div>
              <dt>
                <strong>What happens to my data?</strong>
              </dt>
              <dd className="muted">
                Export everything or delete the account yourself, no support
                ticket. Details on the <Link href="/trust">trust page</Link>.
              </dd>
            </div>
            <div>
              <dt>
                <strong>Do agents post or send anything on their own?</strong>
              </dt>
              <dd className="muted">
                External actions wait in a one-click approval queue until you
                explicitly turn on autonomy per workflow.
              </dd>
            </div>
          </dl>
        </section>

        <section className="card stack" style={{ gap: 8, textAlign: 'center' }}>
          <h2>Run your first task before you decide</h2>
          <p className="muted">
            The comparison that matters is your own Monday morning, with one
            repetitive chore gone.
          </p>
          <Link href={signupHref}>
            <button className="primary" style={{ padding: '12px 28px', fontSize: 16 }}>
              Start the 14-day trial — no card
            </button>
          </Link>
          <p className="muted" style={{ fontSize: 13 }}>
            We publish our funnel numbers and shipping log in the{' '}
            <Link href="/build">build log</Link> — including the unflattering
            parts.
          </p>
        </section>
      </main>
    </>
  );
}
