'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspaces } = await api('/auth/login', { body: form });
      const ws = workspaces[0];
      if (!ws) throw new Error('this account has no workspace');
      // Resume onboarding if it was never finished.
      router.push(ws.onboardingStep === 'done' ? `/dashboard?workspace=${ws.id}` : `/onboarding?workspace=${ws.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="shell narrow stack">
      <header>
        <h1>Welcome back</h1>
      </header>
      <form className="card stack" onSubmit={submit}>
        {error && <p className="error" role="alert">{error}</p>}
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            autoComplete="email"
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            autoComplete="current-password"
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      <p className="muted">
        New here? <Link href="/signup">Create a workspace</Link>
      </p>
    </main>
  );
}
