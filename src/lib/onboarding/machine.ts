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

// ---------------------------------------------------- profile derivation (AC4)

export type DerivedProfile = {
  legalName: string;
  industry: string;
  size: 'solo' | '2-10' | '11-50' | '51-200' | '200+';
  website: string | null;
  description: string;
  tone: 'professional' | 'friendly' | 'concise' | 'formal';
  timezone: string;
};

export function deriveCompanyProfile(text: string, website?: string): { success: boolean; profile: DerivedProfile } {
  const trimmed = (text || '').trim();
  const fallback: DerivedProfile = {
    legalName: '',
    industry: 'Technology',
    size: '2-10',
    website: website?.trim() || null,
    description: trimmed,
    tone: 'professional',
    timezone: 'UTC',
  };

  if (!trimmed && !website) {
    return { success: false, profile: fallback };
  }

  try {
    let name = '';
    let industry = 'Technology';
    let size: DerivedProfile['size'] = '2-10';
    let tone: DerivedProfile['tone'] = 'professional';

    // 1. Try to extract name
    const nameMatch = trimmed.match(/(?:we are|i am|company is|at|welcome to)\s+([A-Z][A-Za-z0-9\s&.-]{1,30})/i);
    if (nameMatch && nameMatch[1]) {
      name = nameMatch[1].trim().replace(/\s+(?:is|provides|builds|helps|specializes).*/i, '');
    } else if (website) {
      try {
        const url = new URL(website.startsWith('http') ? website : `https://${website}`);
        const hostParts = url.hostname.replace(/^www\./, '').split('.');
        if (hostParts[0]) {
          name = hostParts[0].charAt(0).toUpperCase() + hostParts[0].slice(1);
        }
      } catch {}
    }

    // 2. Try to extract industry
    const lower = trimmed.toLowerCase();
    const industryMap: Record<string, string> = {
      'real estate': 'Real Estate',
      'letting': 'Real Estate',
      'property': 'Real Estate',
      'ecommerce': 'E-commerce',
      'retail': 'Retail',
      'software': 'Software & SaaS',
      'saas': 'Software & SaaS',
      'tech': 'Technology',
      'logistics': 'Logistics & Supply Chain',
      'supply chain': 'Logistics & Supply Chain',
      'finance': 'Financial Services',
      'fintech': 'Fintech',
      'accounting': 'Accounting',
      'consulting': 'Consulting',
      'marketing': 'Marketing & Advertising',
      'agency': 'Marketing Agency',
      'legal': 'Legal Services',
      'healthcare': 'Healthcare',
      'health': 'Healthcare',
      'education': 'Education',
      'recruiting': 'Staffing & Recruiting',
      'hr': 'Human Resources',
    };
    for (const [kw, ind] of Object.entries(industryMap)) {
      if (lower.includes(kw)) {
        industry = ind;
        break;
      }
    }

    // 3. Try to extract size
    if (/\b(solo|freelanc|myself|just me)\b/i.test(lower)) size = 'solo';
    else if (/\b(200\+|enterprise|large)\b/i.test(lower)) size = '200+';
    else if (/\b(5[1-9]|[6-9]\d|1\d\d|200)\s*(?:people|employees|team|person)\b/i.test(lower)) size = '51-200';
    else if (/\b(1[1-9]|[2-4]\d|50)\s*(?:people|employees|team|person)\b/i.test(lower)) size = '11-50';
    else if (/\b([2-9]|10)\s*(?:people|employees|team|person)\b/i.test(lower)) size = '2-10';

    // 4. Try to extract tone
    if (/\b(friendly|warm|approachable|fun)\b/i.test(lower)) tone = 'friendly';
    else if (/\b(concise|direct|brief|punchy)\b/i.test(lower)) tone = 'concise';
    else if (/\b(formal|corporate|legal|serious)\b/i.test(lower)) tone = 'formal';
    else if (/\b(professional|business)\b/i.test(lower)) tone = 'professional';

    return {
      success: true,
      profile: {
        legalName: name || fallback.legalName,
        industry,
        size,
        website: website?.trim() || null,
        description: trimmed,
        tone,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
    };
  } catch {
    return { success: false, profile: fallback };
  }
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
    recordActivity(db, {
      workspaceId,
      actorType: 'user',
      kind: 'onboarding.goals_saved',
      summary: 'Company goals saved',
      data: { goals },
    });
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

    recordActivity(db, {
      workspaceId,
      actorType: 'user',
      kind: 'onboarding.agents_hired',
      summary: `${hired.length} agent(s) hired`,
      data: { agents: hired.map((h) => h.key) },
    });

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
    recordActivity(db, {
      workspaceId,
      actorType: 'user',
      kind: 'onboarding.tools_submitted',
      summary:
        parsed.data.skip || parsed.data.connections.length === 0
          ? 'Skipped tool connections'
          : `Connected ${parsed.data.connections.length} tool(s)`,
      data: {
        connected: parsed.data.connections.map((c) => c.provider),
        skip: parsed.data.skip,
      },
    });
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

export function abandonOnboarding(
  db: Db,
  workspaceId: string,
  opts: { reason?: string; step?: OnboardingStep } = {},
): { workspace: Workspace; abandonedStep: OnboardingStep } {
  const ws = requireWorkspace(db, workspaceId);
  const step = opts.step ?? ws.onboardingStep;
  recordActivity(db, {
    workspaceId,
    actorType: 'user',
    kind: 'onboarding.step_abandoned',
    summary: `Onboarding abandoned at ${step}${opts.reason ? `: ${opts.reason}` : ''}`,
    data: { step, reason: opts.reason ?? null },
  });
  return { workspace: ws, abandonedStep: step };
}

export { definitionsForAgent };

