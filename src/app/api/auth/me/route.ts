import { getDb } from '@/lib/db/index.ts';
import { deleteAccount } from '@/lib/accounts/data.ts';
import { listWorkspacesForUser } from '@/lib/repos/accounts.ts';
import { clearedCookie, handle, json, requireUser } from '@/lib/http.ts';

export const GET = handle(async (req) => {
  const user = requireUser(req);
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
