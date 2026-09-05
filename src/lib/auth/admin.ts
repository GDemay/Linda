import { json } from '../http.ts';

/**
 * ADMIN_TOKEN gate (LIN-74). Endpoints that return per-user records
 * (emails, names, workspaceIds) must never serve them without a matching
 * token. When ADMIN_TOKEN is not configured the gate fails closed — no
 * open-by-default bypass — so detail is simply unavailable until an
 * operator sets the variable.
 */

/** Reads the admin token from ?token= or the x-admin-token header. */
export function providedAdminToken(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get('token') || req.headers.get('x-admin-token');
}

/** True only when ADMIN_TOKEN is configured and the request carries it. */
export function isAdmin(req: Request): boolean {
  const expected = process.env.ADMIN_TOKEN || '';
  return Boolean(expected) && providedAdminToken(req) === expected;
}

/**
 * Strict gate for endpoints whose entire body is sensitive (e.g. /api/leads).
 * Returns a denial Response, or null when the request may proceed.
 */
export function requireAdmin(req: Request): Response | null {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) {
    return json({ error: 'Admin endpoint disabled: set ADMIN_TOKEN to enable it.' }, { status: 503 });
  }
  if (providedAdminToken(req) !== expected) {
    return json(
      { error: 'Unauthorized. Pass ?token=<ADMIN_TOKEN> or the x-admin-token header.' },
      { status: 401 },
    );
  }
  return null;
}
