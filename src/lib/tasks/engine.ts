import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { getAgent, isAgentKey } from '../agents/catalog.ts';
import { findWorkspace } from '../repos/accounts.ts';
import { recordActivity } from '../repos/workflows.ts';
import { createTask, findTaskById, listTasks } from '../repos/tasks.ts';
import { AppError, type Task, type TaskStatus } from '../repos/types.ts';
import { findTemplate, templatesFor } from './templates.ts';

/**
 * Autonomous task execution engine (LIN-36). A task is a single instruction
 * given to one agent; the engine resolves it against a template and finishes
 * it synchronously, persisting the result in SQLite. Longer, multi-step work
 * with integrations goes through lib/workflows instead.
 */

export const createTaskSchema = z.object({
  workspaceId: z.string().min(1),
  agent: z.string().min(1),
  /** Template key; defaults to the agent's first template. */
  template: z.string().min(1).optional(),
  /** Overrides the template title, e.g. when the dashboard shows the user's own words. */
  title: z.string().min(1).max(200).optional(),
  input: z.string().min(1).max(4000),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export function runTask(db: Db, raw: unknown): Task {
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid task', parsed.error.issues);
  const { workspaceId, agent } = parsed.data;

  const workspace = findWorkspace(db, workspaceId);
  if (!workspace) throw new AppError('not_found', `workspace ${workspaceId} not found`);

  if (!isAgentKey(agent)) {
    throw new AppError('invalid', `unknown agent: ${agent}`);
  }
  const def = getAgent(agent);

  const available = templatesFor(agent);
  if (available.length === 0) {
    throw new AppError('invalid', `agent ${agent} has no task templates`);
  }

  const template = parsed.data.template ? findTemplate(agent, parsed.data.template) : available[0];
  if (!template) {
    throw new AppError('invalid', `agent ${agent} has no template '${parsed.data.template}'`);
  }

  const output = template.render({ persona: def.persona, input: parsed.data.input });

  const task = createTask(db, {
    workspaceId,
    agent,
    category: template.category,
    title: parsed.data.title ?? template.title,
    input: parsed.data.input,
    output,
    status: 'completed',
    tokensUsed: template.tokens,
  });

  recordActivity(db, {
    workspaceId,
    actorType: 'agent',
    kind: 'task.completed',
    summary: `${def.persona} completed: ${task.title}`,
    data: { taskId: task.id, agent, template: template.key, tokensUsed: template.tokens },
  });

  return task;
}

/** Lists a workspace's tasks, newest first. Tenant-scoped by construction. */
export function listWorkspaceTasks(
  db: Db,
  workspaceId: string,
  filter: { agent?: string; status?: TaskStatus; limit?: number } = {},
): Task[] {
  return listTasks(db, workspaceId, filter);
}

/** Fetches one task, never leaking another workspace's task (404 instead). */
export function getWorkspaceTask(db: Db, workspaceId: string, taskId: string): Task {
  const task = findTaskById(db, workspaceId, taskId);
  if (!task) throw new AppError('not_found', `task ${taskId} not found`);
  return task;
}
