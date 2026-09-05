import { getDb } from '@/lib/db/index.ts';
import { removeDocument } from '@/lib/knowledge/index.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string; documentId: string }> };

/**
 * Deletes a document and its derived chunks. The response says so in plain
 * language — deletion reversibility is a GTM promise (LIN-14), not just a 204.
 */
export const DELETE = handle(async (req, ctx: Ctx) => {
  const { id, documentId } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  return json(removeDocument(getDb(), id, documentId));
});
