import { describe, expect, it } from 'vitest';
import { db, fixedClock, newAccount, onboard } from './helpers.ts';
import { AGENT_CATALOG, AGENT_KEYS } from '../src/lib/agents/catalog.ts';
import { PRICING_TIERS } from '../src/lib/pricing.ts';
import { CHANGELOG } from '../src/lib/changelog.ts';
import { deleteAccount, exportWorkspaceData } from '../src/lib/accounts/data.ts';
import { workspaceFunnel } from '../src/lib/analytics/funnel.ts';
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
