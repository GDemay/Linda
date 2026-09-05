import { getDb } from '@/lib/db/index.ts';
import { leadStatsSummary, leadStatsDetail } from '@/lib/analytics/leads.ts';
import { eventStats } from '@/lib/analytics/events.ts';
import { isAdmin } from '@/lib/auth/admin.ts';
import { handle, json } from '@/lib/http.ts';

/**
 * Global signup/lead metrics (LIN-59). Public response is aggregates only
 * (LIN-74): counts plus the LIN-67 funnel event totals — no per-user
 * records. `recentSignups`/`recentTasks` carry PII (emails, names,
 * workspaceIds) and are returned only when the request presents the
 * ADMIN_TOKEN via ?token= or the x-admin-token header. If ADMIN_TOKEN is
 * not configured the detail is unavailable — never open.
 */
export const GET = handle(async (req) => {
  const payload = { ...leadStatsSummary(getDb()), events: eventStats(getDb()) };
  if (!isAdmin(req)) return json(payload);
  return json({ ...payload, ...leadStatsDetail(getDb()) });
});
