import { getDb } from '@/lib/db/index.ts';
import { requestMagicLink } from '@/lib/auth/service.ts';
import { body, handle, json } from '@/lib/http.ts';

export const POST = handle(async (req) => {
  const url = new URL(req.url);
  await requestMagicLink(getDb(), await body(req), `${url.protocol}//${url.host}`);
  // Same response for known and unknown addresses — no email enumeration.
  return json({ ok: true });
});
