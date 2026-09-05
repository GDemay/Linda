import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { PUBLIC_BEACON_EVENTS, recordEvent } from '@/lib/analytics/events.ts';
import { AppError } from '@/lib/repos/types.ts';
import { body, handle, json } from '@/lib/http.ts';

/**
 * Client beacon endpoint for page-view funnel events (LIN-67 / audit fix #6).
 * Anonymous and fire-and-forget; only the whitelisted page-view names are
 * accepted — action events (signup_success etc.) are recorded server-side
 * where the action actually happens.
 */
const beaconSchema = z.object({ name: z.enum(PUBLIC_BEACON_EVENTS) });

export const POST = handle(async (req) => {
  const parsed = beaconSchema.safeParse(await body(req));
  if (!parsed.success) throw new AppError('invalid', 'unknown event');
  recordEvent(getDb(), parsed.data.name);
  return json({ ok: true });
});
