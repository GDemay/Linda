import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { recordEvent } from '@/lib/analytics/events.ts';
import { startCheckout } from '@/lib/billing/checkout.ts';
import { publicOrigin, body, handle, json, requireWorkspace } from '@/lib/http.ts';
import { AppError } from '@/lib/repos/types.ts';

/**
 * Starts a paid checkout (LIN-131). The provider is env-configurable
 * (CHECKOUT_PROVIDER); 'none' answers 402 so the upgrade page can say
 * checkout isn't live on this deployment instead of pretending.
 */

type Ctx = { params: Promise<{ id: string }> };

const postCheckout = z.object({ plan: z.enum(['starter', 'team', 'scale']) });

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  const parsed = postCheckout.safeParse(await body(req));
  if (!parsed.success) throw new AppError('invalid', 'invalid plan', parsed.error.issues);
  const db = getDb();
  const checkout = await startCheckout(db, { workspaceId: id, plan: parsed.data.plan, origin: publicOrigin(req) });
  recordEvent(db, 'checkout_start', { workspaceId: id, plan: parsed.data.plan, provider: checkout.provider });
  return json(checkout, { status: checkout.provider === 'local' ? 200 : 201 });
});
