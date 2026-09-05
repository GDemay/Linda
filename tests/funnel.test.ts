import { describe, expect, it } from 'vitest';
import { aggregateFunnel, workspaceFunnel, recordFunnelStepAbandoned } from '../src/lib/analytics/funnel.ts';
import { submitCompanyProfile, submitGoals } from '../src/lib/onboarding/machine.ts';
import { db, fixedClock, newAccount, onboard } from './helpers.ts';

function step(funnel: ReturnType<typeof workspaceFunnel>, step: string) {
  const metric = funnel.steps.find((s) => s.step === step);
  if (!metric) throw new Error(`missing funnel step ${step}`);
  return metric;
}

describe('funnel instrumentation per step (LIN-2 AC8 / LIN-14)', () => {
  it('marks every step entered and completed once onboarding finishes', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id, { now: fixedClock('2026-01-15T09:05:00.000Z') });

    const funnel = workspaceFunnel(d, workspace.id);
    expect(funnel.isComplete).toBe(true);
    for (const s of funnel.steps) {
      expect(s.entered, `${s.step} entered`).toBe(true);
      expect(s.completed, `${s.step} completed`).toBe(true);
      expect(s.abandoned, `${s.step} abandoned`).toBe(false);
      expect(s.enteredAt).toBeTruthy();
      expect(s.completedAt).toBeTruthy();
      expect(s.durationMs).not.toBeNull();
    }
    expect(funnel.timeToFirstTaskMs).not.toBeNull();
  });

  it('reports a mid-funnel workspace: earlier steps completed, later steps never entered', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, {
      legalName: 'Acme SAS',
      industry: 'software',
      size: '2-10',
      website: 'https://acme.example',
      description: 'We make things',
      tone: 'friendly',
      timezone: 'Europe/Paris',
    });

    const funnel = workspaceFunnel(d, workspace.id, { abandonedThresholdMs: 60 * 60 * 1000 });
    expect(funnel.isComplete).toBe(false);
    expect(funnel.currentStep).toBe('pick_goals');

    expect(step(funnel, 'company_profile').completed).toBe(true);
    const goals = step(funnel, 'pick_goals');
    expect(goals.entered).toBe(true);
    expect(goals.completed).toBe(false);
    // Freshly idle: below the threshold, so not abandoned yet.
    expect(goals.abandoned).toBe(false);

    for (const name of ['hire_agents', 'connect_tools', 'first_run']) {
      const s = step(funnel, name);
      expect(s.entered, `${name} entered`).toBe(false);
      expect(s.completed).toBe(false);
    }
  });

  it('treats the current step as abandoned once idle past the threshold', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    // A huge threshold keeps it "not abandoned"; zero forces abandonment now.
    expect(step(workspaceFunnel(d, workspace.id, { abandonedThresholdMs: 60 * 60 * 1000 }), 'company_profile').abandoned).toBe(false);
    expect(step(workspaceFunnel(d, workspace.id, { abandonedThresholdMs: 0 }), 'company_profile').abandoned).toBe(true);
  });

  it('records an explicit abandonment with reason and reflects it in the funnel', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, {
      legalName: 'Acme SAS',
      industry: 'software',
      size: '2-10',
      website: 'https://acme.example',
      description: 'We make things',
      tone: 'friendly',
      timezone: 'Europe/Paris',
    });
    submitGoals(d, workspace.id, { goals: ['capture_leads'] });

    const res = recordFunnelStepAbandoned(d, workspace.id, undefined, 'too complicated');
    expect(res.step).toBe('hire_agents');

    const funnel = workspaceFunnel(d, workspace.id);
    const hire = step(funnel, 'hire_agents');
    expect(hire.abandoned).toBe(true);
    expect(hire.abandonedAt).toBeTruthy();
    expect(hire.completed).toBe(false);
    // The explicit abandonment does not erase completed history.
    expect(step(funnel, 'company_profile').completed).toBe(true);
    expect(step(funnel, 'pick_goals').completed).toBe(true);
  });
});

describe('aggregate funnel across workspaces', () => {
  it('counts entered/completed/abandoned per step and overall activation', async () => {
    const d = db();

    // Workspace 1: full activation.
    const done = await newAccount(d);
    await onboard(d, done.workspace.id, { now: fixedClock('2026-01-15T09:05:00.000Z') });

    // Workspace 2: profile saved, then explicitly abandons at pick_goals.
    const abandoned = await newAccount(d);
    submitCompanyProfile(d, abandoned.workspace.id, {
      legalName: 'Beta LLC',
      industry: 'retail',
      size: '11-50',
      website: 'https://beta.example',
      description: 'Also things',
      tone: 'formal',
      timezone: 'UTC',
    });
    recordFunnelStepAbandoned(d, abandoned.workspace.id, 'pick_goals', 'lost interest');

    // Workspace 3: signed up, never did anything, idle past the threshold.
    await newAccount(d);

    const agg = aggregateFunnel(d, { abandonedThresholdMs: 0 });
    expect(agg.totalWorkspaces).toBe(3);
    expect(agg.completedWorkspaces).toBe(1);
    expect(agg.overallActivationRate).toBeCloseTo(1 / 3);
    expect(agg.medianTimeToFirstTaskMs).not.toBeNull();
    expect(agg.averageTimeToFirstTaskMs).not.toBeNull();

    const profile = agg.steps.find((s) => s.step === 'company_profile')!;
    expect(profile.enteredCount).toBe(3);
    expect(profile.completedCount).toBe(2);
    expect(profile.abandonedCount).toBe(1);

    const goals = agg.steps.find((s) => s.step === 'pick_goals')!;
    expect(goals.enteredCount).toBe(2);
    expect(goals.completedCount).toBe(1);

    const firstRun = agg.steps.find((s) => s.step === 'first_run')!;
    expect(firstRun.enteredCount).toBe(1);
    expect(firstRun.completedCount).toBe(1);
    expect(firstRun.completionRate).toBe(1);
  });
});
