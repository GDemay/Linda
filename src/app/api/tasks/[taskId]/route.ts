import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { getWorkspaceTask } from '@/lib/tasks/engine.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';
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
