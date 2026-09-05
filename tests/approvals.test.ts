import { describe, expect, it } from 'vitest';
import { db, newAccount, onboard, fixedClock } from './helpers.ts';
import {
  connectProvider,
  findConnection,
  findWorkspaceAgentByKey,
  grantWriteAccess,
} from '../src/lib/repos/accounts.ts';
import {
  createApprovalItem,
  decideApprovalItem,
  listApprovalItems,
  requiresApproval,
} from '../src/lib/repos/approvals.ts';
import { runNow } from '../src/lib/workflows/runner.ts';
import { listWorkflows } from '../src/lib/repos/workflows.ts';

function workflowFor(d: ReturnType<typeof db>, workspaceId: string, key: string) {
  const wf = listWorkflows(d, workspaceId).find((w) => w.definitionKey === key);
  if (!wf) throw new Error(`no workflow ${key}`);
  return wf;
}

describe('approval-rule model', () => {
  it('requiresApproval gates everything except the autonomous dial position', () => {
    expect(requiresApproval('suggest')).toBe(true);
    expect(requiresApproval('approve')).toBe(true);
    expect(requiresApproval('autonomous')).toBe(false);
  });

  it('creates, lists and decides a pending approval item', async () => {
    const d = db();
    const { workspace, user } = await newAccount(d);
    const workspaceId = workspace.id;
    await onboard(d, workspaceId, { agents: ['marketing'] });
    const agent = findWorkspaceAgentByKey(d, workspaceId, 'marketing')!;

    const item = createApprovalItem(d, {
      workspaceId,
      workspaceAgentId: agent.id,
      actionKind: 'post',
      summary: 'Publish "launch" to linkedin',
      payload: { channel: 'linkedin' },
    });
    expect(item.status).toBe('pending');
    expect(listApprovalItems(d, workspaceId, 'pending')).toHaveLength(1);

    const decided = decideApprovalItem(d, item.id, { status: 'approved', userId: user.id });
    expect(decided.status).toBe('approved');
    expect(decided.decidedByUserId).toBe(user.id);
    expect(listApprovalItems(d, workspaceId, 'pending')).toHaveLength(0);
  });

  it('rejects deciding an item twice', async () => {
    const d = db();
    const { workspace, user } = await newAccount(d);
    const workspaceId = workspace.id;
    await onboard(d, workspaceId, { agents: ['marketing'] });
    const agent = findWorkspaceAgentByKey(d, workspaceId, 'marketing')!;
    const item = createApprovalItem(d, {
      workspaceId,
      workspaceAgentId: agent.id,
      actionKind: 'post',
      summary: 'Publish "launch" to linkedin',
    });
    decideApprovalItem(d, item.id, { status: 'approved', userId: user.id });
    expect(() => decideApprovalItem(d, item.id, { status: 'rejected', userId: user.id })).toThrow(/already/);
  });

  it('a workflow step gated by the autonomy dial lands in the approval inbox', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const workspaceId = workspace.id;
    await onboard(d, workspaceId, { agents: ['marketing'], connect: ['linkedin'] });
    const wf = workflowFor(d, workspaceId, 'social_post');

    await runNow(
      d,
      { workspaceId, workflowId: wf.id, input: { channel: 'linkedin', topic: 'launch' } },
      { now: fixedClock() },
    );

    const items = listApprovalItems(d, workspaceId, 'pending');
    expect(items).toHaveLength(1);
    expect(items[0].actionKind).toBe('post');
    expect(items[0].summary).toMatch(/launch/);
  });

  it('keeps connections read-only until onboarding (the trust contract) is complete', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    const workspaceId = workspace.id;
    connectProvider(d, { workspaceId, provider: 'linkedin' });
    expect(findConnection(d, workspaceId, 'linkedin')!.accessLevel).toBe('read_only');
    expect(() => grantWriteAccess(d, workspaceId, 'linkedin')).toThrow(/trust contract/);

    await onboard(d, workspaceId, { connect: ['linkedin'] });
    const granted = grantWriteAccess(d, workspaceId, 'linkedin');
    expect(granted.accessLevel).toBe('read_write');
  });
});
