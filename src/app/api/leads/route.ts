import { getDb } from '@/lib/db/index.ts';
import { listLeads } from '@/lib/analytics/leads.ts';
import { requireAdmin } from '@/lib/auth/admin.ts';
import { handle, json } from '@/lib/http.ts';

/**
 * Raw lead list (LIN-59) — full PII, so it sits entirely behind the
 * ADMIN_TOKEN gate (LIN-74): ?token= or the x-admin-token header must
 * match. Unlike the legacy prototype, no token configured means closed
 * (503), not open.
 */
export const GET = handle(async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const leads = listLeads(getDb());
  return json({ count: leads.length, leads });
});
