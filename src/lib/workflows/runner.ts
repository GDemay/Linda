import type { Db } from '../db/index.ts';
import { recordUsage, WORKFLOW_RUN_TOKENS_PER_STEP, assertWithinCap } from '../billing/metering.ts';
import { connectedProviders, findWorkspaceAgent } from '../repos/accounts.ts';
import { groundingForAgent } from '../knowledge/index.ts';
import { createApprovalItem } from '../repos/approvals.ts';
import {
  claimNextRun,
  claimRun,
  completeRun,
  enqueueRun,
  findRunById,
  finishStep,
  findWorkflow,
  recordActivity,
  requeueRun,
  startStep,
} from '../repos/workflows.ts';
import type { WorkflowRun } from '../repos/types.ts';
import { memoriesForAgent } from '../memories/service.ts';
import { getWorkflowDefinition, type StepContext } from './definitions.ts';

export const MAX_ATTEMPTS = 3;

/** Exponential backoff: 30s, 2m, 8m. */
export function backoffMs(attempt: number): number {
  return 30_000 * 4 ** (attempt - 1);
}

export type RunOutcome = {
  runId: string;
  status: 'succeeded' | 'failed' | 'retrying';
  steps: { key: string; status: string }[];
  error?: string;
};

export type RunnerOptions = {
  /** Injected for deterministic tests. */
  now?: () => Date;
  onLog?: (runId: string, message: string) => void;
};

/**
 * Executes one already-claimed run to completion. Steps run in order; each
 * step's status and output are persisted as it goes, so a crashed process
 * leaves a readable trail rather than a black box.
 *
 * A thrown step fails the run. If attempts remain, the run goes back on the
 * queue with backoff instead of being marked failed.
 */
export async function executeRun(db: Db, run: WorkflowRun, opts: RunnerOptions = {}): Promise<RunOutcome> {
  const now = opts.now ?? (() => new Date());
  const workflow = findWorkflow(db, run.workspaceId, run.workflowId);
  if (!workflow) {
    completeRun(db, run.id, { status: 'failed', error: 'workflow no longer exists' });
    return { runId: run.id, status: 'failed', steps: [], error: 'workflow no longer exists' };
  }

  const definition = getWorkflowDefinition(workflow.definitionKey);
  const agent = findWorkspaceAgent(db, run.workspaceId, workflow.workspaceAgentId);

  // Billing gates (LIN-52 W10): every run asks the entitlements service and
  // the spend cap first, and a paused agent stops the run with its visible
  // pause reason instead of executing silently past the cap.
  let blockReason: string | null = null;
  try {
    assertWithinCap(db, run.workspaceId, now());
  } catch (err) {
    blockReason = err instanceof Error ? err.message : String(err);
  }
  if (!blockReason && agent?.status === 'paused') {
    const summary = (agent.config.pausedSummary as string | undefined) ?? 'agent is paused';
    blockReason = summary;
  }
  if (blockReason) {
    completeRun(db, run.id, { status: 'failed', error: blockReason });
    recordActivity(db, {
      workspaceId: run.workspaceId,
      actorType: 'system',
      kind: 'run.blocked',
      summary: `${workflow.name} blocked: ${blockReason}`,
      data: { runId: run.id, workflowId: workflow.id },
    });
    return { runId: run.id, status: 'failed', steps: [], error: blockReason };
  }

  const providers = connectedProviders(db, run.workspaceId);

  // Workflow-level input defaults are overridden by whatever the trigger passed.
  const merged = { ...workflow.inputDefaults, ...run.input };
  const parsed = definition.inputSchema.safeParse(merged);
  if (!parsed.success) {
    const error = `invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`;
    // Bad input is deterministic — retrying cannot help, so fail immediately.
    completeRun(db, run.id, { status: 'failed', error });
    recordActivity(db, {
      workspaceId: run.workspaceId,
      actorType: 'system',
      kind: 'run.failed',
      summary: `${workflow.name} failed validation`,
      data: { runId: run.id, error },
    });
    return { runId: run.id, status: 'failed', steps: [], error };
  }
  const input = parsed.data as Record<string, unknown>;

  // Persistent memory (LIN-53): the same facts the task engine injects, read
  // off the workspace agent's catalog key so both paths stay in sync.
  const memories = agent ? memoriesForAgent(db, run.workspaceId, agent.agentKey) : [];

  const ctx: StepContext = {
    workspaceId: run.workspaceId,
    workflowId: workflow.id,
    runId: run.id,
    agentConfig: agent?.config ?? {},
    // Knowledge grounding (LIN-54): injected once per run alongside agent
    // config, scoped to this agent's visible documents. Retrieval stamps
    // last_used_at so the "last used" surface stays truthful.
    knowledge: agent
      ? groundingForAgent(db, run.workspaceId, agent.agentKey, { now }).blocks
      : groundingForAgent(db, run.workspaceId, null, { now }).blocks,
    memories: memories.map((m) => ({ id: m.id, content: m.content, pinned: m.pinned })),
    connectedProviders: providers,
    steps: {},
    now,
    logger: (message) => opts.onLog?.(run.id, message),
  };

  const stepStatuses: { key: string; status: string }[] = [];

  for (let seq = 0; seq < definition.steps.length; seq++) {
    const step = definition.steps[seq];
    const stepId = startStep(db, run.id, seq, step.key);

    if (step.requiresProvider && !providers.includes(step.requiresProvider)) {
      const reason = `${step.requiresProvider} not connected`;
      finishStep(db, stepId, { status: 'skipped', output: { reason } });
      stepStatuses.push({ key: step.key, status: 'skipped' });
      continue;
    }

    try {
      const result = await step.run(input, ctx);
      if (result.status === 'skipped') {
        finishStep(db, stepId, { status: 'skipped', output: { reason: result.reason } });
        stepStatuses.push({ key: step.key, status: 'skipped' });
        continue;
      }
      if (result.status === 'needs_approval') {
        finishStep(db, stepId, { status: 'skipped', output: { reason: 'awaiting approval', summary: result.summary } });
        createApprovalItem(db, {
          workspaceId: run.workspaceId,
          workspaceAgentId: workflow.workspaceAgentId,
          workflowRunId: run.id,
          workflowRunStepId: stepId,
          actionKind: result.actionKind,
          summary: result.summary,
          payload: result.payload,
        });
        recordActivity(db, {
          workspaceId: run.workspaceId,
          actorType: 'agent',
          actorId: workflow.workspaceAgentId,
          kind: 'approval.requested',
          summary: result.summary,
          data: { runId: run.id, stepKey: step.key },
        });
        stepStatuses.push({ key: step.key, status: 'skipped' });
        continue;
      }
      ctx.steps[step.key] = result.output;
      finishStep(db, stepId, { status: 'succeeded', output: result.output });
      stepStatuses.push({ key: step.key, status: 'succeeded' });
    } catch (err) {
      const error = `step ${step.key}: ${(err as Error).message}`;
      finishStep(db, stepId, { status: 'failed', error });
      stepStatuses.push({ key: step.key, status: 'failed' });

      if (run.attempt < MAX_ATTEMPTS) {
        const runAfter = new Date(now().getTime() + backoffMs(run.attempt)).toISOString();
        requeueRun(db, run.id, runAfter, error);
        return { runId: run.id, status: 'retrying', steps: stepStatuses, error };
      }

      completeRun(db, run.id, { status: 'failed', error });
      recordActivity(db, {
        workspaceId: run.workspaceId,
        actorType: 'agent',
        actorId: workflow.workspaceAgentId,
        kind: 'run.failed',
        summary: `${workflow.name} failed after ${run.attempt} attempts`,
        data: { runId: run.id, error },
      });
      return { runId: run.id, status: 'failed', steps: stepStatuses, error };
    }
  }

  completeRun(db, run.id, {
    status: 'succeeded',
    // Memories are cited in the run output itself, so the user can trace any
    // draft back to the learned fact it applied.
    output:
      memories.length > 0
        ? { ...ctx.steps, appliedMemories: memories.map((m) => ({ id: m.id, content: m.content, pinned: m.pinned })) }
        : ctx.steps,
  });
  recordActivity(db, {
    workspaceId: run.workspaceId,
    actorType: 'agent',
    actorId: workflow.workspaceAgentId,
    kind: 'run.succeeded',
    summary: `${workflow.name} completed`,
    data: { runId: run.id, steps: stepStatuses, appliedMemoryIds: memories.map((m) => m.id) },
  });
  // Metered after success: estimated tokens per executed step land in the
  // append-only ledger, then the spend cap enforces its 80/100 behavior.
  recordUsage(db, {
    workspaceId: run.workspaceId,
    agent: workflow.workspaceAgentId,
    source: 'workflow_run',
    sourceId: run.id,
    tokens: Math.max(1, stepStatuses.filter((s) => s.status !== 'skipped').length) * WORKFLOW_RUN_TOKENS_PER_STEP,
    reason: workflow.name,
  }, now());
  return { runId: run.id, status: 'succeeded', steps: stepStatuses };
}

/** Claims and executes up to `max` due runs. Returns what it processed. */
export async function drainQueue(db: Db, max = 25, opts: RunnerOptions = {}): Promise<RunOutcome[]> {
  const now = opts.now ?? (() => new Date());
  const outcomes: RunOutcome[] = [];
  for (let i = 0; i < max; i++) {
    const run = claimNextRun(db, now().toISOString());
    if (!run) break;
    outcomes.push(await executeRun(db, run, opts));
  }
  return outcomes;
}

/**
 * Enqueue + run inline. Used by the "run now" button and by onboarding's
 * first-run step, where the user is waiting on the result.
 */
export async function runNow(
  db: Db,
  args: { workspaceId: string; workflowId: string; input?: Record<string, unknown>; trigger?: string },
  opts: RunnerOptions = {},
): Promise<{ run: WorkflowRun; outcome: RunOutcome }> {
  const now = opts.now ?? (() => new Date());
  const queued = enqueueRun(db, {
    workspaceId: args.workspaceId,
    workflowId: args.workflowId,
    trigger: args.trigger ?? 'manual',
    input: args.input,
  });
  // Claim this specific run — not merely the next due one, which under load
  // could belong to another workspace entirely.
  const claimed = claimRun(db, queued.id, now().toISOString());
  if (!claimed) {
    // A background worker beat us to it; report its result rather than re-running.
    return { run: findRunById(db, queued.id)!, outcome: { runId: queued.id, status: 'succeeded', steps: [] } };
  }
  const outcome = await executeRun(db, claimed, opts);
  return { run: findRunById(db, queued.id)!, outcome };
}
