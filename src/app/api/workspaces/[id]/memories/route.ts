import { getDb } from '@/lib/db/index.ts';
import { addMemory, listWorkspaceMemories } from '@/lib/memories/service.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';
import { AppError } from '@/lib/repos/types.ts';

type Ctx = { params: Promise<{ id: string }> };

/**
 * The inspectable surface of agent memory (LIN-53): list what an agent has
 * learned, teach it a new fact. Per-item edit/delete live one path down.
 */

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  const agent = new URL(req.url).searchParams.get('agent') ?? undefined;
  return json({ memories: listWorkspaceMemories(getDb(), id, agent) });
});

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { user } = requireWorkspace(req, id);
  const payload = await body<Record<string, unknown>>(req);
  if (typeof payload?.agent !== 'string' || payload.agent.length === 0) {
    throw new AppError('invalid', 'agent is required');
  }
  const memory = addMemory(getDb(), id, user.id, payload);
  return json({ memory }, { status: 201 });
});
