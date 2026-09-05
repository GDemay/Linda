import { describe, expect, it } from 'vitest';
import { db, fixedClock, newAccount, onboard } from './helpers.ts';
import {
  ONBOARDING_STEPS,
  completeOnboarding,
  getOnboardingStatus,
  hireAgents,
  pickFirstRunWorkflow,
  requiredProvidersFor,
  submitCompanyProfile,
  submitConnections,
  submitGoals,
} from '../src/lib/onboarding/machine.ts';
import { listWorkspaceAgents, findCompanyProfile } from '../src/lib/repos/accounts.ts';
import { listActivity, listRuns, listWorkflows } from '../src/lib/repos/workflows.ts';
import { recommendAgents } from '../src/lib/agents/catalog.ts';

const PROFILE = {
  legalName: 'Acme SAS',
  industry: 'software',
  size: '2-10',
  website: 'https://acme.example',
  description: 'We make things',
  tone: 'friendly',
  timezone: 'Europe/Paris',
};

describe('onboarding — no human in the loop', () => {
  it('takes a brand-new signup all the way to a live workspace', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(getOnboardingStatus(d, workspace.id).step).toBe('company_profile');

    const result = await onboard(d, workspace.id, { now: fixedClock() });

    // Live, with agents, workflows, and a real completed run — no operator involved.
    expect(result.workspace.onboardingStep).toBe('done');
    expect(result.workspace.onboardingDoneAt).toBeTruthy();
    expect(result.firstRun?.status).toBe('succeeded');

    const status = getOnboardingStatus(d, workspace.id);
    expect(status.isComplete).toBe(true);
    expect(status.progress).toBe(100);
    expect(status.agents.map((a) => a.key).sort()).toEqual(['assistant', 'marketing', 'phone']);
    expect(status.workflowCount).toBeGreaterThan(0);

    const runs = listRuns(d, workspace.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('succeeded');
    expect(runs[0].trigger).toBe('onboarding');
  });

  it('advances the step marker one stage at a time', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const seen: string[] = [getOnboardingStatus(d, workspace.id).step];

    submitCompanyProfile(d, workspace.id, PROFILE);
    seen.push(getOnboardingStatus(d, workspace.id).step);
    submitGoals(d, workspace.id, { goals: ['capture_leads'] });
    seen.push(getOnboardingStatus(d, workspace.id).step);
    hireAgents(d, workspace.id, { agents: [{ key: 'phone', config: {} }] });
    seen.push(getOnboardingStatus(d, workspace.id).step);
    submitConnections(d, workspace.id, { connections: [{ provider: 'calendar' }] });
    seen.push(getOnboardingStatus(d, workspace.id).step);
    await completeOnboarding(d, workspace.id);
    seen.push(getOnboardingStatus(d, workspace.id).step);

    expect(seen).toEqual(ONBOARDING_STEPS);
  });

  it('reports progress as a percentage of the flow', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(getOnboardingStatus(d, workspace.id).progress).toBe(0);
    submitCompanyProfile(d, workspace.id, PROFILE);
    expect(getOnboardingStatus(d, workspace.id).progress).toBe(20);
    submitGoals(d, workspace.id, { goals: ['capture_leads'] });
    expect(getOnboardingStatus(d, workspace.id).progress).toBe(40);
  });
});

describe('onboarding — idempotence and ordering', () => {
  it('does not duplicate workflows when agents are re-hired', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, PROFILE);
    submitGoals(d, workspace.id, { goals: ['capture_leads'] });

    const first = hireAgents(d, workspace.id, { agents: [{ key: 'phone', config: {} }] });
    const countAfterFirst = listWorkflows(d, workspace.id).length;
    expect(first.hired[0].workflows.length).toBe(countAfterFirst);

    const second = hireAgents(d, workspace.id, { agents: [{ key: 'phone', config: {} }] });
    expect(second.hired[0].workflows).toEqual([]);
    expect(listWorkflows(d, workspace.id)).toHaveLength(countAfterFirst);
    expect(listWorkspaceAgents(d, workspace.id)).toHaveLength(1);
  });

  it('never moves the step backwards when an earlier step is resubmitted', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    expect(getOnboardingStatus(d, workspace.id).step).toBe('done');

    submitCompanyProfile(d, workspace.id, { ...PROFILE, legalName: 'Acme Renamed' });
    expect(getOnboardingStatus(d, workspace.id).step).toBe('done');
    expect(findCompanyProfile(d, workspace.id)!.legalName).toBe('Acme Renamed');
  });

  it('keeps goals when the profile is edited later', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, PROFILE);
    submitGoals(d, workspace.id, { goals: ['hire_faster'] });
    submitCompanyProfile(d, workspace.id, { ...PROFILE, industry: 'retail' });
    expect(findCompanyProfile(d, workspace.id)!.goals).toEqual(['hire_faster']);
  });

  it('refuses goals before a profile exists', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(() => submitGoals(d, workspace.id, { goals: ['capture_leads'] })).toThrow(
      /company profile must be saved first/,
    );
  });

  it('refuses to finish with no agents hired', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, PROFILE);
    submitGoals(d, workspace.id, { goals: ['capture_leads'] });
    await expect(completeOnboarding(d, workspace.id)).rejects.toMatchObject({ code: 'conflict' });
    expect(() => submitConnections(d, workspace.id, { connections: [] })).toThrow(/hire at least one agent/);
  });

  it('de-duplicates repeated goals', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, PROFILE);
    submitGoals(d, workspace.id, { goals: ['capture_leads', 'capture_leads', 'hire_faster'] });
    expect(findCompanyProfile(d, workspace.id)!.goals).toEqual(['capture_leads', 'hire_faster']);
  });
});

describe('onboarding — validation', () => {
  it('rejects an invalid profile', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(() => submitCompanyProfile(d, workspace.id, { ...PROFILE, legalName: '' })).toThrow(/invalid company profile/);
    expect(() => submitCompanyProfile(d, workspace.id, { ...PROFILE, size: 'enormous' })).toThrow(/invalid company profile/);
    expect(() => submitCompanyProfile(d, workspace.id, { ...PROFILE, website: 'not-a-url' })).toThrow(/invalid company profile/);
  });

  it('accepts an empty website as null', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, { ...PROFILE, website: '' });
    expect(findCompanyProfile(d, workspace.id)!.website).toBeNull();
  });

  it('rejects an unknown agent key', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, PROFILE);
    submitGoals(d, workspace.id, { goals: ['capture_leads'] });
    expect(() => hireAgents(d, workspace.id, { agents: [{ key: 'nonexistent', config: {} }] })).toThrow(
      /unknown agent/,
    );
    expect(listWorkspaceAgents(d, workspace.id)).toHaveLength(0);
  });

  it('rejects agent config that fails the catalog schema', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, PROFILE);
    submitGoals(d, workspace.id, { goals: ['grow_audience'] });
    expect(() =>
      hireAgents(d, workspace.id, { agents: [{ key: 'marketing', config: { postsPerWeek: 999 } }] }),
    ).toThrow(/invalid config for marketing/);
  });

  it('applies catalog defaults to agent config', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    submitCompanyProfile(d, workspace.id, PROFILE);
    submitGoals(d, workspace.id, { goals: ['grow_audience'] });
    hireAgents(d, workspace.id, { agents: [{ key: 'marketing', config: {} }] });
    const agent = listWorkspaceAgents(d, workspace.id)[0];
    expect(agent.config.postsPerWeek).toBe(3);
    expect(agent.config.channels).toEqual(['linkedin']);
    expect(agent.config.autonomy).toBe('approve');
  });
});

describe('onboarding — integrations are never mandatory', () => {
  it('completes with zero connections', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const result = await onboard(d, workspace.id, { agents: ['marketing'], connect: [] });
    expect(result.workspace.onboardingStep).toBe('done');
    expect(requiredProvidersFor(d, workspace.id).connected).toEqual([]);
  });

  it('reports missing required providers without blocking', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id, { agents: ['phone'], connect: [] });
    const providers = requiredProvidersFor(d, workspace.id);
    expect(providers.required).toContain('calendar');
    expect(providers.missing).toContain('calendar');
    // Still live despite the gap.
    expect(getOnboardingStatus(d, workspace.id).isComplete).toBe(true);
  });
});

describe('agent recommendation', () => {
  it('always leads with Charly and matches goals to agents', () => {
    expect(recommendAgents(['capture_leads'])[0]).toBe('assistant');
    expect(recommendAgents(['hire_faster'])).toContain('recruiting');
    expect(recommendAgents(['stay_compliant'])).toContain('legal');
    expect(recommendAgents(['control_costs'])).toContain('accounting');
  });

  it('ranks the best-matching agent first', () => {
    const recs = recommendAgents(['capture_leads', 'generate_demand', 'close_deals']);
    // Elio matches all three; everyone else matches fewer.
    expect(recs[1]).toBe('sales');
  });

  it('returns just Charly when no goal maps to a specialist', () => {
    expect(recommendAgents(['save_time'])).toEqual(['assistant']);
    expect(recommendAgents([])).toEqual(['assistant']);
  });
});

describe('first run selection', () => {
  it('picks a workflow that needs no integration', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id, { agents: ['assistant'], connect: [] });
    const runs = listRuns(d, workspace.id);
    expect(runs[0].status).toBe('succeeded');
  });

  it('returns null when the workspace has no workflows', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    expect(pickFirstRunWorkflow(d, workspace.id)).toBeNull();
  });

  it('logs the milestone to the activity feed', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    const kinds = listActivity(d, workspace.id).map((e) => e.kind);
    expect(kinds).toContain('workspace.created');
    expect(kinds).toContain('agent.hired');
    expect(kinds).toContain('onboarding.completed');
    expect(kinds).toContain('run.succeeded');
  });
});
