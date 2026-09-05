import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { transaction } from '../db/index.ts';
import {
  AGENT_CATALOG,
  GOAL_KEYS,
  getAgent,
  isAgentKey,
  parseAgentConfig,
  recommendAgents,
  type AgentKey,
} from '../agents/catalog.ts';
import {
  connectProvider,
  connectedProviders,
  findCompanyProfile,
  findWorkspace,
  hireAgent,
  listWorkspaceAgents,
  setCompanyGoals,
  setOnboardingStep,
  upsertCompanyProfile,
} from '../repos/accounts.ts';
import { createWorkflow, listWorkflows, recordActivity } from '../repos/workflows.ts';
import { definitionsForAgent, getWorkflowDefinition } from '../workflows/definitions.ts';
import { runNow } from '../workflows/runner.ts';
import { AppError, type OnboardingStep, type Workspace } from '../repos/types.ts';

/**
 * Self-serve onboarding. The whole point of this module is that a new customer
 * gets from sign-up to a working, running workspace with nobody from our side
 * involved — no scheduled call, no manual provisioning, no back-office toggle.
 *
 * The flow is a linear state machine persisted on `workspaces.onboarding_step`.
 * Each step is idempotent and re-runnable, so a refresh or a double-submit
 * can't leave a workspace half-provisioned.
 */

export const ONBOARDING_STEPS: OnboardingStep[] = [
  'company_profile',
  'pick_goals',
  'hire_agents',
  'connect_tools',
  'first_run',
  'done',
];

function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/** Steps are ordered; completing step N moves you to N+1 but never backwards. */
function advance(db: Db, workspace: Workspace, to: OnboardingStep): void {
  if (stepIndex(to) > stepIndex(workspace.onboardingStep)) {
    setOnboardingStep(db, workspace.id, to);
  }
}

function requireWorkspace(db: Db, workspaceId: string): Workspace {
  const ws = findWorkspace(db, workspaceId);
  if (!ws) throw new AppError('not_found', 'workspace not found');
  return ws;
}

// ------------------------------------------------------- step 1: profile

export const companyProfileSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  industry: z.string().trim().min(1).max(120),
  size: z.enum(['solo', '2-10', '11-50', '51-200', '200+']),
  website: z.string().trim().url().max(500).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  description: z.string().trim().max(2000).default(''),
  tone: z.enum(['professional', 'friendly', 'concise', 'formal']).default('professional'),
  timezone: z.string().trim().max(64).default('UTC'),
});

export function submitCompanyProfile(
  db: Db,
  workspaceId: string,
  raw: unknown,
): { workspace: Workspace; nextStep: OnboardingStep } {
  const ws = requireWorkspace(db, workspaceId);
  const parsed = companyProfileSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid company profile', parsed.error.issues);

  return transaction(db, () => {
    // Preserve goals if the user comes back and edits the profile later.
    const existing = findCompanyProfile(db, workspaceId);
    upsertCompanyProfile(db, workspaceId, { ...parsed.data, goals: existing?.goals ?? [] });
    advance(db, ws, 'pick_goals');
    recordActivity(db, {
      workspaceId,
      actorType: 'user',
      kind: 'onboarding.profile_saved',
      summary: 'Company profile saved',
    });
    const updated = requireWorkspace(db, workspaceId);
    return { workspace: updated, nextStep: updated.onboardingStep };
  });
}

// --------------------------------------------------------- step 2: goals

export const goalsSchema = z.object({
  goals: z.array(z.enum(GOAL_KEYS as [string, ...string[]])).min(1).max(GOAL_KEYS.length),
});

export function submitGoals(
  db: Db,
  workspaceId: string,
  raw: unknown,
): { recommended: { key: AgentKey; name: string; role: string; blurb: string }[]; nextStep: OnboardingStep } {
  const ws = requireWorkspace(db, workspaceId);
  if (!findCompanyProfile(db, workspaceId)) {
    throw new AppError('conflict', 'company profile must be saved first');
  }
  const parsed = goalsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid goals', parsed.error.issues);

  return transaction(db, () => {
    // De-duplicate; the UI can submit the same goal twice from a multi-select.
    const goals = [...new Set(parsed.data.goals)];
    setCompanyGoals(db, workspaceId, goals);
    advance(db, ws, 'hire_agents');
    const recommended = recommendAgents(goals).map((k) => ({
      key: k,
      name: AGENT_CATALOG[k].name,
      role: AGENT_CATALOG[k].role,
      blurb: AGENT_CATALOG[k].blurb,
    }));
    return { recommended, nextStep: requireWorkspace(db, workspaceId).onboardingStep };
  });
}

// ---------------------------------------------------- step 3: hire agents

export const hireSchema = z.object({
  agents: z
    .array(z.object({ key: z.string(), config: z.record(z.unknown()).default({}) }))
    .min(1)
    .max(20),
});

/**
 * Hires the selected agents and provisions each one's default workflows in the
 * same transaction. This is what replaces the competitor's "1:1 configuration
 * call" — the workspace comes out the other side already wired up.
 */
export function hireAgents(
  db: Db,
  workspaceId: string,
  raw: unknown,
): { hired: { key: string; name: string; workflows: string[] }[]; nextStep: OnboardingStep } {
  const ws = requireWorkspace(db, workspaceId);
  const parsed = hireSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid agent selection', parsed.error.issues);

  for (const a of parsed.data.agents) {
    if (!isAgentKey(a.key)) throw new AppError('invalid', `unknown agent: ${a.key}`);
  }

  return transaction(db, () => {
    const existingByKey = new Map(
      listWorkflows(db, workspaceId).map((w) => [`${w.workspaceAgentId}:${w.definitionKey}`, w]),
    );
    const hired: { key: string; name: string; workflows: string[] }[] = [];

    for (const selection of parsed.data.agents) {
      const def = getAgent(selection.key);
      let config: Record<string, unknown>;
      try {
        config = parseAgentConfig(selection.key, selection.config);
      } catch (err) {
        throw new AppError('invalid', `invalid config for ${selection.key}`, (err as Error).message);
      }

      const wsAgent = hireAgent(db, {
        workspaceId,
        agentKey: def.key,
        displayName: def.name,
        config,
      });

      const created: string[] = [];
      for (const defKey of def.workflows) {
        // Re-hiring must not duplicate workflows.
        if (existingByKey.has(`${wsAgent.id}:${defKey}`)) continue;
        const wf = getWorkflowDefinition(defKey);
        createWorkflow(db, {
          workspaceId,
          workspaceAgentId: wsAgent.id,
          definitionKey: defKey,
          name: wf.name,
          triggerKind: wf.defaultTrigger.kind,
          triggerConfig: wf.defaultTrigger.config,
        });
        created.push(defKey);
      }

      hired.push({ key: def.key, name: def.name, workflows: created });
      recordActivity(db, {
        workspaceId,
        actorType: 'system',
        kind: 'agent.hired',
        summary: `${def.name} joined the workspace`,
        data: { agentKey: def.key, workflows: created },
      });
    }

    advance(db, ws, 'connect_tools');
    return { hired, nextStep: requireWorkspace(db, workspaceId).onboardingStep };
  });
}

// --------------------------------------------------- step 4: connect tools

export const connectSchema = z.object({
  connections: z
    .array(
      z.object({
        provider: z.string().trim().min(1).max(60),
        externalAccount: z.string().trim().max(200).optional(),
        secretRef: z.string().trim().max(200).optional(),
      }),
    )
    .max(50)
    .default([]),
  /** Explicit opt-out; the flow must never require a connection to proceed. */
  skip: z.boolean().default(false),
});

/**
 * Returns which providers the hired agents want. Nothing here is mandatory —
 * a workspace can finish onboarding with zero integrations and the affected
 * steps simply report as skipped at run time.
 */
export function requiredProvidersFor(db: Db, workspaceId: string): {
  required: string[];
  optional: string[];
  connected: string[];
  missing: string[];
} {
  const agents = listWorkspaceAgents(db, workspaceId);
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const a of agents) {
    if (!isAgentKey(a.agentKey)) continue;
    for (const p of AGENT_CATALOG[a.agentKey].requiredProviders) required.add(p);
    for (const p of AGENT_CATALOG[a.agentKey].optionalProviders) optional.add(p);
  }
  const connected = connectedProviders(db, workspaceId);
  return {
    required: [...required],
    optional: [...optional].filter((p) => !required.has(p)),
    connected,
    missing: [...required].filter((p) => !connected.includes(p)),
  };
}

export function submitConnections(
  db: Db,
  workspaceId: string,
  raw: unknown,
): { connected: string[]; missing: string[]; nextStep: OnboardingStep } {
  const ws = requireWorkspace(db, workspaceId);
  if (listWorkspaceAgents(db, workspaceId).length === 0) {
    throw new AppError('conflict', 'hire at least one agent first');
  }
  const parsed = connectSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid connections', parsed.error.issues);

  return transaction(db, () => {
    for (const c of parsed.data.connections) {
      connectProvider(db, { workspaceId, provider: c.provider, externalAccount: c.externalAccount, secretRef: c.secretRef });
      recordActivity(db, {
        workspaceId,
        actorType: 'user',
        kind: 'connection.added',
        summary: `Connected ${c.provider}`,
        data: { provider: c.provider },
      });
    }
    advance(db, ws, 'first_run');
    const state = requiredProvidersFor(db, workspaceId);
    return { connected: state.connected, missing: state.missing, nextStep: requireWorkspace(db, workspaceId).onboardingStep };
  });
}

// ------------------------------------------------------- step 5: first run

/**
 * Picks a workflow that will produce something visible without any integration,
 * so the very first thing a new customer sees is real output rather than an
 * empty dashboard.
 */
export function pickFirstRunWorkflow(db: Db, workspaceId: string): { workflowId: string; definitionKey: string; input: Record<string, unknown> } | null {
  const workflows = listWorkflows(db, workspaceId).filter((w) => w.status === 'active');
  if (workflows.length === 0) return null;
  const profile = findCompanyProfile(db, workspaceId);

  // Ordered by how well the output demos with no data connected yet.
  const preferred: Record<string, Record<string, unknown>> = {
    daily_briefing: { lookbackHours: 24 },
    content_calendar: { weeks: 4, themes: profile ? [profile.industry] : [] },
    cash_forecast: { openingBalance: 10000, monthlyInflow: 5000, monthlyOutflow: 4000 },
    prospect_list: { size: 25 },
    site_audit: profile?.website ? { url: profile.website, maxPages: 25 } : null,
    resume_screen: { role: 'Open role', applicants: [], requiredSkills: [] },
  } as Record<string, Record<string, unknown>>;

  for (const [key, input] of Object.entries(preferred)) {
    if (input === null) continue;
    const match = workflows.find((w) => w.definitionKey === key);
    if (match) return { workflowId: match.id, definitionKey: key, input };
  }
  return null;
}

/**
 * Finishes onboarding: kicks off one real workflow run and marks the workspace
 * live. Deliberately tolerant — if the demo run fails, the customer is still
 * onboarded, because blocking activation on a background job would put a human
 * back in the loop.
 */
export async function completeOnboarding(
  db: Db,
  workspaceId: string,
  opts: { now?: () => Date } = {},
): Promise<{ workspace: Workspace; firstRun: { runId: string; status: string } | null }> {
  const ws = requireWorkspace(db, workspaceId);
  if (listWorkspaceAgents(db, workspaceId).length === 0) {
    throw new AppError('conflict', 'hire at least one agent first');
  }

  let firstRun: { runId: string; status: string } | null = null;
  const pick = pickFirstRunWorkflow(db, workspaceId);
  if (pick) {
    try {
      const { run, outcome } = await runNow(
        db,
        { workspaceId, workflowId: pick.workflowId, input: pick.input, trigger: 'onboarding' },
        { now: opts.now },
      );
      firstRun = { runId: run.id, status: outcome.status };
    } catch (err) {
      recordActivity(db, {
        workspaceId,
        actorType: 'system',
        kind: 'onboarding.first_run_failed',
        summary: 'First run could not be started',
        data: { error: (err as Error).message },
      });
    }
  }

  setOnboardingStep(db, workspaceId, 'done');
  recordActivity(db, {
    workspaceId,
    actorType: 'system',
    kind: 'onboarding.completed',
    summary: 'Workspace is live',
    data: { firstRun },
  });
  void ws;
  return { workspace: requireWorkspace(db, workspaceId), firstRun };
}

// ------------------------------------------------------------------ status

export type OnboardingStatus = {
  step: OnboardingStep;
  completedSteps: OnboardingStep[];
  progress: number;
  isComplete: boolean;
  profile: ReturnType<typeof findCompanyProfile>;
  agents: { key: string; name: string; status: string }[];
  providers: ReturnType<typeof requiredProvidersFor>;
  workflowCount: number;
};

/** Everything the onboarding UI needs to render, in one round trip. */
export function getOnboardingStatus(db: Db, workspaceId: string): OnboardingStatus {
  const ws = requireWorkspace(db, workspaceId);
  const idx = stepIndex(ws.onboardingStep);
  const agents = listWorkspaceAgents(db, workspaceId);
  return {
    step: ws.onboardingStep,
    completedSteps: ONBOARDING_STEPS.slice(0, idx),
    // 'done' is the terminal marker, not a step the user performs.
    progress: Math.round((idx / (ONBOARDING_STEPS.length - 1)) * 100),
    isComplete: ws.onboardingStep === 'done',
    profile: findCompanyProfile(db, workspaceId),
    agents: agents.map((a) => ({ key: a.agentKey, name: a.displayName, status: a.status })),
    providers: requiredProvidersFor(db, workspaceId),
    workflowCount: listWorkflows(db, workspaceId).length,
  };
}

export { definitionsForAgent };
