import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { id as newId } from '../ids.ts';
import { AppError, type AgentMemory } from './types.ts';

/**
 * Persistence for agent memory (LIN-53). Scoped by (workspace_id, agent_key)
 * so both execution paths — the task engine, which knows the catalog key, and
 * the workflow runner, which resolves it off the workspace agent row — read
 * the same facts. Pure DB access; behavior lives in lib/memories/service.ts.
 */

type MemoryRow = {
  id: string;
  workspace_id: string;
  agent_key: string;
  content: string;
  pinned: number;
  source: 'manual' | 'correction';
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function toMemory(r: MemoryRow): AgentMemory {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agentKey: r.agent_key,
    content: r.content,
    pinned: r.pinned === 1,
    source: r.source,
    createdByUserId: r.created_by_user_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type CreateMemoryInput = {
  workspaceId: string;
  agentKey: string;
  content: string;
  pinned?: boolean;
  source?: 'manual' | 'correction';
  createdByUserId?: string | null;
};

export function createMemory(db: Db, input: CreateMemoryInput): AgentMemory {
  const memoryId = `mem_${newId()}`;
  const now = nowIso();
  db.prepare(`
    INSERT INTO agent_memories (id, workspace_id, agent_key, content, pinned, source, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    memoryId,
    input.workspaceId,
    input.agentKey,
    input.content,
    input.pinned ? 1 : 0,
    input.source ?? 'manual',
    input.createdByUserId ?? null,
    now,
    now,
  );
  return findMemoryGlobal(db, memoryId)!;
}

/** Tenant-scoped by construction: another workspace's memory is invisible. */
export function findMemoryById(db: Db, workspaceId: string, memoryId: string): AgentMemory | null {
  const row = db
    .prepare('SELECT * FROM agent_memories WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, memoryId) as MemoryRow | undefined;
  return row ? toMemory(row) : null;
}

function findMemoryGlobal(db: Db, memoryId: string): AgentMemory | null {
  const row = db.prepare('SELECT * FROM agent_memories WHERE id = ?').get(memoryId) as MemoryRow | undefined;
  return row ? toMemory(row) : null;
}

/**
 * Pinned first, then newest — what an agent should weigh most heavily is
 * what its workspace explicitly asked it never to forget.
 */
export function listMemories(db: Db, workspaceId: string, agentKey?: string): AgentMemory[] {
  const rows = (
    agentKey
      ? db
          .prepare(
            `SELECT * FROM agent_memories WHERE workspace_id = ? AND agent_key = ?
             ORDER BY pinned DESC, created_at DESC, rowid DESC`,
          )
          .all(workspaceId, agentKey)
      : db
          .prepare(
            `SELECT * FROM agent_memories WHERE workspace_id = ?
             ORDER BY pinned DESC, created_at DESC, rowid DESC`,
          )
          .all(workspaceId)
  ) as MemoryRow[];
  return rows.map(toMemory);
}

export type UpdateMemoryPatch = Partial<Pick<AgentMemory, 'content' | 'pinned'>>;

export function updateMemory(db: Db, workspaceId: string, memoryId: string, patch: UpdateMemoryPatch): AgentMemory {
  const existing = findMemoryById(db, workspaceId, memoryId);
  if (!existing) throw new AppError('not_found', `memory ${memoryId} not found`);

  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.content !== undefined) {
    sets.push('content = ?');
    params.push(patch.content);
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned = ?');
    params.push(patch.pinned ? 1 : 0);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(nowIso());
    db.prepare(`UPDATE agent_memories SET ${sets.join(', ')} WHERE workspace_id = ? AND id = ?`).run(
      ...params,
      workspaceId,
      memoryId,
    );
  }
  return findMemoryById(db, workspaceId, memoryId)!;
}

export function deleteMemory(db: Db, workspaceId: string, memoryId: string): AgentMemory {
  const existing = findMemoryById(db, workspaceId, memoryId);
  if (!existing) throw new AppError('not_found', `memory ${memoryId} not found`);
  db.prepare('DELETE FROM agent_memories WHERE workspace_id = ? AND id = ?').run(workspaceId, memoryId);
  return existing;
}

/** Everything the agent will cite, pinned first — the read side of injection. */
export function memoriesForAgent(db: Db, workspaceId: string, agentKey: string): AgentMemory[] {
  return listMemories(db, workspaceId, agentKey);
}
