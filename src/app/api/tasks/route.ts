import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { listWorkspaceTasks, runTask } from '@/lib/tasks/engine.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';
import { AppError } from '@/lib/repos/types.ts';

/**
 * Top-level task surface (LIN-36). The workspace is passed explicitly — in
 * the body for POST, as a query param for GET — and every call is still
 * authorized against that workspace's membership.
 */

const workspaceRef = z.object({ workspaceId: z.string().min(1) });

function parseOr422<T extends z.ZodType>(schema: T, raw: unknown, message: string): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', message, parsed.error.issues);
  return parsed.data;
}

export const POST = handle(async (req) => {
  const payload = await body<Record<string, unknown>>(req);
  const { workspaceId } = parseOr422(workspaceRef, payload, 'workspaceId is required');
  requireWorkspace(req, workspaceId);

  const task = runTask(getDb(), payload);
  return json({ task }, { status: 201 });
});

const listQuery = z.object({
  workspaceId: z.string().min(1),
  agent: z.string().min(1).optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const query = parseOr422(listQuery, Object.fromEntries(url.searchParams.entries()), 'invalid query');
  requireWorkspace(req, query.workspaceId);

  const tasks = listWorkspaceTasks(getDb(), query.workspaceId, {
    agent: query.agent,
    status: query.status,
    limit: query.limit,
  });
  return json({ tasks });
});
