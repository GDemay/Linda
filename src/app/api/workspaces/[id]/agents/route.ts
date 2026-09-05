import { getDb } from '@/lib/db/index.ts';
import { listWorkspaceAgents } from '@/lib/repos/accounts.ts';
import { hireAgents } from '@/lib/onboarding/machine.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  return json({ agents: listWorkspaceAgents(getDb(), id) });
});

/** Hiring more agents after onboarding uses the same idempotent path. */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  return json(hireAgents(getDb(), id, await body(req)), { status: 201 });
});
