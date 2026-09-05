import { getDb } from '@/lib/db/index.ts';
import { cancelRun, findRun, listRunSteps } from '@/lib/repos/workflows.ts';
import { AppError } from '@/lib/repos/types.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string; runId: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id, runId } = await ctx.params;
  requireWorkspace(req, id);
  const db = getDb();
  const run = findRun(db, id, runId);
  if (!run) throw new AppError('not_found', 'run not found');
  return json({ run, steps: listRunSteps(db, runId) });
});

/** Cancels a run that has not started yet. */
export const DELETE = handle(async (req, ctx: Ctx) => {
  const { id, runId } = await ctx.params;
  requireWorkspace(req, id);
  const db = getDb();
  if (!findRun(db, id, runId)) throw new AppError('not_found', 'run not found');
  if (!cancelRun(db, id, runId)) throw new AppError('conflict', 'run is no longer queued');
  return json({ ok: true });
});
