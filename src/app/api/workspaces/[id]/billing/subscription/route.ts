import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { LocalBillingProvider } from '@/lib/billing/provider.ts';
import { billingOverview } from '@/lib/billing/service.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';
import { AppError } from '@/lib/repos/types.ts';

/**
 * Local plan changes (LIN-52): subscribe, change plan, cancel. The provider
 * interface mirrors what Stripe will need, so the swap later is internal.
 */

type Ctx = { params: Promise<{ id: string }> };

const postPlan = z.object({ plan: z.enum(['starter', 'team', 'scale']) });

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  const parsed = postPlan.safeParse(await body(req));
  if (!parsed.success) throw new AppError('invalid', 'invalid plan', parsed.error.issues);
  const db = getDb();
  const existing = billingOverview(db, id).subscription;
  const provider = LocalBillingProvider;
  const subscription = existing
    ? provider.changePlan(db, id, parsed.data.plan)
    : provider.createSubscription(db, id, parsed.data.plan);
  return json({ subscription }, { status: existing ? 200 : 201 });
});

export const DELETE = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  const subscription = LocalBillingProvider.cancel(getDb(), id);
  return json({ subscription });
});
