'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/client.ts';

type Me = {
  user: { id: string } | null;
  workspaces: { id: string; onboardingStep: string }[];
};

/**
 * The workspace id for an authenticated page, from `?workspace=` when present
 * (shared deep links, sidebar nav) and otherwise resolved from the session
 * (LIN-150): a refresh or bookmark of bare `/dashboard` still carries a valid
 * `linda_session` cookie, so it must land on the dashboard — never bounce to
 * the logged-out page mid-trial or right after a checkout payment.
 *
 * Returns null while resolving; the caller should keep rendering its skeleton.
 * Only a session with no workspaces (or no session) falls back to `fallback`.
 */
export function useWorkspaceId(fallback: '/login' | '/signup' = '/login'): string | null {
  const router = useRouter();
  const queryWorkspace = useSearchParams().get('workspace');
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (queryWorkspace) return;
    let cancelled = false;
    api<Me>('/auth/me')
      .then(({ user, workspaces }) => {
        if (cancelled) return;
        const ws = workspaces[0];
        if (!user || !ws) {
          router.replace(fallback);
          return;
        }
        // Canonicalize the URL so refreshes and shared links keep the param,
        // without triggering a Next navigation (the page already renders).
        window.history.replaceState(null, '', `?workspace=${ws.id}`);
        setResolved(ws.id);
      })
      .catch(() => {
        if (!cancelled) router.replace(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [queryWorkspace, fallback, router]);

  return queryWorkspace ?? resolved;
}
