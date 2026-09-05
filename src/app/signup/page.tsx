'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';
import { StateBar, type JourneyState } from '../components/StateBar.tsx';

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramState = searchParams.get('state') as JourneyState | null;

  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showDestructive, setShowDestructive] = useState(false);
  const [customState, setCustomState] = useState<JourneyState>(paramState || 'live');

  useEffect(() => {
    if (paramState) {
      setCustomState(paramState);
    }
  }, [paramState]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api('/auth/signup', {
        body: { ...form, workspaceName: form.workspaceName || undefined },
      });
      setSuccess(true);
      setTimeout(() => {
        router.push(`/onboarding?workspace=${workspace.id}`);
      }, 1200);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const effectiveState: JourneyState =
    customState !== 'live'
      ? customState
      : busy
        ? 'loading'
        : error
          ? 'error'
          : showDestructive
            ? 'destructive-confirm'
            : success
              ? 'success'
              : 'live';

  function handleDiscard() {
    setForm({ name: '', email: '', password: '', workspaceName: '' });
    setError(null);
    setShowDestructive(false);
    setCustomState('empty');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)' }}>
      <StateBar
        currentState={effectiveState}
        onStateChange={(st) => {
          setCustomState(st);
          if (st === 'destructive-confirm') setShowDestructive(true);
          else setShowDestructive(false);
        }}
        pageName="Sign-up"
      />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
        <div className="kit-frame" style={{ width: '100%', maxWidth: '1040px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', minHeight: '640px' }}>
            {/* Form Left Side */}
            <div
              style={{
                padding: 'var(--space-12) var(--space-10)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                background: 'var(--bg-surface)',
              }}
            >
              <div className="l-row" style={{ marginBottom: 'var(--space-8)' }}>
                <span className="logo-mark">L</span>
                <b>Linda</b>
              </div>

              {effectiveState === 'loading' ? (
                <div className="l-col" style={{ gap: 'var(--space-4)' }}>
                  <div className="l-skeleton" style={{ width: '50%', height: '32px' }} />
                  <div className="l-skeleton" style={{ width: '85%', height: '18px', marginBottom: 'var(--space-4)' }} />
                  <div className="l-skeleton" style={{ width: '100%', height: '46px' }} />
                  <div className="l-skeleton" style={{ width: '100%', height: '46px' }} />
                  <div className="l-skeleton" style={{ width: '100%', height: '40px' }} />
                  <div className="l-skeleton" style={{ width: '100%', height: '40px' }} />
                  <div className="l-skeleton" style={{ width: '100%', height: '46px', marginTop: 'var(--space-4)' }} />
                  <p className="l-xs l-muted" style={{ margin: 0 }}>
                    Skeletons match the form layout so nothing jumps on load.
                  </p>
                </div>
              ) : effectiveState === 'destructive-confirm' ? (
                <div className="l-card" style={{ borderColor: 'var(--danger-500)' }}>
                  <div className="l-card__header">
                    <h3>Discard registration?</h3>
                  </div>
                  <div className="l-card__body">
                    <p className="l-sm">
                      All entered details will be cleared and your setup will be cancelled. You will need to start over from scratch.
                    </p>
                    <div className="l-row" style={{ marginTop: 'var(--space-4)' }}>
                      <span className="l-spacer" />
                      <button
                        type="button"
                        className="l-btn l-btn--ghost"
                        onClick={() => {
                          setShowDestructive(false);
                          setCustomState('live');
                        }}
                      >
                        Keep editing
                      </button>
                      <button type="button" className="l-btn l-btn--danger" onClick={handleDiscard}>
                        Discard details
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <h1 style={{ marginBottom: 'var(--space-2)' }}>Start your team</h1>
                  <p style={{ marginBottom: 'var(--space-6)' }}>
                    Free for 14 days. No card. Your first agent is working in about four minutes.
                  </p>

                  {effectiveState === 'error' && (
                    <div className="l-col" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
                      <div className="l-banner l-banner--danger">
                        <div>
                          <b>Couldn&apos;t create workspace.</b>
                          <br />
                          {error || 'An account with this email already exists, or the password did not meet requirements. Nothing was lost.'}
                        </div>
                      </div>
                      <div className="l-row" style={{ gap: 'var(--space-2)' }}>
                        <button type="button" className="l-btn l-btn--primary l-btn--sm" onClick={() => submit()}>
                          Retry
                        </button>
                        <Link href="/login" className="l-btn l-btn--secondary l-btn--sm">
                          Sign in instead
                        </Link>
                        <button
                          type="button"
                          className="l-btn l-btn--ghost l-btn--sm"
                          onClick={() => {
                            setError(null);
                            setCustomState('live');
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  {effectiveState === 'success' && (
                    <div className="l-banner l-banner--success" style={{ marginBottom: 'var(--space-5)' }}>
                      Workspace created. Charly is preparing your team — redirecting to onboarding in about 2 seconds.
                    </div>
                  )}

                  {effectiveState === 'empty' && (
                    <div className="l-empty" style={{ padding: 'var(--space-4) 0', marginBottom: 'var(--space-4)' }}>
                      <div className="l-empty__icon">✨</div>
                      <h3>Ready when you are</h3>
                      <p>Start fresh with Linda. No setup fees, no credit card required.</p>
                      <button
                        type="button"
                        className="l-btn l-btn--secondary l-btn--sm"
                        onClick={() => setCustomState('live')}
                      >
                        Fill form
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    className="l-btn l-btn--secondary l-btn--lg"
                    style={{ width: '100%', marginBottom: 'var(--space-3)' }}
                  >
                    Continue with Google
                  </button>
                  <button
                    type="button"
                    className="l-btn l-btn--secondary l-btn--lg"
                    style={{ width: '100%', marginBottom: 'var(--space-5)' }}
                  >
                    Continue with Microsoft
                  </button>

                  <div className="l-row" style={{ marginBottom: 'var(--space-5)' }}>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                    <span className="l-xs l-muted">or</span>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                  </div>

                  <form onSubmit={submit} className="l-col" style={{ gap: 0 }}>
                    <div className="l-field">
                      <label className="l-label" htmlFor="name">
                        Your name
                      </label>
                      <input
                        className="l-input"
                        id="name"
                        required
                        value={form.name}
                        onChange={set('name')}
                        autoComplete="name"
                        placeholder="Ada Lovelace"
                      />
                    </div>

                    <div className="l-field">
                      <label className="l-label" htmlFor="email">
                        Work email
                      </label>
                      <input
                        className="l-input"
                        id="email"
                        type="email"
                        required
                        value={form.email}
                        onChange={set('email')}
                        autoComplete="email"
                        placeholder="you@company.com"
                      />
                    </div>

                    <div className="l-field">
                      <label className="l-label" htmlFor="password">
                        Password
                      </label>
                      <input
                        className="l-input"
                        id="password"
                        type="password"
                        required
                        minLength={10}
                        value={form.password}
                        onChange={set('password')}
                        autoComplete="new-password"
                        placeholder="············"
                      />
                      <span className="l-help">At least 10 characters.</span>
                    </div>

                    <div className="l-field">
                      <label className="l-label" htmlFor="workspaceName">
                        Company name (optional)
                      </label>
                      <input
                        className="l-input"
                        id="workspaceName"
                        value={form.workspaceName}
                        onChange={set('workspaceName')}
                        autoComplete="organization"
                        placeholder="Acme Studio"
                      />
                    </div>

                    <button
                      className={`l-btn l-btn--primary l-btn--lg ${busy ? 'is-loading' : ''}`}
                      style={{ width: '100%', marginTop: 'var(--space-2)' }}
                      type="submit"
                      disabled={busy}
                    >
                      {busy ? 'Creating…' : 'Create account'}
                    </button>
                  </form>

                  <div className="l-row" style={{ justifyContent: 'space-between', marginTop: 'var(--space-4)' }}>
                    <button
                      type="button"
                      className="l-btn l-btn--ghost l-btn--sm"
                      onClick={() => setShowDestructive(true)}
                    >
                      Clear form
                    </button>
                    <span className="l-sm">
                      Already have an account? <Link href="/login">Sign in</Link>
                    </span>
                  </div>

                  <p className="l-xs l-muted" style={{ marginTop: 'var(--space-4)' }}>
                    By continuing you agree to the Terms and Privacy Policy. Linda never sends anything from your accounts
                    without your approval.{' '}
                    <b>When the trial ends we move you to the free plan — we do not charge you automatically.</b>
                  </p>
                </>
              )}
            </div>

            {/* Proof Right Side */}
            <div
              style={{
                padding: 'var(--space-12) var(--space-10)',
                background: 'var(--linda-900)',
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 'var(--space-6)',
              }}
            >
              <p
                style={{
                  font: 'var(--text-h2)',
                  fontWeight: 600,
                  letterSpacing: 'var(--tracking-tight)',
                  color: '#fff',
                  margin: 0,
                }}
              >
                Eight specialists. One team. Working while you sleep.
              </p>
              <div className="l-col" style={{ gap: 'var(--space-4)' }}>
                <div className="l-row">
                  <span className="l-avatar" style={{ ['--agent' as string]: 'var(--agent-assistant)' }}>
                    C
                  </span>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.9375rem' }}>
                      Charly · Chief of staff
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8125rem' }}>
                      Routes your work and reports back every morning
                    </div>
                  </div>
                </div>
                <div className="l-row">
                  <span className="l-avatar" style={{ ['--agent' as string]: 'var(--agent-sales)' }}>
                    E
                  </span>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.9375rem' }}>Elio · Sales</div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8125rem' }}>
                      Finds leads and runs outreach sequences
                    </div>
                  </div>
                </div>
                <div className="l-row">
                  <span className="l-avatar" style={{ ['--agent' as string]: 'var(--agent-finance)' }}>
                    M
                  </span>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.9375rem' }}>Manue · Finance</div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8125rem' }}>
                      Reconciles invoices, forecasts cash
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: 'var(--space-5)' }}>
                <p style={{ color: 'rgba(255,255,255,0.86)', margin: '0 0 var(--space-3)', fontSize: '0.9375rem' }}>
                  “I set it up myself over a coffee. Nobody called me, and the first draft was waiting before I finished it.”
                </p>
                <div className="l-row">
                  <span
                    className="l-avatar l-avatar--sm"
                    style={{ ['--agent' as string]: 'var(--ink-500)' }}
                  >
                    CD
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8125rem' }}>
                    Camille D. · Operations, 40-person agency
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <div className="l-skeleton" style={{ width: '200px', height: '24px', margin: '0 auto' }} />
        </div>
      }
    >
      <SignupContent />
    </Suspense>
  );
}
