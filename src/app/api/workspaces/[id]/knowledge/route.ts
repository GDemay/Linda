import { getDb } from '@/lib/db/index.ts';
import { knowledgeSummary, scopingOptions, uploadDocument } from '@/lib/knowledge/index.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

/** Everything the knowledge surface needs: documents, totals, scoping options. */
export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  return json({ ...knowledgeSummary(getDb(), id), scoping: scopingOptions(getDb(), id) });
});

/** Upload one document (pasted content, file text, or a URL to fetch). */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  const result = await uploadDocument(getDb(), id, await body(req));
  return json(result, { status: 201 });
});
