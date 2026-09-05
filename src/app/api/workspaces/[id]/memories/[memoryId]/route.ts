import { getDb } from '@/lib/db/index.ts';
import { editMemory, getWorkspaceMemory, removeMemory } from '@/lib/memories/service.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string; memoryId: string }> };

/** Edit, pin or forget a learned fact. History is the activity log. */

export const GET = handle(async (req, ctx: Ctx) => {
  const { id, memoryId } = await ctx.params;
  requireWorkspace(req, id);
  return json({ memory: getWorkspaceMemory(getDb(), id, memoryId) });
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  const { id, memoryId } = await ctx.params;
  const { user } = requireWorkspace(req, id);
  const memory = editMemory(getDb(), id, memoryId, user.id, await body(req));
  return json({ memory });
});

export const DELETE = handle(async (req, ctx: Ctx) => {
  const { id, memoryId } = await ctx.params;
  const { user } = requireWorkspace(req, id);
  removeMemory(getDb(), id, memoryId, user.id);
  return json({ ok: true });
});
