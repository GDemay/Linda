import type { Db } from '../db/index.ts';
import { findWorkspace } from '../repos/accounts.ts';
import { listActivity } from '../repos/workflows.ts';
import { ONBOARDING_STEPS } from '../onboarding/machine.ts';
import { AppError, type OnboardingStep } from '../repos/types.ts';

/**
 * Time-to-first-task and funnel instrumentation. Everything this reads
 * already lands in `activity_events` as onboarding progresses (see
 * lib/onboarding/machine.ts) — this module is the read side that turns those
 * events into the metric launch tracking actually needs.
 */

export type WorkspaceFunnel = {
  workspaceId: string;
  signedUpAt: string;
  currentStep: OnboardingStep;
  reachedSteps: { step: OnboardingStep; at: string }[];
  /** Null until the workspace's first workflow run has finished. */
  timeToFirstTaskMs: number | null;
  firstTaskStatus: string | null;
};

const STEP_EVENT_KIND: Partial<Record<OnboardingStep, string>> = {
  pick_goals: 'onboarding.profile_saved',
  connect_tools: 'agent.hired',
  first_run: 'connection.added',
  done: 'onboarding.completed',
};

/**
 * Time-to-first-task for one workspace: the gap between account creation and
 * its first workflow run reaching a terminal state, however that turned out.
 * Reads `onboarding.completed`'s payload rather than the runs table directly,
 * since that's the event onboarding itself records for the run it kicks off.
 */
export function workspaceFunnel(db: Db, workspaceId: string): WorkspaceFunnel {
  const workspace = findWorkspace(db, workspaceId);
  if (!workspace) throw new AppError('not_found', 'workspace not found');

  const events = listActivity(db, workspaceId, 200).slice().reverse(); // oldest first
  const reachedSteps: { step: OnboardingStep; at: string }[] = [
    { step: 'company_profile', at: workspace.createdAt },
  ];
  for (const step of ONBOARDING_STEPS) {
    const kind = STEP_EVENT_KIND[step];
    if (!kind) continue;
    const hit = events.find((e) => e.kind === kind);
    if (hit) reachedSteps.push({ step, at: hit.createdAt });
  }

  const completed = events.find((e) => e.kind === 'onboarding.completed');
  const firstRun = completed?.data.firstRun as { runId: string; status: string } | null | undefined;

  let timeToFirstTaskMs: number | null = null;
  let firstTaskStatus: string | null = null;
  if (completed && firstRun) {
    timeToFirstTaskMs = new Date(completed.createdAt).getTime() - new Date(workspace.createdAt).getTime();
    firstTaskStatus = firstRun.status;
  }

  return {
    workspaceId,
    signedUpAt: workspace.createdAt,
    currentStep: workspace.onboardingStep,
    reachedSteps,
    timeToFirstTaskMs,
    firstTaskStatus,
  };
}
