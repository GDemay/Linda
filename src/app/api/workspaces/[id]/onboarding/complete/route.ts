import { getDb } from '@/lib/db/index.ts';
import { completeOnboarding } from '@/lib/onboarding/machine.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  return json(await completeOnboarding(getDb(), id));
});
