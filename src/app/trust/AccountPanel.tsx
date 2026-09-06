'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client.ts';

type Me = {
  user: { id: string; email: string };
  workspaces: { id: string; name: string; role: string }[];
};

/**
 * Self-serve export and deletion, surfaced from the trust page. Both operate
 * on the real API paths (`GET /api/workspaces/:id/export` and
 * `DELETE /api/auth/me`) so the page can never drift from what the product
 * actually does.
 */
export default function AccountPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Me | { user: null }>('/auth/me')
      .then((data) => {
        // Anonymous visitors get 200 + user:null (no 401 console noise).
        if (!('user' in data) || data.user === null) {
          setState('signed-out');
          return;
        }
        setMe(data as Me);
        setState('ready');
      })
      .catch(() => setState('signed-out')); // network failure — nothing to show
  }, []);

  async function deleteAccount() {
    setError('');
    try {
      await api('/auth/me', { method: 'DELETE' });
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'deletion failed');
    }
  }

  if (state !== 'ready' || !me?.workspaces?.length) return null;
  const ws = me.workspaces[0];

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="spread">
        <h3 style={{ margin: 0 }}>Your data, right now</h3>
        <span className="pill ok">signed in as {me.user.email}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Workspace <strong>{ws.name}</strong> — no email request, no waiting period.
      </p>
      <div className="row">
        <a className="row" href={`/api/workspaces/${ws.id}/export`} download>
          <button className="primary">Download everything (JSON)</button>
        </a>
        {confirming ? (
          <button onClick={deleteAccount} style={{ color: 'var(--danger)' }}>
            Really delete my account
          </button>
        ) : (
          <button onClick={() => setConfirming(true)}>Delete my account…</button>
        )}
      </div>
      {confirming && (
        <p className="muted" style={{ margin: 0, color: 'var(--danger)' }}>
          Deletes your account and every workspace you solely own, immediately and permanently.
          Shared workspaces keep running for your co-workers. Export first if you want a copy.
        </p>
      )}
      {error && <p className="muted" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
    </div>
  );
}
