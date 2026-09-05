import { createTestDb, type Db } from '../src/lib/db/index.ts';
import { signup } from '../src/lib/auth/service.ts';
import {
  hireAgents,
  submitCompanyProfile,
  submitConnections,
  submitGoals,
  completeOnboarding,
} from '../src/lib/onboarding/machine.ts';

export function db(): Db {
  return createTestDb();
}

export const VALID_PASSWORD = 'correct-horse-battery';

let seq = 0;
export function uniqueEmail(): string {
  return `user${++seq}-${process.pid}@example.com`;
}

export async function newAccount(d: Db, over: Partial<{ email: string; password: string }> = {}) {
  const r = await signup(d, {
    email: over.email ?? uniqueEmail(),
    name: 'Ada Lovelace',
    password: over.password ?? VALID_PASSWORD,
    workspaceName: 'Acme',
  });
  if (!r.created) throw new Error('test signup unexpectedly hit the idempotent path');
  return r;
}

/** Drives a workspace all the way through onboarding. */
export async function onboard(
  d: Db,
  workspaceId: string,
  opts: { goals?: string[]; agents?: string[]; connect?: string[]; now?: () => Date } = {},
) {
  submitCompanyProfile(d, workspaceId, {
    legalName: 'Acme SAS',
    industry: 'software',
    size: '2-10',
    website: 'https://acme.example',
    description: 'We make things',
    tone: 'friendly',
    timezone: 'Europe/Paris',
  });
  submitGoals(d, workspaceId, { goals: opts.goals ?? ['capture_leads', 'grow_audience'] });
  hireAgents(d, workspaceId, {
    agents: (opts.agents ?? ['assistant', 'phone', 'marketing']).map((key) => ({ key, config: {} })),
  });
  submitConnections(d, workspaceId, {
    connections: (opts.connect ?? ['calendar']).map((provider) => ({ provider })),
  });
  return completeOnboarding(d, workspaceId, { now: opts.now });
}

/** A clock that starts at a fixed instant, for deterministic assertions. */
export function fixedClock(iso = '2026-01-15T09:00:00.000Z') {
  return () => new Date(iso);
}
