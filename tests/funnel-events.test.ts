import { describe, expect, it } from 'vitest';
import { signup, normalizeReferralSource } from '../src/lib/auth/service.ts';
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
    const ext = await newAccount(d, { email: 'buyer@acme.example' });
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
      email: 'redditor@globex.example',
      name: 'Redditor',
      password: VALID_PASSWORD,
      workspaceName: 'Globex',
      referralSource: ' Reddit_Community ',
    });
    const lead = listLeads(d).find((l) => l.email === 'redditor@globex.example');
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
    const { user } = await newAccount(d, { email: 'verify@acme.example' });
    expect(listLeads(d).find((l) => l.id === user.id)?.emailVerified).toBe(false);
  });

  it('gives the admin digest the full external contact list', async () => {
    const d = db();
    await newAccount(d, { email: 'one@acme.example' });
    await newAccount(d, { email: 'two@globex.example' });
    await signup(d, {
      email: 'qa@linda.internal',
      name: 'QA',
      password: VALID_PASSWORD,
      workspaceName: 'QA',
    });
    const detail = leadStatsDetail(d);
    expect(detail.externalLeads.map((l) => l.email).sort()).toEqual(['one@acme.example', 'two@globex.example']);
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
