import { getDb } from '@/lib/db/index.ts';
import { listRuns } from '@/lib/repos/workflows.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  return json({
    runs: listRuns(getDb(), id, {
      workflowId: url.searchParams.get('workflowId') ?? undefined,
      limit: Number.isFinite(limit) ? limit : 50,
    }),
  });
});
