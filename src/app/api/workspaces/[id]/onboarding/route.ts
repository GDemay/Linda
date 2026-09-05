import { getDb } from '@/lib/db/index.ts';
import { getOnboardingStatus } from '@/lib/onboarding/machine.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  return json(getOnboardingStatus(getDb(), id));
});
