import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { id } from '../ids.ts';
import { AppError, parseJson, type ActionKind, type ApprovalItem, type ApprovalStatus } from './types.ts';

type Row = Record<string, any>;

function toApprovalItem(r: Row): ApprovalItem {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceAgentId: r.workspace_agent_id,
    workflowRunId: r.workflow_run_id ?? null,
    workflowRunStepId: r.workflow_run_step_id ?? null,
    actionKind: r.action_kind,
    summary: r.summary,
    payload: parseJson(r.payload, {}),
    status: r.status,
    decidedByUserId: r.decided_by_user_id ?? null,
    decidedAt: r.decided_at ?? null,
    createdAt: r.created_at,
  };
}

/**
 * The autonomy dial is per-agent, not per-tool (design v1.1). It decides
 * whether an action needs a human decision at all; `action_kind` on the
 * created item is descriptive metadata for the inbox UI, not a second gate.
 */
export function requiresApproval(autonomy: unknown): boolean {
  return autonomy !== 'autonomous';
}

export function createApprovalItem(
  db: Db,
  input: {
    workspaceId: string;
    workspaceAgentId: string;
    workflowRunId?: string;
    workflowRunStepId?: string;
    actionKind: ActionKind;
    summary: string;
    payload?: Record<string, unknown>;
  },
): ApprovalItem {
  const itemId = id();
  db.prepare(
    `INSERT INTO approval_items
       (id, workspace_id, workspace_agent_id, workflow_run_id, workflow_run_step_id,
        action_kind, summary, payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    itemId,
    input.workspaceId,
    input.workspaceAgentId,
    input.workflowRunId ?? null,
    input.workflowRunStepId ?? null,
    input.actionKind,
    input.summary,
    JSON.stringify(input.payload ?? {}),
    nowIso(),
  );
  return findApprovalItem(db, itemId)!;
}

export function findApprovalItem(db: Db, itemId: string): ApprovalItem | null {
  const r = db.prepare('SELECT * FROM approval_items WHERE id = ?').get(itemId) as Row | undefined;
  return r ? toApprovalItem(r) : null;
}

export function listApprovalItems(db: Db, workspaceId: string, status?: ApprovalStatus): ApprovalItem[] {
  const rows = status
    ? (db
        .prepare('SELECT * FROM approval_items WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC')
        .all(workspaceId, status) as Row[])
    : (db
        .prepare('SELECT * FROM approval_items WHERE workspace_id = ? ORDER BY created_at DESC')
        .all(workspaceId) as Row[]);
  return rows.map(toApprovalItem);
}

/** Approve or reject a pending item. Already-decided items cannot be redecided. */
export function decideApprovalItem(
  db: Db,
  itemId: string,
  decision: { status: 'approved' | 'rejected'; userId: string },
): ApprovalItem {
  const current = findApprovalItem(db, itemId);
  if (!current) throw new AppError('not_found', 'approval item not found');
  if (current.status !== 'pending') {
    throw new AppError('conflict', `approval item already ${current.status}`);
  }
  db.prepare(
    'UPDATE approval_items SET status = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ?',
  ).run(decision.status, decision.userId, nowIso(), itemId);
  return findApprovalItem(db, itemId)!;
}
