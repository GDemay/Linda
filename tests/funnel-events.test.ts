import { describe, expect, it } from 'vitest';
import { signup, normalizeReferralSource, utmReferralTag } from '../src/lib/auth/service.ts';
import { runTask } from '../src/lib/tasks/engine.ts';
import { eventStats, recordEvent } from '../src/lib/analytics/events.ts';
import { listLeads, leadStatsDetail } from '../src/lib/analytics/leads.ts';
import { db, newAccount, VALID_PASSWORD } from './helpers.ts';

/**
 * LIN-111: funnel instrumentation gaps.
 * 1. first_task_dispatched split by external/internal audience.
 * 2. Referral source persisted on the user record and surfaced on leads.
 * 3. Email reachability surfaced on leads (emailVerified) + full external
 *    contact list in the admin detail.
 * 4. Pricing funnel events: pricing_view (beacon), signup_start and
 *    signup_complete names exist and count.
 */
describe('LIN-111 funnel instrumentation', () => {
  it('splits first_task_dispatched by audience', async () => {
    const d = db();
    const ext = await newAccount(d, { email: 'buyer@acme.io' });
    const qa = await signup(d, {
      email: 'smoke@agentmail.to',
      name: 'QA Bot',
      password: VALID_PASSWORD,
      workspaceName: 'QA',
    });
    expect(qa.created).toBe(true);

    runTask(d, { workspaceId: ext.workspace.id, agent: 'assistant', input: 'Morning brief?' });
    runTask(d, { workspaceId: qa.workspace!.id, agent: 'assistant', input: 'Morning brief?' });

    const stats = eventStats(d);
    const activated = stats.find((s) => s.name === 'first_task_dispatched');
    expect(activated).toBeDefined();
    expect(activated!.count).toBe(2);
    expect(activated!.byAudience).toEqual({ external: 1, internal: 1, unknown: 0 });
  });

  it('classifies events with an unresolvable workspace as unknown, not external', async () => {
    const d = db();
    recordEvent(d, 'first_task_dispatched', { workspaceId: 'gone-away', agent: 'assistant' });
    const activated = eventStats(d).find((s) => s.name === 'first_task_dispatched');
    expect(activated!.byAudience).toEqual({ external: 0, internal: 0, unknown: 1 });
  });

  it('persists referral source on the user and surfaces it on the lead', async () => {
    const d = db();
    await signup(d, {
      email: 'redditor@globex.io',
      name: 'Redditor',
      password: VALID_PASSWORD,
      workspaceName: 'Globex',
      referralSource: ' Reddit_Community ',
    });
    const lead = listLeads(d).find((l) => l.email === 'redditor@globex.io');
    expect(lead?.referralSource).toBe('reddit_community');

    const bare = await newAccount(d);
    expect(listLeads(d).find((l) => l.id === bare.user.id)?.referralSource).toBeNull();
  });

  it('normalizes referral tags defensively', () => {
    expect(normalizeReferralSource('  Reddit Community ')).toBe('reddit_community');
    expect(normalizeReferralSource('')).toBeNull();
    expect(normalizeReferralSource(undefined)).toBeNull();
    expect(normalizeReferralSource('x'.repeat(80))).toHaveLength(64);
  });

  it('marks lead emailVerified only after a magic link is consumed', async () => {
    const d = db();
    const { user } = await newAccount(d, { email: 'verify@acme.io' });
    expect(listLeads(d).find((l) => l.id === user.id)?.emailVerified).toBe(false);
  });

  it('gives the admin digest the full external contact list', async () => {
    const d = db();
    await newAccount(d, { email: 'one@acme.io' });
    await newAccount(d, { email: 'two@globex.io' });
    await signup(d, {
      email: 'qa@linda.internal',
      name: 'QA',
      password: VALID_PASSWORD,
      workspaceName: 'QA',
    });
    const detail = leadStatsDetail(d);
    expect(detail.externalLeads.map((l) => l.email).sort()).toEqual(['one@acme.io', 'two@globex.io']);
    expect(detail.externalLeads.every((l) => !l.email.includes('agentmail'))).toBe(true);
  });

  it('records the pricing funnel event names', async () => {
    const d = db();
    recordEvent(d, 'pricing_view');
    recordEvent(d, 'signup_start');
    recordEvent(d, 'signup_complete');
    const names = eventStats(d).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['pricing_view', 'signup_start', 'signup_complete']));
  });
});

/**
 * LIN-157: utm campaign attribution. Campaign links
 * (/signup?utm_source=github&utm_medium=readme&utm_campaign=lin141) compose
 * into a `utm:source/medium/campaign` referral tag, and events carrying a
 * tag get a byCampaign breakdown in /api/stats so the LIN-141 sprint's
 * per-campaign signups are countable.
 */
describe('LIN-157 utm campaign attribution', () => {
  it('composes utm params into a normalized referral tag', () => {
    expect(
      utmReferralTag({ source: 'github', medium: 'readme', campaign: 'lin141' }),
    ).toBe('utm:github/readme/lin141');
    // Case/space noise normalizes away, same as ref= tags.
    expect(
      utmReferralTag({ source: ' Reddit ', medium: 'Community Post', campaign: 'LIN132' }),
    ).toBe('utm:reddit/community_post/lin132');
    // Missing pieces keep their place with an explicit 'unknown'.
    expect(utmReferralTag({ source: 'github', campaign: 'lin141' })).toBe('utm:github/unknown/lin141');
    // No source and no campaign → no tag; organic signups stay untagged.
    expect(utmReferralTag({ medium: 'readme' })).toBeNull();
    expect(utmReferralTag({})).toBeNull();
  });

  it('breaks tagged signup events down by campaign', () => {
    const d = db();
    const funnel = (workspaceId: string, referralSource: string | null) => ({
      workspaceId,
      audience: 'external',
      referralSource,
    });
    recordEvent(d, 'signup_success', funnel('ws-1', 'utm:github/readme/lin141'));
    recordEvent(d, 'signup_success', funnel('ws-2', 'utm:github/readme/lin141'));
    recordEvent(d, 'signup_success', funnel('ws-3', 'reddit_community'));
    // Untagged and null tags must not appear as a bucket.
    recordEvent(d, 'signup_success', funnel('ws-4', null));

    const success = eventStats(d).find((s) => s.name === 'signup_success');
    expect(success!.byCampaign).toEqual({
      'utm:github/readme/lin141': 2,
      reddit_community: 1,
    });

    // Untagged events carry no byCampaign at all.
    recordEvent(d, 'signup_start');
    const start = eventStats(d).find((s) => s.name === 'signup_start');
    expect(start!.byCampaign).toBeUndefined();
  });

  it('persists a utm-composed tag on the user like a ref= tag', async () => {
    const d = db();
    await signup(d, {
      email: 'dev@northglenn.dev',
      name: 'Dev',
      password: VALID_PASSWORD,
      workspaceName: 'Northglenn',
      referralSource: utmReferralTag({
        source: 'github',
        medium: 'readme',
        campaign: 'lin141',
      }) ?? undefined,
    });
    const lead = listLeads(d).find((l) => l.email === 'dev@northglenn.dev');
    expect(lead?.referralSource).toBe('utm:github/readme/lin141');
  });
});
