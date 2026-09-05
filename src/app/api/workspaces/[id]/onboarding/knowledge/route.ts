import { getDb } from '@/lib/db/index.ts';
import { scopingOptions } from '@/lib/knowledge/index.ts';
import { submitKnowledge } from '@/lib/onboarding/machine.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

/** Hired agents offered as per-agent scoping options for the wizard step. */
export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  return json({ scoping: scopingOptions(getDb(), id) });
});

/** Wizard step 4 (LIN-54): add documents and advance, or skip outright. */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  return json(await submitKnowledge(getDb(), id, await body(req)));
});
