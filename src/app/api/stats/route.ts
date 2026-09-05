import { getDb } from '@/lib/db/index.ts';
import { leadStats } from '@/lib/analytics/leads.ts';
import { eventStats } from '@/lib/analytics/events.ts';
import { handle, json } from '@/lib/http.ts';

/**
 * Global signup/lead metrics (LIN-59). Unauthenticated by design: the sales
 * org polls this endpoint to detect and attribute new signups, matching the
 * legacy prototype's response shape. Contains no secrets — counts and the
 * five most recent leads/tasks only. `events` carries the LIN-67 funnel
 * beacon counts (landing_view → signup_view → signup_success → first task).
 */
export const GET = handle(async () => {
  return json({ ...leadStats(getDb()), events: eventStats(getDb()) });
});
