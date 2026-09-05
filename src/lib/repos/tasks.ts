import type { Db } from '../db/index.ts';
import { id as newId } from '../ids.ts';
import { AppError, type Task, type TaskStatus } from './types.ts';

type TaskRow = {
  id: string;
  workspace_id: string;
  agent: string;
  category: string;
  title: string;
  input: string;
  output: string | null;
  status: TaskStatus;
  tokens_used: number;
  created_at: string;
  completed_at: string | null;
  error: string | null;
};

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agent: r.agent,
    category: r.category,
    title: r.title,
    input: r.input,
    output: r.output,
    status: r.status,
    tokensUsed: r.tokens_used,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    error: r.error,
  };
}

export type CreateTaskInput = {
  id?: string;
  workspaceId: string;
  agent: string;
  category: string;
  title: string;
  input: string;
  output?: string | null;
  status?: TaskStatus;
  tokensUsed?: number;
  createdAt?: string;
  completedAt?: string | null;
  error?: string | null;
};

export function createTask(db: Db, input: CreateTaskInput): Task {
  const taskId = input.id ?? `task_${Date.now()}_${newId().slice(0, 5)}`;
  const now = input.createdAt ?? new Date().toISOString();
  const status: TaskStatus = input.status ?? 'completed';
  const tokensUsed = input.tokensUsed ?? 0;
  const output = input.output ?? null;
  const completedAt = input.completedAt ?? (status === 'completed' ? now : null);
  const error = input.error ?? null;

  db.prepare(`
    INSERT INTO tasks (
      id, workspace_id, agent, category, title, input, output, status, tokens_used, created_at, completed_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    input.workspaceId,
    input.agent,
    input.category,
    input.title,
    input.input,
    output,
    status,
    tokensUsed,
    now,
    completedAt,
    error,
  );

  return {
    id: taskId,
    workspaceId: input.workspaceId,
    agent: input.agent,
    category: input.category,
    title: input.title,
    input: input.input,
    output,
    status,
    tokensUsed,
    createdAt: now,
    completedAt,
    error,
  };
}

export function findTaskById(db: Db, workspaceId: string, taskId: string): Task | null {
  const row = db.prepare('SELECT * FROM tasks WHERE workspace_id = ? AND id = ?').get(workspaceId, taskId) as
    | TaskRow
    | undefined;
  return row ? toTask(row) : null;
}

export function findTaskGlobal(db: Db, taskId: string): Task | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  return row ? toTask(row) : null;
}

export type ListTasksFilter = {
  agent?: string;
  status?: TaskStatus;
  limit?: number;
};

export function listTasks(db: Db, workspaceId?: string, filter: ListTasksFilter = {}): Task[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (workspaceId) {
    conditions.push('workspace_id = ?');
    params.push(workspaceId);
  }

  if (filter.agent) {
    conditions.push('agent = ?');
    params.push(filter.agent);
  }

  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));

  const rows = db
    .prepare(`SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit) as TaskRow[];

  return rows.map(toTask);
}

export function countTasks(db: Db, workspaceId?: string): number {
  if (workspaceId) {
    const row = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ?').get(workspaceId) as {
      count: number;
    };
    return row.count;
  }
  const row = db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
  return row.count;
}

export function updateTask(
  db: Db,
  taskId: string,
  patch: Partial<Pick<Task, 'status' | 'output' | 'tokensUsed' | 'completedAt' | 'error'>>,
): Task {
  const existing = findTaskGlobal(db, taskId);
  if (!existing) throw new AppError('not_found', `Task ${taskId} not found`);

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.output !== undefined) {
    sets.push('output = ?');
    params.push(patch.output);
  }
  if (patch.tokensUsed !== undefined) {
    sets.push('tokens_used = ?');
    params.push(patch.tokensUsed);
  }
  if (patch.completedAt !== undefined) {
    sets.push('completed_at = ?');
    params.push(patch.completedAt);
  }
  if (patch.error !== undefined) {
    sets.push('error = ?');
    params.push(patch.error);
  }

  if (sets.length > 0) {
    params.push(taskId);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  return findTaskGlobal(db, taskId)!;
}

/** Pre-billing history for the usage-ledger seed (LIN-52): exact token counts. */
export function listTasksWithTokens(
  db: Db,
  workspaceId: string,
): { id: string; agent: string; tokensUsed: number; createdAt: string }[] {
  const rows = db
    .prepare('SELECT id, agent, tokens_used, created_at FROM tasks WHERE workspace_id = ? AND tokens_used > 0')
    .all(workspaceId) as { id: string; agent: string; tokens_used: number; created_at: string }[];
  return rows.map((r) => ({ id: r.id, agent: r.agent, tokensUsed: Number(r.tokens_used), createdAt: r.created_at }));
}
