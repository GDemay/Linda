import { getDb } from '@/lib/db/index.ts';
import { listActivity } from '@/lib/repos/workflows.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50);
  return json({ events: listActivity(getDb(), id, Number.isFinite(limit) ? limit : 50) });
});
