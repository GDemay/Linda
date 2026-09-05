import { getDb } from '@/lib/db/index.ts';
import { aggregateFunnel, recordFunnelStepAbandoned, workspaceFunnel } from '@/lib/analytics/funnel.ts';
import { body, handle, json, requireWorkspace } from '@/lib/http.ts';
import type { OnboardingStep } from '@/lib/repos/types.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id);
  const url = new URL(req.url);
  const includeAggregate = url.searchParams.get('aggregate') === 'true';
  const thresholdParam = url.searchParams.get('abandonedThresholdMs');
  const abandonedThresholdMs = thresholdParam ? Number(thresholdParam) : undefined;

  const funnel = workspaceFunnel(getDb(), id, { abandonedThresholdMs });
  if (includeAggregate) {
    return json({ ...funnel, aggregate: aggregateFunnel(getDb(), { abandonedThresholdMs }) });
  }
  return json(funnel);
});

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  requireWorkspace(req, id, 'admin');
  const payload = await body<{ action?: string; step?: OnboardingStep; reason?: string }>(req);

  if (payload.action === 'abandon') {
    recordFunnelStepAbandoned(getDb(), id, payload.step, payload.reason);
  }
  return json(workspaceFunnel(getDb(), id));
});
