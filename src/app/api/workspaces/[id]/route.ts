import { getDb } from '@/lib/db/index.ts';
import { getOnboardingStatus } from '@/lib/onboarding/machine.ts';
import { listWorkspaceAgents, listConnections } from '@/lib/repos/accounts.ts';
import { listWorkflows } from '@/lib/repos/workflows.ts';
import { handle, json, requireWorkspace } from '@/lib/http.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { workspace, role } = requireWorkspace(req, id);
  const db = getDb();
  return json({
    workspace,
    role,
    onboarding: getOnboardingStatus(db, id),
    agents: listWorkspaceAgents(db, id),
    connections: listConnections(db, id),
    workflows: listWorkflows(db, id),
  });
});
