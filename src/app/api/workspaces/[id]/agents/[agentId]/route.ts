import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { findWorkspaceAgent, updateWorkspaceAgent } from '@/lib/repos/accounts.ts';
import { parseAgentConfig } from '@/lib/agents/catalog.ts';
import { recordActivity } from '@/lib/repos/workflows.ts';
import { AppError } from '@/lib/repos/types.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string; agentId: string }> };

const patchSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
});

export const GET = handle(async (req, ctx: Ctx) => {
  const { id, agentId } = await ctx.params;
  requireWorkspace(req, id);
  const agent = findWorkspaceAgent(getDb(), id, agentId);
  if (!agent) throw new AppError('not_found', 'agent not found');
  return json(agent);
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  const { id, agentId } = await ctx.params;
  const { user } = requireWorkspace(req, id, 'admin');
  const db = getDb();

  const current = findWorkspaceAgent(db, id, agentId);
  if (!current) throw new AppError('not_found', 'agent not found');

  const parsed = patchSchema.safeParse(await body(req));
  if (!parsed.success) throw new AppError('invalid', 'invalid patch', parsed.error.issues);

  let config: Record<string, unknown> | undefined;
  if (parsed.data.config) {
    try {
      // Merge over current config so a partial patch can't drop fields.
      config = parseAgentConfig(current.agentKey, { ...current.config, ...parsed.data.config });
    } catch (err) {
      throw new AppError('invalid', 'invalid agent config', (err as Error).message);
    }
  }

  const updated = updateWorkspaceAgent(db, id, agentId, { ...parsed.data, config })!;
  recordActivity(db, {
    workspaceId: id,
    actorType: 'user',
    actorId: user.id,
    kind: 'agent.updated',
    summary: `${updated.displayName} updated`,
    data: { status: updated.status },
  });
  return json(updated);
});
