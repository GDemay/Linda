import { getDb } from '@/lib/db/index.ts';
import { listWorkflows } from '@/lib/repos/workflows.ts';
import { getWorkflowDefinition } from '@/lib/workflows/definitions.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  const workflows = listWorkflows(getDb(), id).map((w) => {
    const def = getWorkflowDefinition(w.definitionKey);
    return { ...w, description: def.description, steps: def.steps.map((s) => ({ key: s.key, title: s.title })) };
  });
  return json({ workflows });
});
