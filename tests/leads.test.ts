import { describe, expect, it } from 'vitest';
import { signup } from '../src/lib/auth/service.ts';
import { runTask } from '../src/lib/tasks/engine.ts';
import { createWorkspace, addMembership } from '../src/lib/repos/accounts.ts';
import { listLeads, leadStatsSummary, leadStatsDetail, leadAudience, isQaTestEmail } from '../src/lib/analytics/leads.ts';
import { db, newAccount, VALID_PASSWORD } from './helpers.ts';

/**
 * LIN-59: /api/stats and /api/leads parity with the legacy prototype —
 * leads are deduped by email and split into external vs internal/QA so
 * repeat signups and smoke tests never inflate the sales funnel.
 */
describe('lead visibility — dedupe and audience split', () => {
  it('classifies internal QA and founder accounts as internal', () => {
    expect(leadAudience('qa@agentmail.to')).toBe('internal');
    expect(leadAudience('qa-smoke-ceo@linda.internal')).toBe('internal');
    expect(leadAudience('audit+lin49@example.com')).toBe('internal');
    // LIN-147: the reserved .example TLD and example.com are QA-only domains.
    expect(leadAudience('founder@ACME.example')).toBe('internal');
    expect(leadAudience('qa-lin104-a@linda-qa-test.example')).toBe('internal');
    expect(leadAudience('lin131-prod-verify@example.com')).toBe('internal');
    expect(leadAudience('lin53-verify-x@example.com')).toBe('internal');
    expect(leadAudience('ceo-probe+ping@agentmail.to')).toBe('internal');
    // Real humans on real domains stay external.
    expect(leadAudience('sarah.connor@skylineops.io')).toBe('external');
    expect(leadAudience('alex.rivera@growthagency.io')).toBe('external');
  });

  it('splits QA/automation addresses from humans (isQaTestEmail, LIN-147)', () => {
    expect(isQaTestEmail('lin131-prod-verify@example.com')).toBe(true);
    expect(isQaTestEmail('qa-lin104-b@linda-qa-test.example')).toBe(true);
    expect(isQaTestEmail('audit+lin49@example.com')).toBe(true);
    expect(isQaTestEmail('guillaumedemay@hotmail.fr')).toBe(false);
    expect(isQaTestEmail('sarah.connor@skylineops.io')).toBe(false);
  });

  it('treats LINDA_INTERNAL_EMAILS entries as internal (normalized)', () => {
    const prev = process.env.LINDA_INTERNAL_EMAILS;
    process.env.LINDA_INTERNAL_EMAILS = 'Founder-Personal@Personal-Mail.com,, second@ex.co';
    try {
      expect(leadAudience('founder-personal@personal-mail.com')).toBe('internal');
      expect(leadAudience('second@EX.CO')).toBe('internal');
      expect(leadAudience('other@personal-mail.com')).toBe('external');
    } finally {
      if (prev === undefined) delete process.env.LINDA_INTERNAL_EMAILS;
      else process.env.LINDA_INTERNAL_EMAILS = prev;
    }
  });

  it('counts external leads only in uniqueExternalSignups and keeps internal out', async () => {
    const d = db();
    await newAccount(d, { email: 'founder@acme.io' });
    await newAccount(d, { email: 'ceo@globex.io' });
    await signup(d, {
      email: 'qa@agentmail.to',
      name: 'QA Bot',
      password: VALID_PASSWORD,
      workspaceName: 'QA',
    });
    await signup(d, {
      email: 'audit+lin49@example.com',
      name: 'Audit',
      password: VALID_PASSWORD,
      workspaceName: 'Audit',
    });

    const stats = leadStatsSummary(d);
    expect(stats.totalSignups).toBe(4);
    expect(stats.uniqueExternalSignups).toBe(2);
    expect(stats.internalSignups).toBe(2);
    // LIN-147: both internal signups here are QA/automation addresses.
    expect(stats.qaTestSignups).toBe(2);
    // Fresh signups are all on the trial plan.
    expect(stats.activeTrials).toBe(4);
    expect(stats.externalActiveTrials).toBe(2);
    expect(stats.ok).toBe(true);
    // Public shape must carry no per-user records (LIN-74).
    expect(Object.keys(stats)).not.toContain('recentSignups');
  });

  it('dedupes by email: a user with a second workspace counts once, earliest workspace kept', async () => {
    const d = db();
    const { user, workspace } = await newAccount(d, { email: 'dup@acme.io' });
    const second = createWorkspace(d, { name: 'Dup Second', slug: 'dup-second' });
    addMembership(d, second.id, user.id, 'owner');

    const leads = listLeads(d);
    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe('dup@acme.io');
    expect(leads[0].workspaceId).toBe(workspace.id);
    expect(leadStatsSummary(d).totalSignups).toBe(1);
  });

  it('reports task counters and recent items for the sales digest', async () => {
    const d = db();
    const { workspace } = await newAccount(d, { email: 'tasks@acme.io' });
    runTask(d, {
      workspaceId: workspace.id,
      agent: 'assistant',
      input: 'Anything from the team I should know about today?',
    });
    runTask(d, {
      workspaceId: workspace.id,
      agent: 'assistant',
      input: 'Draft a follow-up for the pending lead',
    });

    const stats = leadStatsSummary(d);
    expect(stats.totalTasksExecuted).toBe(2);
    expect(stats.completedTasks).toBe(2);
    expect(stats.totalRequests).toBe(2);
    const detail = leadStatsDetail(d);
    expect(detail.recentTasks).toHaveLength(2);
    expect(detail.recentSignups.map((l) => l.email)).toEqual(['tasks@acme.io']);
  });

  it('orders recentSignups newest-first', async () => {
    const d = db();
    await newAccount(d, { email: 'first@acme.io' });
    await newAccount(d, { email: 'second@acme.io' });
    const leads = listLeads(d);
    expect(leads.map((l) => l.email)).toEqual(['second@acme.io', 'first@acme.io']);
  });
});
