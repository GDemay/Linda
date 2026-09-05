import { getDb } from '@/lib/db/index.ts';
import { logout } from '@/lib/auth/service.ts';
import { clearedCookie, handle, json, tokenFrom } from '@/lib/http.ts';

export const POST = handle(async (req) => {
  const token = tokenFrom(req);
  if (token) logout(getDb(), token);
  return json({ ok: true }, { headers: { 'Set-Cookie': clearedCookie() } });
});
