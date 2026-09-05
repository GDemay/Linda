import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { decideApprovalItem, findApprovalItem, listApprovalItems } from '@/lib/repos/approvals.ts';
import { AppError, type ApprovalStatus } from '@/lib/repos/types.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

const STATUSES: ApprovalStatus[] = ['pending', 'approved', 'rejected'];

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as ApprovalStatus | null;
  if (status && !STATUSES.includes(status)) {
    throw new AppError('invalid', 'status must be pending, approved or rejected');
  }
  return json({ approvals: listApprovalItems(getDb(), id, status ?? undefined) });
});

const decideSchema = z.object({
  itemId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
});

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { user } = requireWorkspace(req, id);
  const parsed = decideSchema.safeParse(await body(req));
  if (!parsed.success) throw new AppError('invalid', 'invalid decision', parsed.error.issues);

  const db = getDb();
  // Scope the item to this workspace before deciding — a foreign itemId is a 404.
  const item = findApprovalItem(db, parsed.data.itemId);
  if (!item || item.workspaceId !== id) throw new AppError('not_found', 'approval item not found');

  const decided = decideApprovalItem(db, parsed.data.itemId, {
    status: parsed.data.decision,
    userId: user.id,
  });
  return json(decided);
});
