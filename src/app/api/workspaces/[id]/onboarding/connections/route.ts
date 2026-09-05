import { getDb } from '@/lib/db/index.ts';
import { requiredProvidersFor, submitConnections } from '@/lib/onboarding/machine.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  return json(requiredProvidersFor(getDb(), id));
});

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  return json(submitConnections(getDb(), id, await body(req)));
});
