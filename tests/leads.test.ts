import { describe, expect, it } from 'vitest';
import { signup } from '../src/lib/auth/service.ts';
import { runTask } from '../src/lib/tasks/engine.ts';
import { createWorkspace, addMembership } from '../src/lib/repos/accounts.ts';
import { listLeads, leadStats, leadAudience } from '../src/lib/analytics/leads.ts';
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
    expect(leadAudience('founder@redacted.example')).toBe('internal');
    expect(leadAudience('founder@ACME.example')).toBe('external');
  });

  it('counts external leads only in uniqueExternalSignups and keeps internal out', async () => {
    const d = db();
    await newAccount(d, { email: 'founder@acme.example' });
    await newAccount(d, { email: 'ceo@globex.example' });
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

    const stats = leadStats(d);
    expect(stats.totalSignups).toBe(4);
    expect(stats.uniqueExternalSignups).toBe(2);
    expect(stats.internalSignups).toBe(2);
    // Fresh signups are all on the trial plan.
    expect(stats.activeTrials).toBe(4);
    expect(stats.externalActiveTrials).toBe(2);
    expect(stats.ok).toBe(true);
  });

  it('dedupes by email: a user with a second workspace counts once, earliest workspace kept', async () => {
    const d = db();
    const { user, workspace } = await newAccount(d, { email: 'dup@acme.example' });
    const second = createWorkspace(d, { name: 'Dup Second', slug: 'dup-second' });
    addMembership(d, second.id, user.id, 'owner');

    const leads = listLeads(d);
    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe('dup@acme.example');
    expect(leads[0].workspaceId).toBe(workspace.id);
    expect(leadStats(d).totalSignups).toBe(1);
  });

  it('reports task counters and recent items for the sales digest', async () => {
    const d = db();
    const { workspace } = await newAccount(d, { email: 'tasks@acme.example' });
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

    const stats = leadStats(d);
    expect(stats.totalTasksExecuted).toBe(2);
    expect(stats.completedTasks).toBe(2);
    expect(stats.totalRequests).toBe(2);
    expect(stats.recentTasks).toHaveLength(2);
    expect(stats.recentSignups.map((l) => l.email)).toEqual(['tasks@acme.example']);
  });

  it('orders recentSignups newest-first', async () => {
    const d = db();
    await newAccount(d, { email: 'first@acme.example' });
    await newAccount(d, { email: 'second@acme.example' });
    const leads = listLeads(d);
    expect(leads.map((l) => l.email)).toEqual(['second@acme.example', 'first@acme.example']);
  });
});
