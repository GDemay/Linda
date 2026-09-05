import { getDb } from '@/lib/db/index.ts';
import { hireAgents } from '@/lib/onboarding/machine.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  return json(hireAgents(getDb(), id, await body(req)));
});
