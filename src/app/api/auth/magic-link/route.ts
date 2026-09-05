import { getDb } from '@/lib/db/index.ts';
import { requestMagicLink } from '@/lib/auth/service.ts';
import { body, handle, json, publicOrigin } from '@/lib/http.ts';

export const POST = handle(async (req) => {
  await requestMagicLink(getDb(), await body(req), publicOrigin(req));
  // Same response for known and unknown addresses — no email enumeration.
  return json({ ok: true });
});
