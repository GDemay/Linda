import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { getWorkspaceTask } from '@/lib/tasks/engine.ts';
import { editTaskDeliverable } from '@/lib/memories/service.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';
import { AppError } from '@/lib/repos/types.ts';

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * The workspace comes from the query string, not the task: authorizing
 * against the caller's membership before any lookup means a task from
 * another tenant is a plain 404, never a leak.
 */
export const GET = handle(async (req, ctx: Ctx) => {
  const { taskId } = await ctx.params;
  const parsed = z.string().min(1).safeParse(new URL(req.url).searchParams.get('workspaceId'));
  if (!parsed.success) throw new AppError('invalid', 'workspaceId is required');
  requireWorkspace(req, parsed.data);

  const task = getWorkspaceTask(getDb(), parsed.data, taskId);
  return json({ task });
});

/**
 * The deliverable-edit surface (LIN-53): the user corrects a task's output
 * and can promote the correction to a persistent memory for that agent.
 */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const { taskId } = await ctx.params;
  const parsed = z.string().min(1).safeParse(new URL(req.url).searchParams.get('workspaceId'));
  if (!parsed.success) throw new AppError('invalid', 'workspaceId is required');
  const { user } = requireWorkspace(req, parsed.data);

  const result = editTaskDeliverable(getDb(), parsed.data, taskId, user.id, await body(req));
  return json({ task: result.task, memory: result.memory });
});
