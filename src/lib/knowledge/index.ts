import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { AGENT_CATALOG, isAgentKey } from '../agents/catalog.ts';
import { recordActivity } from '../repos/workflows.ts';
import {
  deleteDocument,
  findDocument,
  insertDocument,
  listDocuments,
  replaceChunks,
} from '../repos/knowledge.ts';
import { AppError, type KnowledgeDocument } from '../repos/types.ts';

/**
 * Knowledge base upload & grounding (LIN-54 / LIN-2 spec §4 W8).
 *
 * Upload is paste-or-URL, processed synchronously — no queue, no "someone
 * will index this" step, because a self-serve customer who uploads a document
 * and sees "processing" forever churns. Chunks are derived data that cascade
 * away on delete (the LIN-14 reversibility promise).
 */

/** Roughly one LLM context paragraph; overlap keeps sentence context intact. */
const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;
/** Cap on pasted/uploaded text — generous for docs, small enough to store cheaply. */
const MAX_CONTENT_CHARS = 200_000;

// ---------------------------------------------------------------- ingestion

/** Deterministic chunker: paragraph boundaries first, hard splits second. */
export function chunkText(text: string, opts: { chunkChars?: number; overlap?: number } = {}): string[] {
  const size = opts.chunkChars ?? CHUNK_CHARS;
  const overlap = opts.overlap ?? CHUNK_OVERLAP;
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      // Prefer breaking on a paragraph or sentence boundary near the cut.
      const window = normalized.slice(start, end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (cut > size / 2) end = start + cut + 1;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = end - overlap;
  }
  return chunks.filter((c) => c.length > 0);
}

/** Strips an HTML page down to readable text. Deliberately naive — no deps. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const titleFromUrl = (url: string): string => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + u.pathname;
  } catch {
    return url;
  }
};

export const uploadSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** Pasted or file-upload text. Exactly one of content / url is required. */
  content: z.string().max(MAX_CONTENT_CHARS).optional(),
  url: z.string().trim().url().max(2000).optional(),
  /** For file uploads: the original filename, so the list can show it. */
  filename: z.string().trim().max(255).optional(),
  /** Catalog keys this document grounds. Empty = whole workspace. */
  agentKeys: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});

export type UploadInput = z.infer<typeof uploadSchema>;

export type UploadResult = {
  document: KnowledgeDocument;
};

/**
 * Ingests one document: paste, uploaded file contents, or a fetched URL.
 * URL fetch failures are recorded on the document (status 'failed') rather
 * than thrown, so the customer sees *why* in the list instead of a dead form.
 */
export async function uploadDocument(
  db: Db,
  workspaceId: string,
  raw: unknown,
  opts: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<UploadResult> {
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid knowledge upload', parsed.error.issues);
  const input = parsed.data;
  if (!input.content && !input.url) {
    throw new AppError('invalid', 'provide either content or a url');
  }
  if (input.content && input.url) {
    throw new AppError('invalid', 'provide either content or a url, not both');
  }
  for (const key of input.agentKeys) {
    if (!isAgentKey(key)) throw new AppError('invalid', `unknown agent: ${key}`);
  }

  let text = input.content ?? '';
  let title = input.title ?? input.filename ?? '';
  let sourceRef = '';
  let source: KnowledgeDocument['source'];

  if (input.url) {
    source = 'url';
    sourceRef = input.url;
    title = title || titleFromUrl(input.url);
    const fetchImpl = opts.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(input.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'LindaKnowledgeBot/1.0 (+https://linda-llm-production.up.railway.app)' },
      });
      if (!res.ok) throw new Error(`fetch returned ${res.status}`);
      const body = await res.text();
      const contentType = res.headers.get('content-type') ?? '';
      text = /html/i.test(contentType) ? htmlToText(body) : body;
      if (!text) throw new Error('no extractable text');
    } catch (err) {
      // Keep the row — the status and error are the customer-facing answer.
      const doc = insertDocument(db, {
        workspaceId,
        title,
        source,
        sourceRef,
        status: 'failed',
        error: (err as Error).message,
        agentKeys: input.agentKeys,
      });
      recordActivity(db, {
        workspaceId,
        actorType: 'user',
        kind: 'knowledge.upload_failed',
        summary: `Couldn't process ${title}`,
        data: { documentId: doc.id, url: input.url, error: (err as Error).message },
      });
      return { document: doc };
    }
  } else {
    source = input.filename ? 'file' : 'paste';
    sourceRef = input.filename ?? '';
    title = title || (input.filename ?? 'Pasted note');
  }

  if (!text.trim()) throw new AppError('invalid', 'document is empty');

  const document = insertDocument(db, {
    workspaceId,
    title: title.slice(0, 200),
    source,
    sourceRef,
    agentKeys: input.agentKeys,
    charCount: text.length,
  });
  const chunks = chunkText(text);
  replaceChunks(db, document.id, chunks, { charCount: text.length });
  recordActivity(db, {
    workspaceId,
    actorType: 'user',
    kind: 'knowledge.uploaded',
    summary: `Added knowledge: ${title}`,
    data: { documentId: document.id, source, chunks: chunks.length },
  });

  const stored = findDocument(db, workspaceId, document.id);
  if (!stored) throw new AppError('conflict', 'document vanished after insert');
  return { document: stored };
}

// ---------------------------------------------------------------- grounding

// Retrieval lives in the repo (the workflow runner imports it directly); the
// service re-exports so callers have one obvious import path either way.
export { groundingForAgent, MAX_GROUNDING_CHARS } from '../repos/knowledge.ts';
export type { GroundingContext } from '../repos/knowledge.ts';

// ------------------------------------------------------------------ queries

export function knowledgeSummary(db: Db, workspaceId: string): {
  documents: KnowledgeDocument[];
  totals: { documents: number; ready: number; failed: number; chunks: number };
} {
  const documents = listDocuments(db, workspaceId);
  return {
    documents,
    totals: {
      documents: documents.length,
      ready: documents.filter((d) => d.status === 'ready').length,
      failed: documents.filter((d) => d.status === 'failed').length,
      chunks: documents.reduce((n, d) => n + d.chunkCount, 0),
    },
  };
}

/**
 * Deletes a document and its derived chunks. Returns copy that says what was
 * removed — the reversibility messaging the GTM plan promises (LIN-14).
 */
export function removeDocument(
  db: Db,
  workspaceId: string,
  documentId: string,
): { removed: string; chunksDeleted: number } {
  const result = deleteDocument(db, workspaceId, documentId);
  if (!result) throw new AppError('not_found', 'document not found');
  recordActivity(db, {
    workspaceId,
    actorType: 'user',
    kind: 'knowledge.deleted',
    summary: `Removed knowledge: ${result.document.title}`,
    data: { documentId, chunksDeleted: result.chunksDeleted },
  });
  return {
    removed: `"${result.document.title}" and its ${result.chunksDeleted} extracted chunk${result.chunksDeleted === 1 ? '' : 's'} were fully deleted — including everything derived from them.`,
    chunksDeleted: result.chunksDeleted,
  };
}

/** Agent keys offered for scoping in the UI — only what's hired. */
export function scopingOptions(db: Db, workspaceId: string): { key: string; name: string }[] {
  const rows = db
    .prepare('SELECT DISTINCT agent_key FROM workspace_agents WHERE workspace_id = ?')
    .all(workspaceId) as { agent_key: string }[];
  return rows
    .filter((r) => isAgentKey(r.agent_key))
    .map((r) => ({ key: r.agent_key, name: AGENT_CATALOG[r.agent_key as keyof typeof AGENT_CATALOG].name }));
}
