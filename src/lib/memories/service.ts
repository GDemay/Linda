import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { isAgentKey } from '../agents/catalog.ts';
import { recordActivity } from '../repos/workflows.ts';
import { findTaskById, updateTask } from '../repos/tasks.ts';
import {
  createMemory,
  deleteMemory,
  findMemoryById,
  listMemories,
  updateMemory,
} from '../repos/memories.ts';
import { AppError, type AgentMemory, type Task } from '../repos/types.ts';

/**
 * Agent memory (LIN-53, W7). Facts a workspace teaches an agent persist in
 * SQLite, ride along on every task and workflow run, and are cited in the
 * output so the user can see what was applied. Every mutation lands in the
 * activity log — that log *is* the append/edit history.
 *
 * Pure repo access stays in repos/memories.ts; this file owns validation,
 * activity trail and the injection format shared by both execution paths.
 */

export const createMemorySchema = z.object({
  agent: z.string().min(1),
  content: z.string().trim().min(1).max(2000),
  pinned: z.boolean().optional(),
});

export const updateMemorySchema = z.object({
  content: z.string().trim().min(1).max(2000).optional(),
  pinned: z.boolean().optional(),
});

export function listWorkspaceMemories(db: Db, workspaceId: string, agent?: string): AgentMemory[] {
  return listMemories(db, workspaceId, agent || undefined);
}

export function getWorkspaceMemory(db: Db, workspaceId: string, memoryId: string): AgentMemory {
  const memory = findMemoryById(db, workspaceId, memoryId);
  if (!memory) throw new AppError('not_found', `memory ${memoryId} not found`);
  return memory;
}

function requireAgentKey(agent: string) {
  if (!isAgentKey(agent)) throw new AppError('invalid', `unknown agent: ${agent}`);
  return agent;
}

export function addMemory(
  db: Db,
  workspaceId: string,
  userId: string,
  raw: unknown,
  source: 'manual' | 'correction' = 'manual',
): AgentMemory {
  const parsed = createMemorySchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid memory', parsed.error.issues);
  const agentKey = requireAgentKey(parsed.data.agent);

  const memory = createMemory(db, {
    workspaceId,
    agentKey,
    content: parsed.data.content,
    pinned: parsed.data.pinned,
    source,
    createdByUserId: userId,
  });
  recordActivity(db, {
    workspaceId,
    actorType: 'user',
    actorId: userId,
    kind: 'memory.created',
    summary: `Memory added: ${memory.content.slice(0, 120)}`,
    data: { memoryId: memory.id, agent: agentKey, source, pinned: memory.pinned },
  });
  return memory;
}

export function editMemory(
  db: Db,
  workspaceId: string,
  memoryId: string,
  userId: string,
  raw: unknown,
): AgentMemory {
  const parsed = updateMemorySchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid memory patch', parsed.error.issues);
  const current = getWorkspaceMemory(db, workspaceId, memoryId);

  const updated = updateMemory(db, workspaceId, memoryId, parsed.data);
  // Edit history lives in the activity log: the previous content is kept in
  // the event data so any change is auditable without a history table.
  recordActivity(db, {
    workspaceId,
    actorType: 'user',
    actorId: userId,
    kind: 'memory.updated',
    summary: `Memory updated: ${updated.content.slice(0, 120)}`,
    data: {
      memoryId,
      agent: updated.agentKey,
      before: { content: current.content, pinned: current.pinned },
      after: { content: updated.content, pinned: updated.pinned },
    },
  });
  return updated;
}

export function removeMemory(db: Db, workspaceId: string, memoryId: string, userId: string): AgentMemory {
  const memory = deleteMemory(db, workspaceId, memoryId);
  recordActivity(db, {
    workspaceId,
    actorType: 'user',
    actorId: userId,
    kind: 'memory.deleted',
    summary: `Memory deleted: ${memory.content.slice(0, 120)}`,
    data: { memoryId, agent: memory.agentKey, content: memory.content },
  });
  return memory;
}

// ------------------------------------------------------------- injection

/**
 * The read side both execution paths use: the facts an agent carries into a
 * run, pinned first. Returns [] for agents the workspace never taught
 * anything — injection must be invisible until there is something to apply.
 */
export function memoriesForAgent(db: Db, workspaceId: string, agentKey: string): AgentMemory[] {
  return listMemories(db, workspaceId, agentKey);
}

/** Short citation label, stable across task output and run output. */
export function memoryLabel(seq: number): string {
  return `M${seq}`;
}

/**
 * The block appended to a task's output when the agent had memories to
 * apply. Each entry is cited so the user can trace the output back to the
 * learned fact (and edit or delete it from the agent tab).
 */
export function citationBlock(memories: AgentMemory[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m, i) => `[${memoryLabel(i + 1)}]${m.pinned ? ' 📌' : ''} ${m.content}`);
  return `\n\nApplied memory:\n${lines.join('\n')}`;
}

/** Context lines handed to workflow steps via StepContext.memories. */
export function memoryPromptLines(memories: AgentMemory[]): string[] {
  return memories.map((m, i) => `[${memoryLabel(i + 1)}]${m.pinned ? ' 📌' : ''} ${m.content}`);
}

// ------------------------------------------------- deliverable corrections

export const editDeliverableSchema = z.object({
  output: z.string().trim().min(1).max(20000).optional(),
  /** When set, this correction becomes a persistent memory for that agent. */
  rememberNote: z.string().trim().min(1).max(2000).optional(),
});

/**
 * The "Remember this correction" affordance (LIN-53): the user edits a
 * deliverable and can promote the correction to a memory the agent carries
 * into every future run. The task edit and the memory are logged separately.
 */
export function editTaskDeliverable(
  db: Db,
  workspaceId: string,
  taskId: string,
  userId: string,
  raw: unknown,
): { task: Task; memory: AgentMemory | null } {
  const parsed = editDeliverableSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid edit', parsed.error.issues);

  const task = findTaskById(db, workspaceId, taskId);
  if (!task) throw new AppError('not_found', `task ${taskId} not found`);
  if (parsed.data.output === undefined && parsed.data.rememberNote === undefined) {
    throw new AppError('invalid', 'nothing to change');
  }

  let updated = task;
  if (parsed.data.output !== undefined && parsed.data.output !== task.output) {
    updated = updateTask(db, taskId, { output: parsed.data.output });
    recordActivity(db, {
      workspaceId,
      actorType: 'user',
      actorId: userId,
      kind: 'task.edited',
      summary: `Deliverable edited: ${updated.title}`,
      data: { taskId, before: task.output?.slice(0, 500) ?? '', after: updated.output?.slice(0, 500) ?? '' },
    });
  }

  let memory: AgentMemory | null = null;
  if (parsed.data.rememberNote) {
    memory = addMemory(db, workspaceId, userId, { agent: task.agent, content: parsed.data.rememberNote }, 'correction');
  }

  return { task: updated, memory };
}
