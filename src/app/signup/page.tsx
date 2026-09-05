'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api('/auth/signup', {
        body: { ...form, workspaceName: form.workspaceName || undefined },
      });
      // Straight into onboarding — there is no approval step to wait on.
      router.push(`/onboarding?workspace=${workspace.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="shell narrow stack">
      <header>
        <h1>Create your workspace</h1>
        <p className="muted">You&apos;ll be up and running before anyone could have called you back.</p>
      </header>

      <form className="card stack" onSubmit={submit}>
        {error && <p className="error" role="alert">{error}</p>}
        <div>
          <label htmlFor="name">Your name</label>
          <input id="name" required value={form.name} onChange={set('name')} autoComplete="name" />
        </div>
        <div>
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={10}
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
          />
          <p className="muted" style={{ marginTop: 6 }}>At least 10 characters.</p>
        </div>
        <div>
          <label htmlFor="workspaceName">Company name (optional)</label>
          <input id="workspaceName" value={form.workspaceName} onChange={set('workspaceName')} autoComplete="organization" />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>

      <p className="muted">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
