import { getDb } from '@/lib/db/index.ts';
import { signup, normalizeReferralSource } from '@/lib/auth/service.ts';
import { recordEvent } from '@/lib/analytics/events.ts';
import { leadAudience } from '@/lib/analytics/leads.ts';
import { body, handle, json, publicOrigin, sessionCookie } from '@/lib/http.ts';

export const POST = handle(async (req) => {
  // LIN-111: every form submission counts as a signup start — server-side,
  // so the metric survives signup-page rebuilds (LIN-105).
  recordEvent(getDb(), 'signup_start');
  try {
    const result = await signup(getDb(), await body(req), publicOrigin(req));
    if (!result.created) {
      // Idempotent re-signup: existing account, no session (the emailed link
      // provides re-entry), same shape so the client can route either way.
      return json({ created: false, user: result.user, workspace: result.workspace }, { status: 200 });
    }
    const audience = leadAudience(result.user.email);
    const referralSource = normalizeReferralSource(result.user.referralSource ?? undefined);
    const funnel = { workspaceId: result.workspace.id, audience, referralSource };
    recordEvent(getDb(), 'signup_success', funnel);
    // Pricing funnel (LIN-111): signup_complete rides alongside signup_success
    // so pricing_view → signup_start → signup_complete is testable end to end.
    recordEvent(getDb(), 'signup_complete', funnel);
    return json(
      { created: true, user: result.user, workspace: result.workspace },
      { status: 201, headers: { 'Set-Cookie': sessionCookie(result.token, result.expiresAt) } },
    );
  } catch (err) {
    recordEvent(getDb(), 'signup_error', { error: err instanceof Error ? err.message : 'unknown' });
    throw err;
  }
});
