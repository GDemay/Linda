import { z } from 'zod';
import { getDb } from '@/lib/db/index.ts';
import { billingOverview } from '@/lib/billing/service.ts';
import { setMonthlyLimit } from '@/lib/billing/metering.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';
import { AppError } from '@/lib/repos/types.ts';

/**
 * Billing surface (LIN-52 W10/W11): plan entitlements, the month's usage
 * meter derived from the append-only ledger, the hard spend cap, and each
 * agent's pause reason. Handlers stay thin; logic is lib/billing.
 */

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  return json(billingOverview(getDb(), id));
});

const putCap = z.object({
  /** The user-set hard monthly limit in credits. 0 freezes execution. */
  monthlyLimitCredits: z.number().finite().min(0).max(100_000_000),
});

export const PUT = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  const parsed = putCap.safeParse(await body(req));
  if (!parsed.success) throw new AppError('invalid', 'invalid spend cap', parsed.error.issues);
  setMonthlyLimit(getDb(), id, parsed.data.monthlyLimitCredits);
  return json(billingOverview(getDb(), id));
});
