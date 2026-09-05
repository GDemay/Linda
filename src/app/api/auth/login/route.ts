import { getDb } from '@/lib/db/index.ts';
import { login } from '@/lib/auth/service.ts';
import { body, handle, json, sessionCookie } from '@/lib/http.ts';

export const POST = handle(async (req) => {
  const result = await login(getDb(), await body(req));
  return json(
    { user: result.user, workspaces: result.workspaces },
    { headers: { 'Set-Cookie': sessionCookie(result.token, result.expiresAt) } },
  );
});
