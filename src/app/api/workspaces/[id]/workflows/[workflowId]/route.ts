import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { findWorkflow, listRuns, updateWorkflow } from '@/lib/repos/workflows.ts';
import { getWorkflowDefinition } from '@/lib/workflows/definitions.ts';
import { AppError } from '@/lib/repos/types.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string; workflowId: string }> };

const patchSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  inputDefaults: z.record(z.unknown()).optional(),
});

export const GET = handle(async (req, ctx: Ctx) => {
  const { id, workflowId } = await ctx.params;
  requireWorkspace(req, id);
  const db = getDb();
  const workflow = findWorkflow(db, id, workflowId);
  if (!workflow) throw new AppError('not_found', 'workflow not found');
  const def = getWorkflowDefinition(workflow.definitionKey);
  return json({
    workflow,
    description: def.description,
    steps: def.steps.map((s) => ({ key: s.key, title: s.title, requiresProvider: s.requiresProvider ?? null })),
    recentRuns: listRuns(db, id, { workflowId, limit: 20 }),
  });
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  const { id, workflowId } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  const parsed = patchSchema.safeParse(await body(req));
  if (!parsed.success) throw new AppError('invalid', 'invalid patch', parsed.error.issues);
  const updated = updateWorkflow(getDb(), id, workflowId, parsed.data);
  if (!updated) throw new AppError('not_found', 'workflow not found');
  return json(updated);
});
