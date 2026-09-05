import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { id } from '../ids.ts';
import {
  parseJson,
  type ActivityEvent,
  type RunStep,
  type Workflow,
  type WorkflowRun,
} from './types.ts';

type Row = Record<string, any>;

function toWorkflow(r: Row): Workflow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceAgentId: r.workspace_agent_id,
    definitionKey: r.definition_key,
    name: r.name,
    status: r.status,
    triggerKind: r.trigger_kind,
    triggerConfig: parseJson(r.trigger_config, {}),
    inputDefaults: parseJson(r.input_defaults, {}),
    createdAt: r.created_at,
  };
}

export function createWorkflow(
  db: Db,
  input: {
    workspaceId: string;
    workspaceAgentId: string;
    definitionKey: string;
    name: string;
    triggerKind: 'manual' | 'schedule' | 'event';
    triggerConfig?: Record<string, unknown>;
    inputDefaults?: Record<string, unknown>;
  },
): Workflow {
  const ts = nowIso();
  const wid = id();
  db.prepare(
    `INSERT INTO workflows (id, workspace_id, workspace_agent_id, definition_key, name,
       trigger_kind, trigger_config, input_defaults, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    wid,
    input.workspaceId,
    input.workspaceAgentId,
    input.definitionKey,
    input.name,
    input.triggerKind,
    JSON.stringify(input.triggerConfig ?? {}),
    JSON.stringify(input.inputDefaults ?? {}),
    ts,
    ts,
  );
  return findWorkflow(db, input.workspaceId, wid)!;
}

export function findWorkflow(db: Db, workspaceId: string, workflowId: string): Workflow | null {
  const r = db
    .prepare('SELECT * FROM workflows WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, workflowId) as Row | undefined;
  return r ? toWorkflow(r) : null;
}

export function listWorkflows(db: Db, workspaceId: string): Workflow[] {
  return (
    db.prepare('SELECT * FROM workflows WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId) as Row[]
  ).map(toWorkflow);
}

export function updateWorkflow(
  db: Db,
  workspaceId: string,
  workflowId: string,
  patch: { status?: 'active' | 'paused'; name?: string; inputDefaults?: Record<string, unknown> },
): Workflow | null {
  const current = findWorkflow(db, workspaceId, workflowId);
  if (!current) return null;
  db.prepare('UPDATE workflows SET status = ?, name = ?, input_defaults = ?, updated_at = ? WHERE id = ?').run(
    patch.status ?? current.status,
    patch.name ?? current.name,
    JSON.stringify(patch.inputDefaults ?? current.inputDefaults),
    nowIso(),
    workflowId,
  );
  return findWorkflow(db, workspaceId, workflowId);
}

// -------------------------------------------------------------------- runs

function toRun(r: Row): WorkflowRun {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workflowId: r.workflow_id,
    status: r.status,
    trigger: r.trigger,
    input: parseJson(r.input, {}),
    output: r.output ? parseJson<Record<string, unknown>>(r.output, {}) : null,
    error: r.error ?? null,
    attempt: Number(r.attempt),
    runAfter: r.run_after,
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
    createdAt: r.created_at,
  };
}

export function enqueueRun(
  db: Db,
  input: {
    workspaceId: string;
    workflowId: string;
    trigger: string;
    input?: Record<string, unknown>;
    runAfter?: string;
    attempt?: number;
  },
): WorkflowRun {
  const rid = id();
  db.prepare(
    `INSERT INTO workflow_runs (id, workspace_id, workflow_id, status, trigger, input, attempt, run_after, created_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
  ).run(
    rid,
    input.workspaceId,
    input.workflowId,
    input.trigger,
    JSON.stringify(input.input ?? {}),
    input.attempt ?? 1,
    input.runAfter ?? nowIso(),
    nowIso(),
  );
  return findRunById(db, rid)!;
}

export function findRunById(db: Db, runId: string): WorkflowRun | null {
  const r = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId) as Row | undefined;
  return r ? toRun(r) : null;
}

export function findRun(db: Db, workspaceId: string, runId: string): WorkflowRun | null {
  const r = db
    .prepare('SELECT * FROM workflow_runs WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, runId) as Row | undefined;
  return r ? toRun(r) : null;
}

export function listRuns(
  db: Db,
  workspaceId: string,
  opts: { workflowId?: string; limit?: number } = {},
): WorkflowRun[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.workflowId
    ? db
        .prepare(
          'SELECT * FROM workflow_runs WHERE workspace_id = ? AND workflow_id = ? ORDER BY created_at DESC LIMIT ?',
        )
        .all(workspaceId, opts.workflowId, limit)
    : db
        .prepare('SELECT * FROM workflow_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(workspaceId, limit);
  return (rows as Row[]).map(toRun);
}

/**
 * Atomically moves one due run from `queued` to `running` and returns it.
 * The conditional UPDATE is the lock: two concurrent workers racing on the
 * same row means exactly one sees `changes === 1`.
 */
export function claimNextRun(db: Db, now = nowIso()): WorkflowRun | null {
  for (;;) {
    const candidate = db
      .prepare(
        "SELECT id FROM workflow_runs WHERE status = 'queued' AND run_after <= ? ORDER BY run_after ASC LIMIT 1",
      )
      .get(now) as Row | undefined;
    if (!candidate) return null;

    const res = db
      .prepare("UPDATE workflow_runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'")
      .run(now, candidate.id);
    if (Number(res.changes ?? 0) === 1) return findRunById(db, candidate.id);
    // Lost the race; another worker took it. Try the next one.
  }
}

/**
 * Claims one specific run by id. Returns null if another worker got there
 * first (or it is no longer queued), so callers can't double-execute.
 */
export function claimRun(db: Db, runId: string, now = nowIso()): WorkflowRun | null {
  const res = db
    .prepare("UPDATE workflow_runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'")
    .run(now, runId);
  return Number(res.changes ?? 0) === 1 ? findRunById(db, runId) : null;
}

export function completeRun(
  db: Db,
  runId: string,
  result: { status: 'succeeded' | 'failed' | 'cancelled'; output?: unknown; error?: string },
): void {
  db.prepare('UPDATE workflow_runs SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?').run(
    result.status,
    result.output === undefined ? null : JSON.stringify(result.output),
    result.error ?? null,
    nowIso(),
    runId,
  );
}

/** Puts a failed run back on the queue with a later `run_after` (backoff). */
export function requeueRun(db: Db, runId: string, runAfter: string, error: string): void {
  db.prepare(
    "UPDATE workflow_runs SET status = 'queued', run_after = ?, attempt = attempt + 1, error = ?, started_at = NULL WHERE id = ?",
  ).run(runAfter, error, runId);
}

export function cancelRun(db: Db, workspaceId: string, runId: string): boolean {
  const res = db
    .prepare(
      "UPDATE workflow_runs SET status = 'cancelled', finished_at = ? WHERE workspace_id = ? AND id = ? AND status = 'queued'",
    )
    .run(nowIso(), workspaceId, runId);
  return Number(res.changes ?? 0) === 1;
}

// --------------------------------------------------------------- run steps

function toStep(r: Row): RunStep {
  return {
    id: r.id,
    runId: r.run_id,
    seq: Number(r.seq),
    stepKey: r.step_key,
    status: r.status,
    output: r.output ? parseJson<unknown>(r.output, null) : null,
    error: r.error ?? null,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
  };
}

export function startStep(db: Db, runId: string, seq: number, stepKey: string): string {
  const sid = id();
  db.prepare(
    `INSERT INTO workflow_run_steps (id, run_id, seq, step_key, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)
     ON CONFLICT(run_id, seq) DO UPDATE SET
       id=excluded.id, step_key=excluded.step_key, status='running',
       started_at=excluded.started_at, finished_at=NULL, output=NULL, error=NULL`,
  ).run(sid, runId, seq, stepKey, nowIso());
  const r = db.prepare('SELECT id FROM workflow_run_steps WHERE run_id = ? AND seq = ?').get(runId, seq) as Row;
  return r.id as string;
}

export function finishStep(
  db: Db,
  stepId: string,
  result: { status: 'succeeded' | 'failed' | 'skipped'; output?: unknown; error?: string },
): void {
  db.prepare('UPDATE workflow_run_steps SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?').run(
    result.status,
    result.output === undefined ? null : JSON.stringify(result.output),
    result.error ?? null,
    nowIso(),
    stepId,
  );
}

export function listRunSteps(db: Db, runId: string): RunStep[] {
  return (
    db.prepare('SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY seq ASC').all(runId) as Row[]
  ).map(toStep);
}

// ---------------------------------------------------------------- activity

export function recordActivity(
  db: Db,
  input: {
    workspaceId: string;
    actorType: 'user' | 'agent' | 'system';
    actorId?: string | null;
    kind: string;
    summary: string;
    data?: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO activity_events (id, workspace_id, actor_type, actor_id, kind, summary, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id(),
    input.workspaceId,
    input.actorType,
    input.actorId ?? null,
    input.kind,
    input.summary,
    JSON.stringify(input.data ?? {}),
    nowIso(),
  );
}

export function listActivity(db: Db, workspaceId: string, limit = 50): ActivityEvent[] {
  const rows = db
    .prepare('SELECT * FROM activity_events WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(workspaceId, Math.min(Math.max(limit, 1), 200)) as Row[];
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    actorType: r.actor_type,
    actorId: r.actor_id ?? null,
    kind: r.kind,
    summary: r.summary,
    data: parseJson(r.data, {}),
    createdAt: r.created_at,
  }));
}

/** Pre-billing history for the usage-ledger seed (LIN-52): one estimate per finished run. */
export function listSucceededRunUsage(
  db: Db,
  workspaceId: string,
): { runId: string; workspaceAgentId: string; stepCount: number; createdAt: string }[] {
  const rows = db
    .prepare(
      `SELECT r.id AS run_id, r.created_at, w.workspace_agent_id,
              (SELECT COUNT(*) FROM workflow_run_steps s WHERE s.run_id = r.id) AS step_count
       FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
       WHERE r.workspace_id = ? AND r.status = 'succeeded'`,
    )
    .all(workspaceId) as Row[];
  return rows.map((r) => ({
    runId: r.run_id,
    workspaceAgentId: r.workspace_agent_id,
    stepCount: Number(r.step_count),
    createdAt: r.created_at,
  }));
}
