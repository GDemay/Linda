'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';
import { StateBar, type JourneyState } from '../components/StateBar.tsx';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramState = searchParams.get('state') as JourneyState | null;

  const [form, setForm] = useState({ email: '', password: '' });
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

  async function submit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspaces } = await api('/auth/login', { body: form });
      const ws = workspaces[0];
      if (!ws) throw new Error('this account has no workspace');
      setSuccess(true);
      setTimeout(() => {
        router.push(ws.onboardingStep === 'done' ? `/dashboard?workspace=${ws.id}` : `/onboarding?workspace=${ws.id}`);
      }, 1000);
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

  function handleClear() {
    setForm({ email: '', password: '' });
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
        pageName="Login"
      />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
        <div className="kit-frame" style={{ width: '100%', maxWidth: '980px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', minHeight: '560px' }}>
            {/* Form Side */}
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
                  <div className="l-skeleton" style={{ width: '45%', height: '32px' }} />
                  <div className="l-skeleton" style={{ width: '70%', height: '18px', marginBottom: 'var(--space-4)' }} />
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
                    <h3>Clear credentials & session?</h3>
                  </div>
                  <div className="l-card__body">
                    <p className="l-sm">
                      This will clear entered credentials and any active workspace session tokens from this device.
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
                        Cancel
                      </button>
                      <button type="button" className="l-btn l-btn--danger" onClick={handleClear}>
                        Clear session
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <h1 style={{ marginBottom: 'var(--space-2)' }}>Welcome back</h1>
                  <p style={{ marginBottom: 'var(--space-6)' }}>
                    Sign in to manage your AI agents, review approvals, and monitor workflows.
                  </p>

                  {effectiveState === 'error' && (
                    <div className="l-col" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
                      <div className="l-banner l-banner--danger">
                        <div>
                          <b>Authentication failed.</b>
                          <br />
                          {error || 'Invalid email or password. Nothing was locked — you can retry or request a password reset.'}
                        </div>
                      </div>
                      <div className="l-row" style={{ gap: 'var(--space-2)' }}>
                        <button type="button" className="l-btn l-btn--primary l-btn--sm" onClick={() => submit()}>
                          Retry
                        </button>
                        <Link href="/signup" className="l-btn l-btn--secondary l-btn--sm">
                          Create account
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
                      Signed in successfully. Resuming your workspace...
                    </div>
                  )}

                  {effectiveState === 'empty' && (
                    <div className="l-empty" style={{ padding: 'var(--space-4) 0', marginBottom: 'var(--space-4)' }}>
                      <div className="l-empty__icon">🔑</div>
                      <h3>No active session</h3>
                      <p>Sign in with your work email or continue with your single sign-on provider.</p>
                      <button
                        type="button"
                        className="l-btn l-btn--secondary l-btn--sm"
                        onClick={() => setCustomState('live')}
                      >
                        Enter credentials
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
                      <label className="l-label" htmlFor="email">
                        Work email
                      </label>
                      <input
                        className="l-input"
                        id="email"
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
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
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        autoComplete="current-password"
                        placeholder="············"
                      />
                    </div>

                    <button
                      className={`l-btn l-btn--primary l-btn--lg ${busy ? 'is-loading' : ''}`}
                      style={{ width: '100%', marginTop: 'var(--space-2)' }}
                      type="submit"
                      disabled={busy}
                    >
                      {busy ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>

                  <div className="l-row" style={{ justifyContent: 'space-between', marginTop: 'var(--space-5)' }}>
                    <button
                      type="button"
                      className="l-btn l-btn--ghost l-btn--sm"
                      onClick={() => setShowDestructive(true)}
                    >
                      Clear form
                    </button>
                    <span className="l-sm">
                      New here? <Link href="/signup">Create a workspace</Link>
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Right Side Info */}
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
                Your AI team is waiting.
              </p>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9375rem', margin: 0 }}>
                Log in to check overnight activity, approve pending sequences, and review your daily briefings.
              </p>

              <div className="l-col" style={{ gap: 'var(--space-4)' }}>
                <div className="l-row">
                  <span className="l-avatar" style={{ ['--agent' as string]: 'var(--agent-assistant)' }}>
                    C
                  </span>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.9375rem' }}>Charly · Chief of Staff</div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8125rem' }}>
                      Ready with your morning briefing
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
                      Drafting outreach sequences
                    </div>
                  </div>
                </div>

                <div className="l-row">
                  <span className="l-avatar" style={{ ['--agent' as string]: 'var(--agent-social)' }}>
                    J
                  </span>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.9375rem' }}>John · Marketing</div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8125rem' }}>
                      Prepared social calendar posts
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: 'var(--space-5)' }}>
                <p className="l-xs" style={{ color: 'rgba(255,255,255,0.6)', margin: 0 }}>
                  🔒 Zero human monitoring. Your data is encrypted and isolated to your workspace tenant.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <div className="l-skeleton" style={{ width: '200px', height: '24px', margin: '0 auto' }} />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
