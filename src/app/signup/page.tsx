import type { Metadata } from 'next';
import Link from 'next/link';
import { PRICING_COMMON } from '@/lib/pricing.ts';
import { PageEvent } from '../components/PageEvent.tsx';
import { SignupForm } from './SignupForm.tsx';

/**
 * Signup conversion page (LIN-105).
 *
 * Server-rendered end to end: headline, value prop, form markup and trial
 * terms all arrive in the first HTML response, so the page is complete on
 * first paint and survives link previews with JavaScript disabled. The
 * interactive form lives in SignupForm, which must never call
 * `useSearchParams` — that hook opts the route out of SSR and is exactly
 * why the old page rendered empty server-side.
 */

export const metadata: Metadata = {
  title: 'Sign up — Linda',
  description:
    'Start your 14-day free trial of Linda, the AI agent workforce that onboards itself. No credit card, no demo call — your first agent is working in minutes.',
};

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: '1',
    title: 'Sign up in seconds',
    body: 'Name and email — that is the entire gate. No approval queue, no sales call.',
  },
  {
    n: '2',
    title: 'Connect your tools',
    body: 'Pick the services you already use. Linda reads what it needs and configures itself around how you work.',
  },
  {
    n: '3',
    title: 'Agents get to work',
    body: 'Your first task completes automatically. Workflows run without human babysitting.',
  },
];

export default function SignupPage() {
  return (
    <>
      <PageEvent name="signup_view" />
      <nav className="topbar">
        <div className="inner">
          <Link href="/" className="brand">
            Linda
          </Link>
          <div className="row">
            <Link href="/pricing">Pricing</Link>
            <Link href="/login">Log in</Link>
          </div>
        </div>
      </nav>

      <main className="shell">
        <div className="signup-grid">
          {/* Form column — server-rendered markup, client-side interactivity */}
          <section className="card stack" style={{ gap: 16, padding: 32 }}>
            <header className="stack" style={{ gap: 8 }}>
              <div className="pill ok" style={{ width: 'fit-content' }}>
                14-day free trial · no credit card
              </div>
              <h1 style={{ fontSize: 30 }}>Start your free 14-day trial</h1>
              <p className="muted" style={{ fontSize: 15 }}>
                Linda is an AI agent workforce that onboards itself — sign up, connect your tools, and your first
                agent is working in about four minutes. No setup call, because there is nothing for us to set up.
              </p>
            </header>

            <SignupForm />

            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              By continuing you agree to the Terms and Privacy Policy. Linda never sends anything from your accounts
              without your approval. <b>When the trial ends we move you to the free plan — we never charge you
              automatically.</b>
            </p>
          </section>

          {/* Proof column — pure HTML, zero client JavaScript */}
          <aside className="signup-aside stack" style={{ gap: 20 }}>
            <div className="stack" style={{ gap: 6 }}>
              <h2 style={{ color: '#fff', margin: 0 }}>How it works</h2>
              <p style={{ color: 'rgba(255,255,255,0.78)', margin: 0, fontSize: 14 }}>
                Three steps, none of them a meeting.
              </p>
            </div>
            <ol className="signup-steps">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <span className="signup-step-n" aria-hidden="true">
                    {s.n}
                  </span>
                  <div>
                    <h3 style={{ color: '#fff' }}>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="signup-proof">
              <p style={{ margin: 0 }}>
                “I set it up myself over a coffee. Nobody called me, and the first draft was waiting before I
                finished it.”
              </p>
              <span>Camille D. · Operations, 40-person agency</span>
            </div>

            <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12, margin: 0 }}>
              Every tier includes all 8 agents. Free {PRICING_COMMON.trialDays}-day trial,{' '}
              {PRICING_COMMON.trialRequiresCard ? 'card required' : 'no credit card required'}.
            </p>
          </aside>
        </div>
      </main>
    </>
  );
}
