'use client';

import { useState } from 'react';
import { api } from '@/lib/client.ts';

export type Memory = {
  id: string;
  agentKey: string;
  content: string;
  pinned: boolean;
  source: 'manual' | 'correction';
  createdAt: string;
  updatedAt: string;
};

/**
 * The inspectable/editable memory surface in the agent tab (LIN-53): list,
 * pin, edit, delete, add. Every mutation lands in the workspace activity log
 * server-side; this component only reflects state and reports errors.
 */
export function MemoryPanel({
  workspaceId,
  agentKey,
  persona,
  memories,
  onChanged,
  onError,
}: {
  workspaceId: string;
  agentKey: string;
  persona: string;
  memories: Memory[];
  onChanged: () => Promise<void>;
  onError: (err: Error) => void;
}) {
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      onError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const content = adding.trim();
    if (!content) return;
    return run(async () => {
      await api(`/workspaces/${workspaceId}/memories`, { body: { agent: agentKey, content } });
      setAdding('');
    });
  }

  function saveEdit(memoryId: string) {
    const content = editText.trim();
    if (!content) return;
    return run(async () => {
      await api(`/workspaces/${workspaceId}/memories/${memoryId}`, {
        method: 'PATCH',
        body: { content },
      });
      setEditingId(null);
    });
  }

  function togglePin(memory: Memory) {
    return run(() =>
      api(`/workspaces/${workspaceId}/memories/${memory.id}`, {
        method: 'PATCH',
        body: { pinned: !memory.pinned },
      }),
    );
  }

  function remove(memoryId: string) {
    return run(async () => {
      await api(`/workspaces/${workspaceId}/memories/${memoryId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
    });
  }

  return (
    <div className="l-col" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
      <div className="l-row l-xs l-muted" style={{ gap: 6 }}>
        <b style={{ color: 'var(--text-primary)' }}>Memory</b>
        <span className="l-num">{memories.length}</span>
        <span>· what {persona} has learned</span>
      </div>

      {memories.length === 0 && editingId === null && (
        <p className="l-xs l-muted" style={{ margin: 0 }}>
          Nothing yet. Teach {persona} a fact below — it applies to every future task and run.
        </p>
      )}

      {memories.map((m) =>
        editingId === m.id ? (
          <div key={m.id} className="l-col" style={{ gap: 6 }}>
            <textarea
              className="l-textarea"
              rows={2}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              aria-label={`Edit memory for ${persona}`}
            />
            <div className="l-row" style={{ gap: 8 }}>
              <button className="l-btn l-btn--primary l-btn--sm" disabled={busy} onClick={() => saveEdit(m.id)}>
                Save
              </button>
              <button className="l-btn l-btn--ghost l-btn--sm" disabled={busy} onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div key={m.id} className="l-row" style={{ gap: 6, alignItems: 'flex-start' }}>
            <button
              className="l-btn l-btn--ghost l-btn--sm"
              style={{ padding: '0 6px' }}
              title={m.pinned ? `Unpin — ${persona} still keeps this fact` : `Pin — always apply this first`}
              disabled={busy}
              onClick={() => togglePin(m)}
            >
              {m.pinned ? '📌' : '📍'}
            </button>
            <span className="l-sm" style={{ flex: 1, whiteSpace: 'pre-wrap' }}>
              {m.content}
              {m.source === 'correction' && (
                <span className="l-badge" style={{ marginLeft: 6 }} title="Learned from a correction you made">
                  correction
                </span>
              )}
            </span>
            {confirmDeleteId === m.id ? (
              <span className="l-row l-xs" style={{ gap: 4, whiteSpace: 'nowrap' }}>
                <span className="l-muted">Forget it?</span>
                <button className="l-btn l-btn--danger l-btn--sm" disabled={busy} onClick={() => remove(m.id)}>
                  Yes
                </button>
                <button className="l-btn l-btn--ghost l-btn--sm" disabled={busy} onClick={() => setConfirmDeleteId(null)}>
                  No
                </button>
              </span>
            ) : (
              <span className="l-row" style={{ gap: 4, whiteSpace: 'nowrap' }}>
                <button
                  className="l-btn l-btn--ghost l-btn--sm"
                  disabled={busy}
                  title="Edit this memory"
                  onClick={() => {
                    setEditingId(m.id);
                    setEditText(m.content);
                  }}
                >
                  Edit
                </button>
                <button
                  className="l-btn l-btn--ghost l-btn--sm"
                  disabled={busy}
                  title={`${persona} will forget this fact on future runs`}
                  onClick={() => setConfirmDeleteId(m.id)}
                >
                  Delete
                </button>
              </span>
            )}
          </div>
        ),
      )}

      <div className="l-row" style={{ gap: 6 }}>
        <input
          className="l-input"
          style={{ flex: 1 }}
          placeholder={`Teach ${persona} something, e.g. "always reply in French"`}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button className="l-btn l-btn--secondary l-btn--sm" disabled={busy || !adding.trim()} onClick={add}>
          Remember
        </button>
      </div>
    </div>
  );
}
