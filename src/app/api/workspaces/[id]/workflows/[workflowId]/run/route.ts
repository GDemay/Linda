import { getDb } from '@/lib/db/index.ts';
import { findWorkflow, listRunSteps } from '@/lib/repos/workflows.ts';
import { runNow } from '@/lib/workflows/runner.ts';
import { AppError } from '@/lib/repos/types.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string; workflowId: string }> };

/** Body is optional — `{"input": {...}}` overrides the workflow's defaults. */
async function optionalInput(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError('invalid', 'expected a JSON body');
  }
  const input = (parsed as { input?: unknown })?.input;
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('invalid', 'input must be an object');
  }
  return input as Record<string, unknown>;
}

export const POST = handle(async (req, ctx: Ctx) => {
  const { id, workflowId } = await ctx.params;
  requireWorkspace(req, id);
  const db = getDb();

  const workflow = findWorkflow(db, id, workflowId);
  if (!workflow) throw new AppError('not_found', 'workflow not found');
  if (workflow.status === 'paused') throw new AppError('conflict', 'workflow is paused');

  const input = await optionalInput(req);
  const { run, outcome } = await runNow(db, { workspaceId: id, workflowId, input, trigger: 'manual' });
  // 200, not 202: runNow executes inline, so the result is already final.
  return json({ run, outcome, steps: listRunSteps(db, run.id) });
});
