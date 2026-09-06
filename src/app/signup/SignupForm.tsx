'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';

/**
 * Interactive half of the signup conversion page (LIN-105).
 *
 * Deliberately free of `useSearchParams`: that hook forces the whole route
 * into a Suspense fallback during SSR, which is why the old page rendered
 * empty server-side. All query-param handling lives in plain effects or is
 * dropped, so this component's initial markup lands fully in the HTML.
 */

type FieldErrors = { name?: string; email?: string; password?: string };
type Touched = { name?: boolean; email?: boolean; password?: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(form: { name: string; email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name.trim()) errors.name = 'Please tell us your name — the agents address you by it.';
  if (!form.email.trim()) errors.email = 'We need an email address to send your sign-in link.';
  else if (!EMAIL_RE.test(form.email.trim())) errors.email = 'That does not look like a valid email address.';
  if (form.password && form.password.length < 10)
    errors.password = 'Passwords need at least 10 characters — or leave this blank to sign in by email link.';
  return errors;
}

export function SignupForm({ referralSource = null }: { referralSource?: string | null }) {
  const router = useRouter();

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [touched, setTouched] = useState<Touched>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [existingEmail, setExistingEmail] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const next = { ...form, [k]: e.target.value };
      setForm(next);
      // Re-validate a field the visitor has already seen an error for, so
      // the message clears as soon as they fix it — not on next submit.
      if (touched[k]) setErrors(validate(next));
    };

  const blur = (k: keyof typeof form) => (): void => {
    setTouched((t) => ({ ...t, [k]: true }));
    setErrors(validate(form));
  };

  const fieldError = (k: keyof FieldErrors) => (touched[k] ? errors[k] : undefined);

  async function submit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const found = validate(form);
    setTouched({ name: true, email: true, password: true });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const data = await api<{ created: boolean; workspace: { id: string } }>('/auth/signup', {
        // Password is optional: blank means "sign in by email link" (LIN-67 fix #5).
        // referralSource comes from /signup?ref=… and is persisted on the user (LIN-111).
        body: {
          ...form,
          email: form.email.trim(),
          name: form.name.trim(),
          password: form.password || undefined,
          referralSource: referralSource || undefined,
        },
      });
      if (!data.created) {
        // Idempotent re-signup: the account exists, a sign-in link is on its way.
        setExistingEmail(form.email.trim());
        setBusy(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        router.push(`/onboarding?workspace=${data.workspace.id}`);
      }, 1600);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      {existingEmail && (
        <div className="l-banner l-banner--warning" style={{ marginBottom: 'var(--space-5)' }} role="status">
          <div>
            <b>You already have a workspace.</b>
            <br />
            We emailed a fresh sign-in link to <b>{existingEmail}</b> — open it to jump straight back in.
          </div>
          <div className="l-row" style={{ marginTop: 'var(--space-3)' }}>
            <Link href="/login" className="l-btn l-btn--secondary l-btn--sm">
              Resend the link
            </Link>
            <button
              type="button"
              className="l-btn l-btn--ghost l-btn--sm"
              onClick={() => setExistingEmail(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && !success && (
        <div className="l-banner l-banner--danger" style={{ marginBottom: 'var(--space-5)' }} role="alert">
          <div>
            <b>Couldn&apos;t create your workspace.</b>
            <br />
            {error || 'An account with this email may already exist. Nothing you typed was lost.'}
          </div>
          <div className="l-row" style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" className="l-btn l-btn--primary l-btn--sm" onClick={() => submit()}>
              Try again
            </button>
            <Link href="/login" className="l-btn l-btn--secondary l-btn--sm">
              Sign in instead
            </Link>
          </div>
        </div>
      )}

      {success && (
        <div className="l-banner l-banner--success" style={{ marginBottom: 'var(--space-5)' }} role="status">
          <b>Workspace created — check your inbox.</b> We just emailed a sign-in link to{' '}
          <b>{form.email.trim()}</b>. It is your way back in without a password. Taking you to onboarding…
        </div>
      )}

      <form onSubmit={submit} className="l-col" noValidate style={{ gap: 0 }}>
        <div className="l-field">
          <label className="l-label" htmlFor="name">
            Your name
          </label>
          <input
            className={`l-input ${fieldError('name') ? 'is-invalid' : ''}`}
            id="name"
            required
            value={form.name}
            onChange={set('name')}
            onBlur={blur('name')}
            autoComplete="name"
            aria-invalid={fieldError('name') ? true : undefined}
            aria-describedby={fieldError('name') ? 'name-error' : undefined}
            placeholder="Ada Lovelace"
          />
          {fieldError('name') && (
            <span className="l-help" id="name-error" style={{ color: 'var(--danger-500)' }}>
              {fieldError('name')}
            </span>
          )}
        </div>

        <div className="l-field">
          <label className="l-label" htmlFor="email">
            Work email
          </label>
          <input
            className={`l-input ${fieldError('email') ? 'is-invalid' : ''}`}
            id="email"
            type="email"
            required
            value={form.email}
            onChange={set('email')}
            onBlur={blur('email')}
            autoComplete="email"
            aria-invalid={fieldError('email') ? true : undefined}
            aria-describedby={fieldError('email') ? 'email-error' : 'email-help'}
            placeholder="you@company.com"
          />
          <span className="l-help" id="email-help">
            {fieldError('email') ? (
              <span style={{ color: 'var(--danger-500)' }}>{fieldError('email')}</span>
            ) : (
              'Your workspace is named after your email’s domain — you can rename it later.'
            )}
          </span>
        </div>

        <div className="l-field">
          <label className="l-label" htmlFor="password">
            Password <span className="l-xs l-muted">(optional)</span>
          </label>
          <input
            className={`l-input ${fieldError('password') ? 'is-invalid' : ''}`}
            id="password"
            type="password"
            minLength={10}
            value={form.password}
            onChange={set('password')}
            onBlur={blur('password')}
            autoComplete="new-password"
            aria-invalid={fieldError('password') ? true : undefined}
            aria-describedby={fieldError('password') ? 'password-error' : 'password-help'}
            placeholder="············"
          />
          <span className="l-help" id="password-help">
            {fieldError('password') ? (
              <span style={{ color: 'var(--danger-500)' }}>{fieldError('password')}</span>
            ) : (
              'At least 10 characters — or leave it blank and we’ll email you a sign-in link every time.'
            )}
          </span>
        </div>

        <button
          className={`l-btn l-btn--primary l-btn--lg ${busy ? 'is-loading' : ''}`}
          style={{ width: '100%', marginTop: 'var(--space-2)' }}
          type="submit"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Creating your workspace…' : 'Start my free 14-day trial →'}
        </button>
        <div className="l-row" style={{ justifyContent: 'center', marginTop: 'var(--space-3)' }}>
          <span className="l-xs l-muted">
            ✓ No credit card &nbsp;·&nbsp; ✓ 14-day trial &nbsp;·&nbsp; ✓ All 8 agents included
          </span>
        </div>
        <p className="l-sm" style={{ marginTop: 'var(--space-3)', textAlign: 'center' }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </>
  );
}
