import { describe, expect, it } from 'vitest';
import { signup } from '../src/lib/auth/service.ts';
import { runTask, listWorkspaceTasks } from '../src/lib/tasks/engine.ts';
import { aggregateFunnel, workspaceFunnel } from '../src/lib/analytics/funnel.ts';
import { onboard, db } from './helpers.ts';

/**
 * Deliverable 3 of LIN-36: a landing-page trial signup becomes an active
 * agent workspace with a completed first agent task — no human in the loop
 * anywhere between signup and value.
 */
describe('self-serve path — signup to first completed agent task', () => {
  it('takes a trial signup all the way to an active workspace with agent output', async () => {
    const d = db();

    // 1. Trial signup — the only step with a human, and it is self-serve.
    const acct = await signup(d, {
      email: 'trial@acme.example',
      name: 'Trial User',
      password: 'correct-horse-battery',
      workspaceName: 'Acme Trial',
    });
    expect(acct.created).toBe(true);
    if (!acct.created) throw new Error('unreachable');
    const { workspace, token } = acct;
    expect(token).toBeTruthy();
    expect(workspace.onboardingStep).toBe('company_profile');

    // 2. Onboarding drives itself to an active workspace (no operator gate).
    const { firstRun } = await onboard(d, workspace.id, {
      goals: ['capture_leads', 'save_time'],
      agents: ['assistant', 'phone'],
      connect: ['calendar'],
    });
    expect(workspaceFunnel(d, workspace.id).isComplete).toBe(true);
    expect(firstRun).not.toBeNull();

    // 3. The very first agent task completes instantly, same workspace.
    const task = runTask(d, {
      workspaceId: workspace.id,
      agent: 'assistant',
      input: 'Anything from the team I should know about today?',
    });
    expect(task.status).toBe('completed');
    expect(task.output).toContain("Today's briefing");
    expect(listWorkspaceTasks(d, workspace.id)).toHaveLength(1);

    // 4. The funnel counts the signup as activated — the metric the team
    //    optimizes — with a time-to-first-task under a minute.
    const agg = aggregateFunnel(d);
    expect(agg.totalWorkspaces).toBe(1);
    expect(agg.completedWorkspaces).toBe(1);
    expect(agg.overallActivationRate).toBe(1);
    expect(agg.averageTimeToFirstTaskMs).toBeGreaterThanOrEqual(0);
    expect(agg.averageTimeToFirstTaskMs ?? 0).toBeLessThan(60_000);
  });
});
