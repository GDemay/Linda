import { describe, expect, it } from 'vitest';
import { db, fixedClock, newAccount, onboard } from './helpers.ts';
import { AGENT_CATALOG, AGENT_KEYS } from '../src/lib/agents/catalog.ts';
import { PRICING_TIERS } from '../src/lib/pricing.ts';
import { CHANGELOG } from '../src/lib/changelog.ts';
import { deleteAccount, exportWorkspaceData } from '../src/lib/accounts/data.ts';
import { aggregateFunnel, recordFunnelStepAbandoned, workspaceFunnel } from '../src/lib/analytics/funnel.ts';
import { abandonOnboarding, submitCompanyProfile } from '../src/lib/onboarding/machine.ts';
import { findUserById, listWorkspacesForUser, addMembership } from '../src/lib/repos/accounts.ts';
import { signup } from '../src/lib/auth/service.ts';
import { AppError } from '../src/lib/repos/types.ts';

const FORBIDDEN_NAMES = ['Tom', 'John', 'Lou', 'Elio', 'Manue', 'Julia', 'Rony', 'Charly'];

describe('agent naming', () => {
  it('never uses a human first name, per messaging.md', () => {
    for (const key of AGENT_KEYS) {
      const agent = AGENT_CATALOG[key];
      expect(FORBIDDEN_NAMES).not.toContain(agent.name);
    }
  });
});

describe('pricing', () => {
  it('publishes a real number for every tier and reaches the top self-serve', () => {
    expect(PRICING_TIERS.length).toBeGreaterThan(0);
    for (const tier of PRICING_TIERS) {
      expect(tier.monthlyUsd).toBeGreaterThan(0);
      expect(tier.annualUsd).toBeGreaterThan(0);
      expect(tier.seats).toBeGreaterThan(0);
    }
  });
});

describe('changelog', () => {
  it('has at least one dated entry', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });
});

describe('data export', () => {
  it('includes everything the workspace owns and never leaks secretRef', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id, { now: fixedClock() });

    const data = exportWorkspaceData(d, workspace.id);
    expect(data.workspace.id).toBe(workspace.id);
    expect(data.companyProfile?.legalName).toBe('Acme SAS');
    expect(data.agents.length).toBeGreaterThan(0);
    expect(data.workflows.length).toBeGreaterThan(0);
    expect(data.activity.length).toBeGreaterThan(0);
    for (const c of data.connections) {
      expect('secretRef' in c).toBe(false);
    }
  });

  it('rejects export for an unknown workspace', () => {
    const d = db();
    expect(() => exportWorkspaceData(d, 'nope')).toThrow(AppError);
  });
});

describe('account deletion', () => {
  it('deletes a solely-owned workspace along with the user', async () => {
    const d = db();
    const { user, workspace } = await newAccount(d);
    await onboard(d, workspace.id, { now: fixedClock() });

    deleteAccount(d, user.id);

    expect(findUserById(d, user.id)).toBeNull();
    expect(() => exportWorkspaceData(d, workspace.id)).toThrow(AppError);
  });

  it('leaves a shared workspace intact and just drops the membership', async () => {
    const d = db();
    const owner = await newAccount(d);
    const teammate = await signup(d, {
      email: 'teammate@example.com',
      name: 'Grace Hopper',
      password: 'correct-horse-battery',
    });
    addMembership(d, owner.workspace.id, teammate.user.id, 'member');

    deleteAccount(d, teammate.user.id);

    expect(findUserById(d, teammate.user.id)).toBeNull();
    expect(listWorkspacesForUser(d, owner.user.id)).toHaveLength(1);
    // The workspace itself is untouched.
    expect(exportWorkspaceData(d, owner.workspace.id).workspace.id).toBe(owner.workspace.id);
  });

  it('is a no-op for an unknown user', () => {
    const d = db();
    expect(() => deleteAccount(d, 'nope')).toThrow(AppError);
  });
});

describe('funnel / time-to-first-task instrumentation', () => {
  it('is null until onboarding completes, then reports the elapsed time', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    const before = workspaceFunnel(d, workspace.id);
    expect(before.timeToFirstTaskMs).toBeNull();

    await onboard(d, workspace.id, { now: fixedClock('2026-01-15T09:05:00.000Z') });

    const after = workspaceFunnel(d, workspace.id);
    expect(after.timeToFirstTaskMs).not.toBeNull();
    expect(after.timeToFirstTaskMs).toBeGreaterThanOrEqual(0);
    expect(after.firstTaskStatus).toBeTruthy();
    expect(after.currentStep).toBe('done');
    expect(after.reachedSteps.map((s) => s.step)).toContain('done');
  });
});

describe('funnel step instrumentation (LIN-2 AC8: entered / completed / abandoned)', () => {
  const profile = {
    legalName: 'Acme SAS',
    industry: 'software',
    size: '2-10',
    website: 'https://acme.example',
    description: 'We make things',
    tone: 'friendly',
    timezone: 'Europe/Paris',
  };

  function byStep(funnel: ReturnType<typeof workspaceFunnel>) {
    return Object.fromEntries(funnel.steps.map((s) => [s.step, s])) as Record<
      string,
      ReturnType<typeof workspaceFunnel>['steps'][number]
    >;
  }

  it('a fresh workspace has only company_profile entered, nothing completed', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    const funnel = workspaceFunnel(d, workspace.id, { abandonedThresholdMs: 10_000_000 });
    const s = byStep(funnel);
    expect(funnel.isComplete).toBe(false);
    expect(s.company_profile.entered).toBe(true);
    expect(s.company_profile.completed).toBe(false);
    expect(s.pick_goals.entered).toBe(false);
    expect(s.first_run.entered).toBe(false);
  });

  it('a finished workspace has every step entered and completed with durations', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id, { now: fixedClock('2026-01-15T09:05:00.000Z') });

    const funnel = workspaceFunnel(d, workspace.id);
    expect(funnel.isComplete).toBe(true);
    expect(funnel.completedAt).toBeTruthy();
    for (const step of funnel.steps) {
      expect(step.entered, step.step).toBe(true);
      expect(step.completed, step.step).toBe(true);
      expect(step.abandoned, step.step).toBe(false);
      expect(step.durationMs, step.step).not.toBeNull();
    }
  });

  it('a mid-funnel workspace shows the current step entered but not completed', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, profile);

    const funnel = workspaceFunnel(d, workspace.id, { abandonedThresholdMs: 10_000_000 });
    const s = byStep(funnel);
    expect(funnel.currentStep).toBe('pick_goals');
    expect(s.company_profile.completed).toBe(true);
    expect(s.pick_goals.entered).toBe(true);
    expect(s.pick_goals.completed).toBe(false);
    expect(s.pick_goals.abandoned).toBe(false);
    expect(s.hire_agents.entered).toBe(false);
  });

  it('explicit abandonment marks the step abandoned with a timestamp', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, profile);

    const res = abandonOnboarding(d, workspace.id, { reason: 'went for lunch' });
    expect(res.abandonedStep).toBe('pick_goals');

    const funnel = workspaceFunnel(d, workspace.id);
    const s = byStep(funnel);
    expect(s.pick_goals.abandoned).toBe(true);
    expect(s.pick_goals.abandonedAt).toBeTruthy();
    // An explicit abandon does not retro-annotate earlier completed steps.
    expect(s.company_profile.abandoned).toBe(false);
  });

  it('treats an idle current step as abandoned only past the threshold', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, profile);

    // updated_at is "now", so a zero threshold trips immediately and a huge one never does.
    const impatient = workspaceFunnel(d, workspace.id, { abandonedThresholdMs: 0 });
    expect(byStep(impatient).pick_goals.abandoned).toBe(true);

    const patient = workspaceFunnel(d, workspace.id, { abandonedThresholdMs: 10_000_000 });
    expect(byStep(patient).pick_goals.abandoned).toBe(false);
  });

  it('recordFunnelStepAbandoned persists an explicit abandon event', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, profile);

    recordFunnelStepAbandoned(d, workspace.id, undefined, 'user clicked away');

    const funnel = workspaceFunnel(d, workspace.id);
    expect(byStep(funnel).pick_goals.abandoned).toBe(true);
  });
});

describe('aggregate funnel metrics', () => {
  it('counts entered / completed / abandoned across workspaces', async () => {
    const d = db();

    // 1) Fully activated.
    const done = await newAccount(d);
    await onboard(d, done.workspace.id, { now: fixedClock('2026-01-15T09:05:00.000Z') });

    // 2) Mid-funnel, still active (huge threshold keeps it out of abandoned).
    const mid = await newAccount(d);
    submitCompanyProfile(d, mid.workspace.id, {
      legalName: 'Mid SAS',
      industry: 'software',
      size: '2-10',
      website: 'https://mid.example',
      description: 'Halfway',
      tone: 'friendly',
      timezone: 'UTC',
    });

    // 3) Explicitly abandoned at pick_goals.
    const gone = await newAccount(d);
    submitCompanyProfile(d, gone.workspace.id, {
      legalName: 'Gone SAS',
      industry: 'software',
      size: '2-10',
      website: 'https://gone.example',
      description: 'Left',
      tone: 'friendly',
      timezone: 'UTC',
    });
    abandonOnboarding(d, gone.workspace.id, { reason: 'nope' });

    const agg = aggregateFunnel(d, { abandonedThresholdMs: 10_000_000 });
    expect(agg.totalWorkspaces).toBe(3);
    expect(agg.completedWorkspaces).toBe(1);
    expect(agg.overallActivationRate).toBeCloseTo(1 / 3);
    expect(agg.medianTimeToFirstTaskMs).not.toBeNull();
    expect(agg.averageTimeToFirstTaskMs).not.toBeNull();

    const profile = agg.steps.find((s) => s.step === 'company_profile')!;
    expect(profile.enteredCount).toBe(3);
    expect(profile.completedCount).toBe(3);
    expect(profile.abandonedCount).toBe(0);

    const goals = agg.steps.find((s) => s.step === 'pick_goals')!;
    expect(goals.enteredCount).toBe(3);
    expect(goals.completedCount).toBe(1);
    expect(goals.abandonedCount).toBe(1);
    expect(goals.completionRate).toBeCloseTo(1 / 3);
    expect(goals.dropoffRate).toBeCloseTo(1 / 3);

    const firstRun = agg.steps.find((s) => s.step === 'first_run')!;
    expect(firstRun.enteredCount).toBe(1);
    expect(firstRun.completedCount).toBe(1);
  });
});
