'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';
import { StateBar, journeySpecEnabled, type JourneyState } from '../components/StateBar.tsx';
import { PageEvent } from '../components/PageEvent.tsx';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // LIN-118: ?state= journey override is QA-harness-only; ignore it for customers.
  const paramState = journeySpecEnabled ? (searchParams.get('state') as JourneyState | null) : null;
  const linkError = searchParams.get('error');
  // LIN-120: a token landing on /login directly (old-format or hand-edited
  // links) is forwarded through the single verification path so a dead link
  // bounces back as an explicit error instead of the silent plain form.
  const linkToken = searchParams.get('token');

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(
    linkError === 'invalid_link'
      ? 'That sign-in link has expired or was already used. Request a fresh one below.'
      : linkError === 'no_workspace'
        ? 'Your account has no workspace yet. Request a sign-in link below and one will be created for you.'
        : null,
  );
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mode, setMode] = useState<'link' | 'password'>('link');
  const [showDestructive, setShowDestructive] = useState(false);
  const [customState, setCustomState] = useState<JourneyState>(paramState || 'live');

  useEffect(() => {
    if (paramState) {
      setCustomState(paramState);
    }
  }, [paramState]);

  // LIN-120: forward ?token= through the verify route — valid links sign the
  // user in, dead ones return as ?error=invalid_link and get the banner below.
  useEffect(() => {
    if (linkToken) {
      window.location.replace(`/api/auth/magic-link/verify?token=${encodeURIComponent(linkToken)}`);
    }
  }, [linkToken]);

  /** Magic-link flow (LIN-49 fix #1): one field, one button, check your inbox. */
  async function sendLink(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/magic-link', { body: { email: form.email } });
      setSentTo(form.email);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

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

  const retry = () => (mode === 'link' ? sendLink() : submit());

  const effectiveState: JourneyState =
    customState !== 'live'
      ? customState
      : linkToken
        ? 'loading' // LIN-120: token is being verified — don't flash the form
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
                    {linkToken ? 'Checking your sign-in link…' : 'Signing you in…'}
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
                          <b>
                            {error?.startsWith('That sign-in link')
                              ? 'That sign-in link is invalid or expired.'
                              : mode === 'link'
                                ? 'Could not send the link.'
                                : 'Authentication failed.'}
                          </b>
                          <br />
                          {error || 'Invalid email or password. Nothing was locked — you can retry.'}
                        </div>
                      </div>
                      <div className="l-row" style={{ gap: 'var(--space-2)' }}>
                        <button type="button" className="l-btn l-btn--primary l-btn--sm" onClick={retry}>
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

                  {sentTo && (
                    <div className="l-banner l-banner--success" style={{ marginBottom: 'var(--space-5)' }}>
                      <div>
                        <b>Check your inbox.</b>
                        <br />
                        We sent a sign-in link to <b>{sentTo}</b>. It&apos;s single-use and expires in 15
                        minutes — request another any time.
                      </div>
                    </div>
                  )}

                  {effectiveState === 'empty' && (
                    <div className="l-empty" style={{ padding: 'var(--space-4) 0', marginBottom: 'var(--space-4)' }}>
                      <div className="l-empty__icon">🔑</div>
                      <h3>No active session</h3>
                      <p>Enter your work email and we&apos;ll send you a one-click sign-in link.</p>
                      <button
                        type="button"
                        className="l-btn l-btn--secondary l-btn--sm"
                        onClick={() => setCustomState('live')}
                      >
                        Enter credentials
                      </button>
                    </div>
                  )}

                  <form onSubmit={mode === 'link' ? sendLink : submit} className="l-col" style={{ gap: 0 }}>
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
                        // LIN-120: after a dead link, the user's next step is requesting a fresh one.
                        autoFocus={Boolean(linkError)}
                        placeholder="you@company.com"
                      />
                    </div>

                    {mode === 'password' && (
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
                    )}

                    <button
                      className={`l-btn l-btn--primary l-btn--lg ${busy ? 'is-loading' : ''}`}
                      style={{ width: '100%', marginTop: 'var(--space-2)' }}
                      type="submit"
                      disabled={busy}
                    >
                      {busy
                        ? mode === 'link'
                          ? 'Sending…'
                          : 'Signing in…'
                        : mode === 'link'
                          ? 'Send my sign-in link'
                          : 'Sign in'}
                    </button>
                  </form>

                  <div className="l-row" style={{ justifyContent: 'center', marginTop: 'var(--space-4)' }}>
                    <button
                      type="button"
                      className="l-btn l-btn--ghost l-btn--sm"
                      onClick={() => {
                        setMode(mode === 'link' ? 'password' : 'link');
                        setError(null);
                        setSentTo(null);
                      }}
                    >
                      {mode === 'link' ? 'Sign in with a password instead' : 'Email me a sign-in link instead'}
                    </button>
                  </div>

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
      <PageEvent name="login_view" />
      <LoginContent />
    </Suspense>
  );
}
