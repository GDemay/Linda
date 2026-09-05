import { getDb } from '@/lib/db/index.ts';
import { loginWithMagicLink } from '@/lib/auth/service.ts';
import { handle, sessionCookie } from '@/lib/http.ts';

/**
 * Email-link entry point (LIN-49 fix #1). The email button lands here; a
 * valid token opens a session and forwards into the workspace, everything
 * else bounces to /login with an error flag.
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get('token');
  const redirect = (path: string, headers?: Record<string, string>) =>
    new Response(null, { status: 302, headers: { Location: path, ...headers } });

  if (!raw) return redirect('/login?error=invalid_link');
  const result = loginWithMagicLink(getDb(), raw);
  if (!result) return redirect('/login?error=invalid_link');

  const ws = result.workspaces[0];
  const next = ws
    ? ws.onboardingStep === 'done'
      ? `/dashboard?workspace=${ws.id}`
      : `/onboarding?workspace=${ws.id}`
    : '/login?error=no_workspace';
  return redirect(next, { 'Set-Cookie': sessionCookie(result.token, result.expiresAt) });
});
