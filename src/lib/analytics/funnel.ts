import type { Db } from '../db/index.ts';
import { findWorkspace } from '../repos/accounts.ts';
import { listActivity } from '../repos/workflows.ts';
import { ONBOARDING_STEPS, abandonOnboarding } from '../onboarding/machine.ts';
import { AppError, type OnboardingStep } from '../repos/types.ts';

/**
 * Onboarding funnel instrumentation (LIN-2 AC8 / LIN-14).
 * Tracks entered, completed, and abandoned states per onboarding step,
 * both for individual workspaces and as aggregate metrics for activation measurement.
 */

export const FUNNEL_STEPS: { step: OnboardingStep; name: string }[] = [
  { step: 'company_profile', name: 'Company Profile' },
  { step: 'pick_goals', name: 'Pick Goals' },
  { step: 'hire_agents', name: 'Hire Agents' },
  { step: 'connect_tools', name: 'Connect Tools' },
  { step: 'first_run', name: 'First Run' },
];

export type FunnelStepMetric = {
  step: OnboardingStep;
  name: string;
  entered: boolean;
  completed: boolean;
  abandoned: boolean;
  enteredAt: string | null;
  completedAt: string | null;
  abandonedAt: string | null;
  durationMs: number | null;
};

export type WorkspaceFunnel = {
  workspaceId: string;
  signedUpAt: string;
  currentStep: OnboardingStep;
  isComplete: boolean;
  completedAt: string | null;
  reachedSteps: { step: OnboardingStep; at: string }[];
  steps: FunnelStepMetric[];
  /** Null until the workspace's first workflow run has finished. */
  timeToFirstTaskMs: number | null;
  firstTaskStatus: string | null;
};

export type AggregateStepMetric = {
  step: OnboardingStep;
  name: string;
  enteredCount: number;
  completedCount: number;
  abandonedCount: number;
  completionRate: number; // completedCount / enteredCount (0 to 1)
  dropoffRate: number;    // abandonedCount / enteredCount (0 to 1)
};

export type AggregateFunnel = {
  totalWorkspaces: number;
  completedWorkspaces: number;
  overallActivationRate: number; // completedWorkspaces / totalWorkspaces
  medianTimeToFirstTaskMs: number | null;
  averageTimeToFirstTaskMs: number | null;
  steps: AggregateStepMetric[];
};

function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/**
 * Funnel metrics for a single workspace:
 * Evaluates per-step status (entered / completed / abandoned), durations,
 * and time-to-first-task.
 */
export function workspaceFunnel(
  db: Db,
  workspaceId: string,
  opts: { abandonedThresholdMs?: number } = {},
): WorkspaceFunnel {
  const workspace = findWorkspace(db, workspaceId);
  if (!workspace) throw new AppError('not_found', 'workspace not found');

  const isComplete = workspace.onboardingStep === 'done';
  const currentIdx = stepIndex(workspace.onboardingStep);
  const events = listActivity(db, workspaceId, 200).slice().reverse(); // oldest first

  const profileSaved = events.find((e) => e.kind === 'onboarding.profile_saved');
  const goalsSaved = events.find((e) => e.kind === 'onboarding.goals_saved');
  const agentsHired = events.find((e) => e.kind === 'onboarding.agents_hired' || e.kind === 'agent.hired');
  const toolsSubmitted = events.find((e) => e.kind === 'onboarding.tools_submitted' || e.kind === 'connection.added');
  const completedEvent = events.find((e) => e.kind === 'onboarding.completed');
  const explicitAbandons = events.filter((e) => e.kind === 'onboarding.step_abandoned');

  const steps: FunnelStepMetric[] = [];

  for (const s of FUNNEL_STEPS) {
    let entered = false;
    let completed = false;
    let enteredAt: string | null = null;
    let completedAt: string | null = null;

    switch (s.step) {
      case 'company_profile': {
        entered = true;
        enteredAt = workspace.createdAt;
        completed = currentIdx > stepIndex('company_profile') || !!profileSaved;
        completedAt = profileSaved?.createdAt ?? (completed ? workspace.updatedAt : null);
        break;
      }
      case 'pick_goals': {
        entered = currentIdx >= stepIndex('pick_goals') || !!profileSaved;
        enteredAt = profileSaved?.createdAt ?? (entered ? workspace.createdAt : null);
        completed = currentIdx > stepIndex('pick_goals') || !!goalsSaved;
        completedAt = goalsSaved?.createdAt ?? (completed ? (agentsHired?.createdAt ?? workspace.updatedAt) : null);
        break;
      }
      case 'hire_agents': {
        entered = currentIdx >= stepIndex('hire_agents') || !!goalsSaved;
        enteredAt = goalsSaved?.createdAt ?? (entered ? (profileSaved?.createdAt ?? workspace.createdAt) : null);
        completed = currentIdx > stepIndex('hire_agents') || !!agentsHired;
        completedAt = agentsHired?.createdAt ?? (completed ? (toolsSubmitted?.createdAt ?? workspace.updatedAt) : null);
        break;
      }
      case 'connect_tools': {
        entered = currentIdx >= stepIndex('connect_tools') || !!agentsHired;
        enteredAt = agentsHired?.createdAt ?? (entered ? (goalsSaved?.createdAt ?? workspace.createdAt) : null);
        completed = currentIdx > stepIndex('connect_tools') || !!toolsSubmitted;
        completedAt = toolsSubmitted?.createdAt ?? (completed ? (completedEvent?.createdAt ?? workspace.updatedAt) : null);
        break;
      }
      case 'first_run': {
        entered = currentIdx >= stepIndex('first_run') || !!toolsSubmitted;
        enteredAt = toolsSubmitted?.createdAt ?? (entered ? (agentsHired?.createdAt ?? workspace.createdAt) : null);
        completed = isComplete || !!completedEvent;
        completedAt = completedEvent?.createdAt ?? (isComplete ? (workspace.onboardingDoneAt ?? workspace.updatedAt) : null);
        break;
      }
    }

    // Determine abandonment
    let abandoned = false;
    let abandonedAt: string | null = null;

    const explicit = explicitAbandons.find(
      (e) => e.data?.step === s.step || (!e.data?.step && workspace.onboardingStep === s.step),
    );

    if (explicit) {
      abandoned = true;
      abandonedAt = explicit.createdAt;
    } else if (entered && !completed) {
      if (workspace.onboardingStep === s.step && !isComplete) {
        if (opts.abandonedThresholdMs !== undefined) {
          const idleMs = Date.now() - new Date(workspace.updatedAt).getTime();
          abandoned = idleMs >= opts.abandonedThresholdMs;
        } else {
          abandoned = true;
        }
        if (abandoned) {
          abandonedAt = workspace.updatedAt;
        }
      }
    }

    const durationMs =
      entered && completed && enteredAt && completedAt
        ? Math.max(0, new Date(completedAt).getTime() - new Date(enteredAt).getTime())
        : null;

    steps.push({
      step: s.step,
      name: s.name,
      entered,
      completed,
      abandoned,
      enteredAt,
      completedAt,
      abandonedAt,
      durationMs,
    });
  }

  // Legacy reachedSteps array: preserve for compatibility
  const reachedSteps: { step: OnboardingStep; at: string }[] = [];
  for (const s of FUNNEL_STEPS) {
    const metric = steps.find((m) => m.step === s.step);
    if (metric?.entered && metric.enteredAt) {
      reachedSteps.push({ step: s.step, at: metric.enteredAt });
    }
  }
  if (isComplete) {
    reachedSteps.push({
      step: 'done',
      at: completedEvent?.createdAt ?? workspace.onboardingDoneAt ?? workspace.updatedAt,
    });
  }

  const firstRun = completedEvent?.data.firstRun as { runId: string; status: string } | null | undefined;
  let timeToFirstTaskMs: number | null = null;
  let firstTaskStatus: string | null = null;
  if (completedEvent && firstRun) {
    timeToFirstTaskMs = new Date(completedEvent.createdAt).getTime() - new Date(workspace.createdAt).getTime();
    firstTaskStatus = firstRun.status;
  }

  return {
    workspaceId,
    signedUpAt: workspace.createdAt,
    currentStep: workspace.onboardingStep,
    isComplete,
    completedAt: completedEvent?.createdAt ?? workspace.onboardingDoneAt,
    reachedSteps,
    steps,
    timeToFirstTaskMs,
    firstTaskStatus,
  };
}

/**
 * Aggregate funnel metrics across all workspaces in the database:
 * Calculates overall activation rate, step-by-step entered/completed/abandoned
 * counts, completion rates, drop-off rates, and average/median time-to-first-task.
 */
export function aggregateFunnel(
  db: Db,
  opts: { abandonedThresholdMs?: number } = {},
): AggregateFunnel {
  const workspaces = db.prepare('SELECT id FROM workspaces').all() as { id: string }[];
  const funnels = workspaces.map((w) => workspaceFunnel(db, w.id, opts));

  const totalWorkspaces = funnels.length;
  const completedWorkspaces = funnels.filter((f) => f.isComplete).length;
  const overallActivationRate = totalWorkspaces > 0 ? completedWorkspaces / totalWorkspaces : 0;

  const times = funnels
    .map((f) => f.timeToFirstTaskMs)
    .filter((t): t is number => t !== null && t >= 0)
    .sort((a, b) => a - b);

  const averageTimeToFirstTaskMs =
    times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;

  let medianTimeToFirstTaskMs: number | null = null;
  if (times.length > 0) {
    const mid = Math.floor(times.length / 2);
    medianTimeToFirstTaskMs =
      times.length % 2 === 0 ? Math.round((times[mid - 1] + times[mid]) / 2) : times[mid];
  }

  const steps: AggregateStepMetric[] = FUNNEL_STEPS.map((s) => {
    let enteredCount = 0;
    let completedCount = 0;
    let abandonedCount = 0;

    for (const f of funnels) {
      const stepMetric = f.steps.find((m) => m.step === s.step);
      if (stepMetric?.entered) enteredCount++;
      if (stepMetric?.completed) completedCount++;
      if (stepMetric?.abandoned) abandonedCount++;
    }

    const completionRate = enteredCount > 0 ? completedCount / enteredCount : 0;
    const dropoffRate = enteredCount > 0 ? abandonedCount / enteredCount : 0;

    return {
      step: s.step,
      name: s.name,
      enteredCount,
      completedCount,
      abandonedCount,
      completionRate,
      dropoffRate,
    };
  });

  return {
    totalWorkspaces,
    completedWorkspaces,
    overallActivationRate,
    medianTimeToFirstTaskMs,
    averageTimeToFirstTaskMs,
    steps,
  };
}

/** Explicitly record that a workspace abandoned at a specific step */
export function recordFunnelStepAbandoned(
  db: Db,
  workspaceId: string,
  step?: OnboardingStep,
  reason?: string,
): { workspaceId: string; step: OnboardingStep } {
  const res = abandonOnboarding(db, workspaceId, { step, reason });
  return { workspaceId, step: res.abandonedStep };
}
