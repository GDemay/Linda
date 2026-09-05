import type { Db } from '../db/index.ts';
import { transaction } from '../db/index.ts';
import {
  countMemberships,
  deleteUser,
  deleteWorkspace,
  findCompanyProfile,
  findUserById,
  findWorkspace,
  listConnections,
  listWorkspaceAgents,
  listWorkspacesForUser,
} from '../repos/accounts.ts';
import { listActivity, listRuns, listWorkflows } from '../repos/workflows.ts';
import { listDocuments } from '../repos/knowledge.ts';
import { listApprovalItems } from '../repos/approvals.ts';
import { AppError } from '../repos/types.ts';

/**
 * Everything a workspace owns, in one JSON document. Connections never
 * include `secretRef` — that field is a pointer to credential storage, and
 * this export is the customer's own copy of their data, not a backup of our
 * secrets.
 */
export function exportWorkspaceData(db: Db, workspaceId: string) {
  const workspace = findWorkspace(db, workspaceId);
  if (!workspace) throw new AppError('not_found', 'workspace not found');

  return {
    exportedAt: new Date().toISOString(),
    workspace,
    companyProfile: findCompanyProfile(db, workspaceId),
    agents: listWorkspaceAgents(db, workspaceId),
    connections: listConnections(db, workspaceId).map(({ ...c }) => c),
    workflows: listWorkflows(db, workspaceId),
    knowledge: listDocuments(db, workspaceId),
    runs: listRuns(db, workspaceId, { limit: 200 }),
    activity: listActivity(db, workspaceId, 200),
    approvals: listApprovalItems(db, workspaceId),
  };
}

/**
 * Deletes the caller's account. A workspace the user solely owns is deleted
 * with it (cascading to every row it owns); a shared workspace just loses
 * this user's membership, so co-workers keep working.
 */
export function deleteAccount(db: Db, userId: string): void {
  const user = findUserById(db, userId);
  if (!user) throw new AppError('not_found', 'user not found');

  transaction(db, () => {
    for (const ws of listWorkspacesForUser(db, userId)) {
      if (ws.role === 'owner' && countMemberships(db, ws.id) === 1) {
        deleteWorkspace(db, ws.id);
      }
    }
    // Any remaining memberships (shared workspaces) cascade off the user row.
    deleteUser(db, userId);
  });
}
