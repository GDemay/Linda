import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { transaction } from '../db/index.ts';
import { id } from '../ids.ts';
import { AppError, parseJson, type KnowledgeChunk, type KnowledgeDocument } from './types.ts';

type Row = Record<string, any>;

// ------------------------------------------------------------------ mapping

function toDocument(r: Row): KnowledgeDocument {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    source: r.source,
    sourceRef: r.source_ref ?? '',
    title: r.title,
    status: r.status,
    error: r.error ?? null,
    agentKeys: parseJson<string[]>(r.agent_keys, []),
    chunkCount: r.chunk_count,
    charCount: r.char_count,
    lastUsedAt: r.last_used_at ?? null,
    createdAt: r.created_at,
  };
}

function toChunk(r: Row): KnowledgeChunk {
  return {
    id: r.id,
    documentId: r.document_id,
    workspaceId: r.workspace_id,
    seq: r.seq,
    content: r.content,
    createdAt: r.created_at,
  };
}

// -------------------------------------------------------------- documents

export function insertDocument(
  db: Db,
  input: {
    workspaceId: string;
    title: string;
    source: KnowledgeDocument['source'];
    sourceRef?: string;
    status?: KnowledgeDocument['status'];
    error?: string | null;
    agentKeys?: string[];
    charCount?: number;
  },
): KnowledgeDocument {
  const ts = nowIso();
  const row = {
    id: id(),
    workspace_id: input.workspaceId,
    title: input.title,
    source: input.source,
    source_ref: input.sourceRef ?? '',
    status: input.status ?? 'ready',
    error: input.error ?? null,
    char_count: input.charCount ?? 0,
    chunk_count: 0,
    agent_keys: JSON.stringify(input.agentKeys ?? []),
    last_used_at: null,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO knowledge_documents (
       id, workspace_id, title, source, source_ref, status, error,
       char_count, chunk_count, agent_keys, last_used_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.workspace_id, row.title, row.source, row.source_ref, row.status, row.error,
    row.char_count, row.chunk_count, row.agent_keys, row.last_used_at, row.created_at, row.updated_at,
  );
  return toDocument(row);
}

/**
 * Replaces a document's chunks wholesale and syncs the derived counters.
 * Ingest is the only writer of chunks, so "replace" is the whole lifecycle.
 */
export function replaceChunks(
  db: Db,
  documentId: string,
  chunks: string[],
  opts: { charCount?: number; status?: KnowledgeDocument['status']; error?: string | null } = {},
): void {
  transaction(db, () => {
    db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId);
    const ts = nowIso();
    const insert = db.prepare(
      `INSERT INTO knowledge_chunks (id, document_id, workspace_id, seq, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const wsRow = db
      .prepare('SELECT workspace_id FROM knowledge_documents WHERE id = ?')
      .get(documentId) as Row | undefined;
    if (!wsRow) throw new Error(`document ${documentId} not found`);
    chunks.forEach((content, seq) => {
      insert.run(id(), documentId, wsRow.workspace_id, seq, content, ts);
    });
    db.prepare(
      `UPDATE knowledge_documents
       SET chunk_count = ?, char_count = ?, status = ?, error = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      chunks.length,
      opts.charCount ?? chunks.reduce((n, c) => n + c.length, 0),
      opts.status ?? 'ready',
      opts.error ?? null,
      ts,
      documentId,
    );
  });
}

export function listDocuments(db: Db, workspaceId: string): KnowledgeDocument[] {
  const rows = db
    .prepare('SELECT * FROM knowledge_documents WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(workspaceId) as Row[];
  return rows.map(toDocument);
}

/** Workspace-scoped lookup — another workspace's document 404s, never leaks. */
export function findDocument(db: Db, workspaceId: string, documentId: string): KnowledgeDocument | null {
  const r = db
    .prepare('SELECT * FROM knowledge_documents WHERE id = ? AND workspace_id = ?')
    .get(documentId, workspaceId) as Row | undefined;
  return r ? toDocument(r) : null;
}

/**
 * Deletion is the GTM reversibility promise (LIN-14): the document row AND
 * everything derived from it go together. Returns what was deleted so callers
 * can say so in the API response, not just imply it.
 */
export function deleteDocument(
  db: Db,
  workspaceId: string,
  documentId: string,
): { document: KnowledgeDocument; chunksDeleted: number } | null {
  const doc = findDocument(db, workspaceId, documentId);
  if (!doc) return null;
  const chunksDeleted = (
    db.prepare('SELECT COUNT(*) AS n FROM knowledge_chunks WHERE document_id = ?').get(documentId) as Row
  ).n as number;
  // Chunks cascade via FK, but run inside the same transaction anyway so a
  // failure can't leave the document alive with orphaned chunks.
  transaction(db, () => {
    db.prepare('DELETE FROM knowledge_documents WHERE id = ? AND workspace_id = ?').run(documentId, workspaceId);
  });
  return { document: doc, chunksDeleted };
}

/** Marks every grounding-retrieved document with the same "last used" stamp. */
export function touchDocumentsUsed(db: Db, documentIds: string[], at?: string): void {
  if (documentIds.length === 0) return;
  const stmt = db.prepare('UPDATE knowledge_documents SET last_used_at = ?, updated_at = ? WHERE id = ?');
  const ts = at ?? nowIso();
  for (const docId of documentIds) stmt.run(ts, ts, docId);
}

// ----------------------------------------------------------------- chunks

/** All ready chunks visible to `agentKey`: docs scoped to it plus workspace-wide docs. */
export function chunksForAgent(db: Db, workspaceId: string, agentKey: string | null): KnowledgeChunk[] {
  // agent_keys is a JSON array, so matching happens after parsing — a SQL LIKE
  // would false-positive on substring agent keys.
  const rows = db
    .prepare(
      `SELECT c.*, d.agent_keys AS doc_agent_keys FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE c.workspace_id = ? AND d.status = 'ready'
       ORDER BY d.created_at, c.seq`,
    )
    .all(workspaceId) as Row[];
  return rows
    .filter((r) => !agentKey || parseJson<string[]>(r.doc_agent_keys, []).length === 0
      || parseJson<string[]>(r.doc_agent_keys, []).includes(agentKey))
    .map(toChunk);
}

export function countChunks(db: Db, workspaceId: string): number {
  const r = db
    .prepare('SELECT COUNT(*) AS n FROM knowledge_chunks WHERE workspace_id = ?')
    .get(workspaceId) as Row;
  return r.n as number;
}

// -------------------------------------------------------------- grounding

/** Cap on what grounding injects into one prompt, so a big KB can't blow context. */
export const MAX_GROUNDING_CHARS = 12_000;

export type GroundingContext = {
  /** Text blocks injected into the prompt, pre-capped to MAX_GROUNDING_CHARS. */
  blocks: string[];
  documentCount: number;
  chunkCount: number;
};

/**
 * Everything a workflow step or task template needs from the knowledge base
 * (LIN-54 W8): chunks the agent may see — its scoped docs plus workspace-wide
 * ones — capped so prompts stay sane. Reading for grounding is what stamps
 * `last_used_at`, which is what the "last used" surface shows.
 */
export function groundingForAgent(
  db: Db,
  workspaceId: string,
  agentKey: string | null,
  opts: { now?: () => Date; maxChars?: number } = {},
): GroundingContext {
  const maxChars = opts.maxChars ?? MAX_GROUNDING_CHARS;
  const chunks = chunksForAgent(db, workspaceId, agentKey);
  const blocks: string[] = [];
  const usedDocs = new Set<string>();
  let used = 0;

  for (const chunk of chunks) {
    if (used + chunk.content.length > maxChars) break;
    blocks.push(chunk.content);
    usedDocs.add(chunk.documentId);
    used += chunk.content.length;
  }

  if (usedDocs.size > 0) {
    const at = (opts.now ?? (() => new Date()))().toISOString();
    touchDocumentsUsed(db, [...usedDocs], at);
  }

  return { blocks, documentCount: usedDocs.size, chunkCount: chunks.length };
}
