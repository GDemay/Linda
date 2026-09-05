import { getDb } from '@/lib/db/index.ts';
import { signup } from '@/lib/auth/service.ts';
import { recordEvent } from '@/lib/analytics/events.ts';
import { body, handle, json, publicOrigin, sessionCookie } from '@/lib/http.ts';

export const POST = handle(async (req) => {
  try {
    const result = await signup(getDb(), await body(req), publicOrigin(req));
    if (!result.created) {
      // Idempotent re-signup: existing account, no session (the emailed link
      // provides re-entry), same shape so the client can route either way.
      return json({ created: false, user: result.user, workspace: result.workspace }, { status: 200 });
    }
    recordEvent(getDb(), 'signup_success', { workspaceId: result.workspace.id });
    return json(
      { created: true, user: result.user, workspace: result.workspace },
      { status: 201, headers: { 'Set-Cookie': sessionCookie(result.token, result.expiresAt) } },
    );
  } catch (err) {
    recordEvent(getDb(), 'signup_error', { error: err instanceof Error ? err.message : 'unknown' });
    throw err;
  }
});
