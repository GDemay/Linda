import { getDb } from '@/lib/db/index.ts';
import { signup } from '@/lib/auth/service.ts';
import { body, handle, json, sessionCookie } from '@/lib/http.ts';

export const POST = handle(async (req) => {
  const result = await signup(getDb(), await body(req));
  return json(
    { user: result.user, workspace: result.workspace },
    { status: 201, headers: { 'Set-Cookie': sessionCookie(result.token, result.expiresAt) } },
  );
});
