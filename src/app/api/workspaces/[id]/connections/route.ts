import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { connectProvider, disconnectProvider, listConnections } from '@/lib/repos/accounts.ts';
import { recordActivity } from '@/lib/repos/workflows.ts';
import { AppError } from '@/lib/repos/types.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

const connectBody = z.object({
  provider: z.string().trim().min(1).max(60),
  externalAccount: z.string().trim().max(200).optional(),
  secretRef: z.string().trim().max(200).optional(),
});

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  return json({ connections: listConnections(getDb(), id) });
});

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { user } = requireWorkspace(req, id, 'admin');
  const parsed = connectBody.safeParse(await body(req));
  if (!parsed.success) throw new AppError('invalid', 'invalid connection', parsed.error.issues);

  const db = getDb();
  const connection = connectProvider(db, { workspaceId: id, ...parsed.data });
  recordActivity(db, {
    workspaceId: id,
    actorType: 'user',
    actorId: user.id,
    kind: 'connection.added',
    summary: `Connected ${parsed.data.provider}`,
  });
  return json(connection, { status: 201 });
});

export const DELETE = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { user } = requireWorkspace(req, id, 'admin');
  const provider = new URL(req.url).searchParams.get('provider');
  if (!provider) throw new AppError('invalid', 'provider query parameter is required');

  const db = getDb();
  disconnectProvider(db, id, provider);
  recordActivity(db, {
    workspaceId: id,
    actorType: 'user',
    actorId: user.id,
    kind: 'connection.removed',
    summary: `Disconnected ${provider}`,
  });
  return json({ ok: true });
});
