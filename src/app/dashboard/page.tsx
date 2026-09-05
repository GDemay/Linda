'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';

type Overview = {
  workspace: { id: string; name: string; onboardingStep: string };
  role: string;
  agents: { id: string; agentKey: string; displayName: string; status: 'active' | 'paused' }[];
  connections: { provider: string; status: string }[];
  workflows: { id: string; name: string; definitionKey: string; workspaceAgentId: string; status: string }[];
};

type Run = {
  id: string;
  workflowId: string;
  status: string;
  trigger: string;
  createdAt: string;
  error: string | null;
};

type ActivityEvent = { id: string; kind: string; summary: string; createdAt: string };

type CatalogAgent = {
  key: string;
  persona: string;
  role: string;
  taskTemplates: { key: string; category: string; title: string }[];
};

type Task = {
  id: string;
  agent: string;
  category: string;
  title: string;
  input: string;
  output: string | null;
  status: string;
  tokensUsed: number;
  createdAt: string;
};

type Approval = {
  id: string;
  workspaceAgentId: string;
  actionKind: string;
  summary: string;
  status: string;
  createdAt: string;
};

/** Agent identity hue is decorative only (design README: never encodes state). */
const AGENT_HUE: Record<string, string> = {
  phone: 'var(--agent-support)',
  marketing: 'var(--agent-social)',
  seo: 'var(--agent-seo)',
  sales: 'var(--agent-sales)',
  accounting: 'var(--agent-finance)',
  legal: 'var(--agent-legal)',
  recruiting: 'var(--agent-hr)',
  assistant: 'var(--agent-assistant)',
};

function Avatar({ agentKey, name, sm = false }: { agentKey: string; name: string; sm?: boolean }) {
  return (
    <span
      className={`l-avatar${sm ? ' l-avatar--sm' : ''}`}
      style={{ ['--agent' as string]: AGENT_HUE[agentKey] ?? 'var(--ink-500)' }}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Status is never colour-only: every dot/badge pairs with a text label. */
function AgentStatus({ status }: { status: 'active' | 'paused' }) {
  return (
    <span className="l-row l-xs l-muted" style={{ gap: 6, alignItems: 'center' }}>
      <span className={`l-dot ${status === 'active' ? 'l-dot--live' : 'l-dot--paused'}`} />
      {status === 'active' ? 'Active' : 'Paused'}
    </span>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    succeeded: 'l-badge l-badge--success',
    completed: 'l-badge l-badge--success',
    failed: 'l-badge l-badge--danger',
    queued: 'l-badge l-badge--warning',
    running: 'l-badge l-badge--warning',
    needs_approval: 'l-badge l-badge--accent',
  };
  return <span className={map[status] ?? 'l-badge'}>{status.replace('_', ' ')}</span>;
}

/** Destructive confirm per design screen 8: name the consequence, danger button on the right. */
type Confirm = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
};

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={confirm.title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--ink-950) 55%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div className="l-card" style={{ maxWidth: 440, width: '90%' }} onClick={(e) => e.stopPropagation()}>
        <div className="l-card__body">
          <h3 style={{ marginTop: 0 }}>{confirm.title}</h3>
          <p className="l-sm" style={{ whiteSpace: 'pre-line' }}>{confirm.body}</p>
          <div className="l-row" style={{ marginTop: 'var(--space-4)' }}>
            <span className="l-spacer" />
            <button className="l-btn l-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="l-btn l-btn--danger"
              onClick={async () => {
                onClose();
                await confirm.onConfirm();
              }}
            >
              {confirm.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Success confirmations auto-dismiss; anything the user must act on is a banner, not this. */
function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { toast, show };
}

/** Skeletons match the final layout so nothing jumps on load (never a spinner). */
function SkeletonDashboard() {
  return (
    <div className="l-shell" style={{ minHeight: 480 }}>
      <aside className="l-sidebar">
        <div className="l-col" style={{ gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="l-row" style={{ gap: 'var(--space-2)' }}>
              <div className="l-skeleton" style={{ width: 28, height: 28, borderRadius: 'var(--radius-full)' }} />
              <div className="l-skeleton" style={{ width: '60%', height: 11 }} />
            </div>
          ))}
        </div>
      </aside>
      <div>
        <header className="l-topbar">
          <div className="l-skeleton" style={{ width: 320, height: 16 }} />
        </header>
        <div className="l-main l-col" style={{ gap: 'var(--space-6)' }}>
          <div className="l-skeleton" style={{ width: 280, height: 28 }} />
          <div className="l-card"><div className="l-card__body l-col" style={{ gap: 'var(--space-4)' }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="l-row" style={{ gap: 'var(--space-2)' }}>
                <div className="l-skeleton" style={{ width: 32, height: 32, borderRadius: 'var(--radius-full)' }} />
                <div style={{ flex: 1 }}>
                  <div className="l-skeleton" style={{ width: '55%', height: 11, marginBottom: 6 }} />
                  <div className="l-skeleton" style={{ width: '30%', height: 9 }} />
                </div>
              </div>
            ))}
          </div></div>
          <div className="l-grid l-grid--4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="l-card"><div className="l-card__body l-col" style={{ gap: 8 }}>
                <div className="l-skeleton" style={{ width: '70%', height: 9 }} />
                <div className="l-skeleton" style={{ width: 40, height: 22 }} />
              </div></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Dashboard() {
  const router = useRouter();
  const workspaceId = useSearchParams().get('workspace');

  const [data, setData] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [catalog, setCatalog] = useState<CatalogAgent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const { toast, show } = useToast();

  // Composer state: which hired agent, which template, what instruction.
  const [taskAgent, setTaskAgent] = useState<string>('');
  const [taskTemplate, setTaskTemplate] = useState<string>('');
  const [taskInput, setTaskInput] = useState('');
  const [submittingTask, setSubmittingTask] = useState(false);
  const [latestTask, setLatestTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const [overview, runsRes, activityRes, tasksRes, approvalsRes] = await Promise.all([
      api<Overview>(`/workspaces/${workspaceId}`),
      api<{ runs: Run[] }>(`/workspaces/${workspaceId}/runs?limit=15`),
      api<{ events: ActivityEvent[] }>(`/workspaces/${workspaceId}/activity?limit=15`),
      api<{ tasks: Task[] }>(`/tasks?workspaceId=${workspaceId}&limit=10`),
      api<{ approvals: Approval[] }>(`/workspaces/${workspaceId}/approvals?status=pending`),
    ]);
    setData(overview);
    setRuns(runsRes.runs);
    setActivity(activityRes.events);
    setTasks(tasksRes.tasks);
    setApprovals(approvalsRes.approvals);
  }, [workspaceId]);

  useEffect(() => {
    api<{ agents: CatalogAgent[] }>('/catalog')
      .then((res) => setCatalog(res.agents))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      router.replace('/login');
      return;
    }
    load().catch((err) => setFatalError((err as Error).message));
  }, [workspaceId, load, router]);

  const withActionError = async (fn: () => Promise<void>) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  function runWorkflow(id: string) {
    return withActionError(async () => {
      setRunningId(id);
      try {
        await api(`/workspaces/${workspaceId}/workflows/${id}/run`, { body: {} });
        await load();
        show('Run started.');
      } finally {
        setRunningId(null);
      }
    });
  }

  function toggleAgent(agentId: string, status: 'active' | 'paused') {
    return withActionError(async () => {
      await api(`/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        body: { status: status === 'active' ? 'paused' : 'active' },
      });
      await load();
      show(status === 'active' ? 'Agent paused. Nothing in flight was lost.' : 'Agent resumed.');
    });
  }

  function decideApproval(itemId: string, decision: 'approved' | 'rejected') {
    return withActionError(async () => {
      setBusyApprovalId(itemId);
      try {
        await api(`/workspaces/${workspaceId}/approvals`, { body: { itemId, decision } });
        await load();
        show(decision === 'approved' ? 'Approved. The agent can continue.' : 'Rejected. Nothing was sent.');
      } finally {
        setBusyApprovalId(null);
      }
    });
  }

  function submitTask() {
    if (!taskAgent || !taskInput.trim()) return;
    return withActionError(async () => {
      setSubmittingTask(true);
      try {
        const res = await api<{ task: Task }>('/tasks', {
          body: {
            workspaceId,
            agent: taskAgent,
            template: taskTemplate || undefined,
            input: taskInput.trim(),
          },
        });
        setLatestTask(res.task);
        setTaskInput('');
        await load();
        show(`${res.task.title} — done.`);
      } finally {
        setSubmittingTask(false);
      }
    });
  }

  async function pauseAllAgents() {
    if (!data) return;
    for (const a of data.agents.filter((x) => x.status === 'active')) {
      await api(`/workspaces/${workspaceId}/agents/${a.id}`, { method: 'PATCH', body: { status: 'paused' } });
    }
    await load();
    show('All agents paused. Nothing in flight was lost.');
  }

  if (!workspaceId) return null;

  // Full error state: recoverable, with the fix (retry) in reach.
  if (fatalError && !data) {
    return (
      <main className="l-main l-col" style={{ gap: 'var(--space-4)', maxWidth: 560, margin: '10vh auto' }}>
        <div className="l-banner l-banner--danger">
          <div>
            <b>Couldn't load your dashboard.</b>
            <br />
            {fatalError}
          </div>
        </div>
        <div className="l-row">
          <button className="l-btn l-btn--primary l-btn--sm" onClick={() => load().catch((e) => setFatalError((e as Error).message))}>
            Try again
          </button>
          <button className="l-btn l-btn--ghost l-btn--sm" onClick={() => router.push('/login')}>
            Back to login
          </button>
        </div>
      </main>
    );
  }

  if (!data) return <SkeletonDashboard />;

  const agentName = (workspaceAgentId: string) =>
    data.agents.find((a) => a.id === workspaceAgentId)?.displayName ?? 'Agent';
  const agentKeyOf = (workspaceAgentId: string) =>
    data.agents.find((a) => a.id === workspaceAgentId)?.agentKey ?? 'assistant';

  // Catalog data for the composer, restricted to agents this workspace hired.
  const catalogByKey = Object.fromEntries(catalog.map((c) => [c.key, c]));
  const hiredKeys = data.agents.map((a) => a.agentKey);
  const hiredCatalog = catalog.filter((c) => hiredKeys.includes(c.key));
  const activeAgentKey = taskAgent || hiredCatalog[0]?.key || '';
  const templates = catalogByKey[activeAgentKey]?.taskTemplates ?? [];
  const activeTemplateKey = taskTemplate || templates[0]?.key || '';
  const persona = (agentKey: string) => catalogByKey[agentKey]?.persona ?? agentKey;

  const connectedTools = data.connections.filter((c) => c.status === 'connected').length;
  const activeAgents = data.agents.filter((a) => a.status === 'active').length;
  const failedRuns = runs.filter((r) => r.status === 'failed');

  return (
    <>
      {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}

      <div className="l-shell">
        <aside className="l-sidebar">
          <div className="l-row" style={{ padding: 'var(--space-2) var(--space-3)' }}>
            <span className="logo-mark">L</span>
            <b>Linda</b>
            <span className="l-spacer" />
            <span className="l-badge l-badge--accent">{data.role}</span>
          </div>
          <nav className="l-nav">
            <a className="l-nav__item is-active" href="#dashboard">🏠 Home</a>
            <a className="l-nav__item" href="#approvals">
              ✅ Approvals {approvals.length > 0 && <span className="l-nav__count l-num">{approvals.length}</span>}
            </a>
            <a className="l-nav__item" href="#agents">🧑‍💼 Agents</a>
            <a className="l-nav__item" href="#activity">📊 Activity</a>
          </nav>
          <div>
            <p className="l-eyebrow" style={{ padding: '0 var(--space-3)', margin: '0 0 var(--space-2)' }}>
              Your agents
            </p>
            <nav className="l-nav">
              {data.agents.map((a) => (
                <a key={a.id} className="l-nav__item" href="#agents" title={a.status === 'active' ? 'Active' : 'Paused'}>
                  <Avatar agentKey={a.agentKey} name={a.displayName} sm />
                  {a.displayName}
                  <span className={`l-dot ${a.status === 'active' ? 'l-dot--live' : 'l-dot--paused'}`} style={{ marginLeft: 'auto' }} />
                </a>
              ))}
            </nav>
          </div>
          <span className="l-spacer" />
          <div className="l-card" style={{ background: 'var(--bg-canvas)' }}>
            <div className="l-card__body" style={{ padding: 'var(--space-3)' }}>
              <div className="l-meter">
                <div className="l-meter__label">
                  <span>Tools connected</span>
                  <span className="l-num">{connectedTools}</span>
                </div>
                <div className="l-meter__track">
                  <div className="l-meter__fill" style={{ width: `${Math.min(100, connectedTools * 20)}%` }} />
                </div>
              </div>
              <p className="l-xs l-muted" style={{ margin: 'var(--space-3) 0 0' }}>{data.workspace.name}</p>
              <button
                className="l-btn l-btn--ghost l-btn--sm"
                style={{ marginTop: 'var(--space-2)' }}
                onClick={async () => {
                  await api('/auth/logout', { body: {} });
                  router.push('/login');
                }}
              >
                Log out
              </button>
            </div>
          </div>
        </aside>

        <div id="dashboard">
          <header className="l-topbar">
            <span className="l-sm l-muted">{data.workspace.name}</span>
            <span className="l-spacer" />
            <button
              className="l-btn l-btn--secondary l-btn--sm"
              disabled={activeAgents === 0}
              onClick={() =>
                setConfirm({
                  title: 'Pause all agents?',
                  body: `All ${activeAgents} active agents stop taking new work immediately. Queued runs stay queued and nothing is deleted — resume any time from the agent card.`,
                  confirmLabel: 'Pause all agents',
                  onConfirm: () => withActionError(pauseAllAgents),
                })
              }
            >
              Pause all agents
            </button>
          </header>

          <div className="l-main l-col" style={{ gap: 'var(--space-6)' }}>
            {toast && <div className="l-banner l-banner--success" role="status">{toast}</div>}
            {actionError && (
              <div className="l-banner l-banner--danger" role="alert">
                <div>
                  <b>That didn't go through.</b>
                  <br />
                  {actionError}
                </div>
                <span className="l-spacer" />
                <button className="l-btn l-btn--ghost l-btn--sm" onClick={() => setActionError(null)}>
                  Dismiss
                </button>
              </div>
            )}
            {failedRuns.length > 0 && (
              <div className="l-banner l-banner--warning">
                <span>
                  <b>{failedRuns.length} run{failedRuns.length > 1 ? 's' : ''} failed.</b> Nothing else was affected — the
                  workflow stays active and you can run it again.
                </span>
                <span className="l-spacer" />
                <a href="#runs">See what failed</a>
              </div>
            )}

            <div className="l-row">
              <div>
                <h1 style={{ margin: 0 }}>
                  {greeting()}, {data.workspace.name}
                </h1>
                <p style={{ margin: 0 }}>
                  {approvals.length > 0
                    ? `${approvals.length} thing${approvals.length > 1 ? 's' : ''} need you. Everything else ran on its own.`
                    : 'Nothing needs you right now.'}
                </p>
              </div>
            </div>

            {/* Approvals — the daily-use anchor opens on what needs the human. */}
            <div className="l-card" id="approvals" style={approvals.length > 0 ? { borderColor: 'var(--border-accent)' } : undefined}>
              <div className="l-card__header">
                <h3>Waiting on you</h3>
                {approvals.length > 0 && <span className="l-badge l-badge--accent l-num">{approvals.length}</span>}
              </div>
              {approvals.length === 0 ? (
                <div className="l-card__body">
                  <div className="l-empty">
                    <div className="l-empty__icon">✅</div>
                    <h3>Nothing needs you</h3>
                    <p>When an agent wants to send, post or spend outside its autonomy, it lands here first.</p>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0 var(--space-2)' }}>
                  <table className="l-table">
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}></th>
                        <th>What</th>
                        <th>Who made it</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvals.map((ap) => (
                        <tr key={ap.id}>
                          <td>
                            <Avatar agentKey={agentKeyOf(ap.workspaceAgentId)} name={agentName(ap.workspaceAgentId)} sm />
                          </td>
                          <td>{ap.summary}</td>
                          <td className="l-muted">
                            {agentName(ap.workspaceAgentId)} · {ap.actionKind} · {new Date(ap.createdAt).toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              className="l-btn l-btn--primary l-btn--sm"
                              disabled={busyApprovalId === ap.id}
                              onClick={() => decideApproval(ap.id, 'approved')}
                            >
                              {busyApprovalId === ap.id ? 'Saving…' : 'Approve'}
                            </button>
                            <button
                              className="l-btn l-btn--ghost l-btn--sm"
                              disabled={busyApprovalId === ap.id}
                              style={{ marginLeft: 8 }}
                              onClick={() =>
                                setConfirm({
                                  title: 'Reject this?',
                                  body: `"${ap.summary}"\n\n${agentName(ap.workspaceAgentId)} will not send, post or spend anything. The draft is kept in the run history so you can revisit it.`,
                                  confirmLabel: 'Reject',
                                  onConfirm: () => decideApproval(ap.id, 'rejected'),
                                })
                              }
                            >
                              Reject
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="l-grid l-grid--4">
              <div className="l-card"><div className="l-card__body l-metric">
                <span className="l-metric__label">Active agents</span>
                <span className="l-metric__value l-num">{activeAgents}</span>
                <span className="l-metric__delta">{data.agents.length} hired</span>
              </div></div>
              <div className="l-card"><div className="l-card__body l-metric">
                <span className="l-metric__label">Workflows</span>
                <span className="l-metric__value l-num">{data.workflows.length}</span>
                <span className="l-metric__delta">{data.workflows.filter((w) => w.status === 'active').length} active</span>
              </div></div>
              <div className="l-card"><div className="l-card__body l-metric">
                <span className="l-metric__label">Recent runs</span>
                <span className="l-metric__value l-num">{runs.length}</span>
                <span className="l-metric__delta">{runs.filter((r) => r.status === 'succeeded').length} succeeded</span>
              </div></div>
              <div className="l-card"><div className="l-card__body l-metric">
                <span className="l-metric__label">Escalated to you</span>
                <span className="l-metric__value l-num">{approvals.length}</span>
                <span className="l-metric__delta">{approvals.length === 0 ? 'all clear' : 'waiting'}</span>
              </div></div>
            </div>

            {/* Task composer — give an agent something to do, result lands here. */}
            <div className="l-card" id="composer">
              <div className="l-card__header">
                <h3>Give an agent a task</h3>
              </div>
              {hiredCatalog.length === 0 ? (
                <div className="l-card__body">
                  <div className="l-empty">
                    <div className="l-empty__icon">🧑‍💼</div>
                    <h3>No agents yet</h3>
                    <p>Pick one job you'd hand to a new assistant. Linda takes about four minutes to set up and you can pause it any time.</p>
                    <Link className="l-btn l-btn--primary" href={`/onboarding?workspace=${workspaceId}`}>
                      Hire your first agent
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="l-card__body l-composer l-col" style={{ gap: 'var(--space-3)' }}>
                  <div className="l-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <label className="l-field">
                      <span className="l-label">Agent</span>
                      <select
                        className="l-input"
                        value={activeAgentKey}
                        onChange={(e) => {
                          setTaskAgent(e.target.value);
                          setTaskTemplate('');
                        }}
                      >
                        {hiredCatalog.map((c) => (
                          <option key={c.key} value={c.key}>{c.persona} · {c.role}</option>
                        ))}
                      </select>
                    </label>
                    <label className="l-field">
                      <span className="l-label">Task</span>
                      <select className="l-input" value={activeTemplateKey} onChange={(e) => setTaskTemplate(e.target.value)}>
                        {templates.map((t) => (
                          <option key={t.key} value={t.key}>{t.title}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <textarea
                    className="l-textarea"
                    rows={3}
                    placeholder={`Tell ${persona(activeAgentKey)} what you need, in your own words…`}
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                  />
                  <div className="l-row">
                    <button
                      className="l-btn l-btn--primary"
                      onClick={submitTask}
                      disabled={submittingTask || !taskInput.trim()}
                    >
                      {submittingTask ? 'Working…' : `Ask ${persona(activeAgentKey)}`}
                    </button>
                    <span className="l-help">Runs instantly — you see the result here.</span>
                  </div>
                  {submittingTask && (
                    <div className="l-col" style={{ gap: 6 }}>
                      <div className="l-skeleton" style={{ width: '40%', height: 11 }} />
                      <div className="l-skeleton" style={{ width: '90%', height: 9 }} />
                    </div>
                  )}
                  {latestTask && !submittingTask && (
                    <div className="l-col" style={{ gap: 4 }}>
                      <div className="l-row">
                        <strong>{latestTask.title}</strong>
                        <span className="l-spacer" />
                        {statusBadge(latestTask.status)}
                      </div>
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{latestTask.output}</pre>
                      <p className="l-xs l-muted l-num" style={{ margin: 0 }}>{latestTask.tokensUsed} tokens used</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="l-card" id="tasks">
              <div className="l-card__header">
                <h3>Recent tasks</h3>
              </div>
              {tasks.length === 0 ? (
                <div className="l-card__body">
                  <div className="l-empty">
                    <div className="l-empty__icon">📝</div>
                    <h3>No tasks yet</h3>
                    <p>Ask an agent for something above — the result lands here.</p>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0 var(--space-2)' }}>
                  <table className="l-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Agent</th>
                        <th>When</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => (
                        <tr key={t.id}>
                          <td>{t.title}</td>
                          <td className="l-muted">{persona(t.agent)} · {t.category}</td>
                          <td className="l-muted l-num">{new Date(t.createdAt).toLocaleString()}</td>
                          <td>{statusBadge(t.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="l-card" id="agents">
              <div className="l-card__header">
                <h3>Your agents</h3>
                <span className="l-xs l-muted">{connectedTools} tools connected</span>
              </div>
              <div className="l-card__body l-grid l-grid--3">
                {data.agents.map((a) => (
                  <article key={a.id} className="l-card l-card--interactive l-col" style={{ gap: 'var(--space-2)' }}>
                    <div className="l-row">
                      <Avatar agentKey={a.agentKey} name={a.displayName} />
                      <div>
                        <h3 style={{ margin: 0 }}>{a.displayName}</h3>
                        <AgentStatus status={a.status} />
                      </div>
                    </div>
                    <p className="l-xs l-muted" style={{ margin: 0 }}>
                      {data.workflows.filter((w) => w.workspaceAgentId === a.id).length} workflows
                    </p>
                    <span className="l-spacer" />
                    <button className="l-btn l-btn--secondary l-btn--sm" onClick={() => toggleAgent(a.id, a.status)}>
                      {a.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                  </article>
                ))}
              </div>
            </div>

            <div className="l-card">
              <div className="l-card__header">
                <h3>Workflows</h3>
              </div>
              {data.workflows.length === 0 ? (
                <div className="l-card__body">
                  <div className="l-empty">
                    <div className="l-empty__icon">⚙️</div>
                    <h3>No workflows yet</h3>
                    <p>Workflows are created when you hire agents. Hire one to get your first.</p>
                    <Link className="l-btn l-btn--primary" href={`/onboarding?workspace=${workspaceId}`}>
                      Hire an agent
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="l-card__body l-col" style={{ gap: 'var(--space-2)' }}>
                  {data.workflows.map((w) => (
                    <div key={w.id} className="l-row" style={{ gap: 'var(--space-3)' }}>
                      <div style={{ flex: 1 }}>
                        <div className="l-sm" style={{ color: 'var(--text-primary)' }}>
                          <b>{w.name}</b>
                          {w.status !== 'active' && (
                            <span className="l-badge" style={{ marginLeft: 8 }}>{w.status}</span>
                          )}
                        </div>
                        <div className="l-xs l-muted">
                          {agentName(w.workspaceAgentId)} · {w.definitionKey}
                        </div>
                      </div>
                      <button
                        className="l-btn l-btn--primary l-btn--sm"
                        disabled={runningId === w.id || w.status !== 'active'}
                        onClick={() => runWorkflow(w.id)}
                      >
                        {runningId === w.id ? 'Running…' : 'Run now'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="l-card" id="runs">
              <div className="l-card__header">
                <h3>Recent runs</h3>
              </div>
              {runs.length === 0 ? (
                <div className="l-card__body">
                  <div className="l-empty">
                    <div className="l-empty__icon">🏃</div>
                    <h3>Nothing has run yet</h3>
                    <p>Run a workflow manually, or wait for its schedule — runs show up here with what each agent did.</p>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0 var(--space-2)' }}>
                  <table className="l-table">
                    <thead>
                      <tr>
                        <th>Workflow</th>
                        <th>When</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => {
                        const wf = data.workflows.find((w) => w.id === r.workflowId);
                        return (
                          <tr key={r.id}>
                            <td>
                              {wf?.name ?? 'Workflow'}
                              {r.error && <div className="l-xs" style={{ color: 'var(--danger)' }}>{r.error}</div>}
                            </td>
                            <td className="l-muted l-num">
                              {r.trigger} · {new Date(r.createdAt).toLocaleString()}
                            </td>
                            <td>{statusBadge(r.status)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="l-card" id="activity">
              <div className="l-card__header">
                <h3>Activity</h3>
              </div>
              {activity.length === 0 ? (
                <div className="l-card__body">
                  <div className="l-empty">
                    <div className="l-empty__icon">📊</div>
                    <h3>No activity yet</h3>
                    <p>Everything your agents do — runs, approvals, connections — is logged here.</p>
                  </div>
                </div>
              ) : (
                <div className="l-card__body l-col" style={{ gap: 'var(--space-4)' }}>
                  {activity.map((e) => (
                    <div key={e.id} className="l-row" style={{ alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div className="l-sm" style={{ color: 'var(--text-primary)' }}>{e.summary}</div>
                        <div className="l-xs l-muted">{e.kind}</div>
                      </div>
                      <span className="l-xs l-muted l-num">{new Date(e.createdAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<SkeletonDashboard />}>
      <Dashboard />
    </Suspense>
  );
}
