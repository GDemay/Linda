import { getDb } from '@/lib/db/index.ts';
import { listLeads } from '@/lib/analytics/leads.ts';
import { handle, json } from '@/lib/http.ts';

/**
 * Raw lead list (LIN-59), gated exactly like the legacy prototype: open
 * unless ADMIN_TOKEN is set, in which case ?token= or the x-admin-token
 * header must match.
 */
export const GET = handle(async (req) => {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (adminToken) {
    const url = new URL(req.url);
    const provided = url.searchParams.get('token') || req.headers.get('x-admin-token');
    if (provided !== adminToken) {
      return json({ error: 'Unauthorized. Pass ?token=<ADMIN_TOKEN>.' }, { status: 401 });
    }
  }
  const leads = listLeads(getDb());
  return json({ count: leads.length, leads });
});
