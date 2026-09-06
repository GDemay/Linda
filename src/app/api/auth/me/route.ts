import { getDb } from '@/lib/db/index.ts';
import { deleteAccount } from '@/lib/accounts/data.ts';
import { listWorkspacesForUser } from '@/lib/repos/accounts.ts';
import { clearedCookie, handle, json, optionalUser, requireUser } from '@/lib/http.ts';

export const GET = handle(async (req) => {
  const user = optionalUser(req);
  // Anonymous callers get 200 + null rather than 401: this endpoint is probed
  // by the public trust page, and a 401 for every anonymous visitor shows up
  // as a console error in their browser (LIN-94 UI-quality gate).
  if (!user) return json({ user: null, workspaces: [] });
  return json({ user, workspaces: listWorkspacesForUser(getDb(), user.id) });
});

/**
 * Self-service account deletion. Workspaces this user solely owns are
 * deleted with them; shared workspaces just lose this membership.
 */
export const DELETE = handle(async (req) => {
  const user = requireUser(req);
  deleteAccount(getDb(), user.id);
  return json({ ok: true }, { headers: { 'Set-Cookie': clearedCookie() } });
});
