'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';

type Overview = {
  workspace: { id: string; name: string; onboardingStep: string };
  agents: { id: string; agentKey: string; displayName: string; status: string }[];
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

function statusPill(status: string) {
  const cls = status === 'succeeded' ? 'ok' : status === 'failed' ? 'danger' : status === 'queued' || status === 'running' ? 'warn' : '';
  return <span className={`pill ${cls}`}>{status}</span>;
}

function Dashboard() {
  const router = useRouter();
  const workspaceId = useSearchParams().get('workspace');

  const [data, setData] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [catalog, setCatalog] = useState<CatalogAgent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Composer state: which hired agent, which template, what instruction.
  const [taskAgent, setTaskAgent] = useState<string>('');
  const [taskTemplate, setTaskTemplate] = useState<string>('');
  const [taskInput, setTaskInput] = useState('');
  const [submittingTask, setSubmittingTask] = useState(false);
  const [latestTask, setLatestTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const [overview, runsRes, activityRes, tasksRes] = await Promise.all([
      api<Overview>(`/workspaces/${workspaceId}`),
      api<{ runs: Run[] }>(`/workspaces/${workspaceId}/runs?limit=15`),
      api<{ events: ActivityEvent[] }>(`/workspaces/${workspaceId}/activity?limit=15`),
      api<{ tasks: Task[] }>(`/tasks?workspaceId=${workspaceId}&limit=10`),
    ]);
    setData(overview);
    setRuns(runsRes.runs);
    setActivity(activityRes.events);
    setTasks(tasksRes.tasks);
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
    load().catch((err) => setError((err as Error).message));
  }, [workspaceId, load, router]);

  async function runWorkflow(id: string) {
    setRunningId(id);
    setError(null);
    try {
      await api(`/workspaces/${workspaceId}/workflows/${id}/run`, { body: {} });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunningId(null);
    }
  }

  async function toggleAgent(agentId: string, status: string) {
    setError(null);
    try {
      await api(`/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        body: { status: status === 'active' ? 'paused' : 'active' },
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitTask() {
    if (!taskAgent || !taskInput.trim()) return;
    setSubmittingTask(true);
    setError(null);
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmittingTask(false);
    }
  }

  if (!workspaceId) return null;
  if (error && !data) return <main className="shell"><p className="error">{error}</p></main>;
  if (!data) return <main className="shell"><p className="muted">Loading…</p></main>;

  const agentName = (workspaceAgentId: string) =>
    data.agents.find((a) => a.id === workspaceAgentId)?.displayName ?? 'Agent';

  // Catalog data for the composer, restricted to agents this workspace hired.
  const catalogByKey = Object.fromEntries(catalog.map((c) => [c.key, c]));
  const hiredKeys = data.agents.map((a) => a.agentKey);
  const hiredCatalog = catalog.filter((c) => hiredKeys.includes(c.key));
  const activeAgentKey = taskAgent || hiredCatalog[0]?.key || '';
  const templates = catalogByKey[activeAgentKey]?.taskTemplates ?? [];
  const activeTemplateKey = taskTemplate || templates[0]?.key || '';
  const persona = (agentKey: string) => catalogByKey[agentKey]?.persona ?? agentKey;

  return (
    <>
      <nav className="topbar">
        <div className="inner">
          <Link href="/" className="brand">Linda</Link>
          <div className="row">
            <span className="muted">{data.workspace.name}</span>
            <button
              onClick={async () => {
                await api('/auth/logout', { body: {} });
                router.push('/login');
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </nav>

      <main className="shell stack">
        {error && <p className="error" role="alert">{error}</p>}

        <section className="stack">
          <div className="spread">
            <h2>Your agents</h2>
            <span className="muted">{data.connections.filter((c) => c.status === 'connected').length} tools connected</span>
          </div>
          <div className="grid">
            {data.agents.map((a) => (
              <article key={a.id} className="card stack" style={{ gap: 8 }}>
                <div className="spread">
                  <h3>{a.displayName}</h3>
                  <span className={`pill ${a.status === 'active' ? 'ok' : ''}`}>{a.status}</span>
                </div>
                <p className="muted">
                  {data.workflows.filter((w) => w.workspaceAgentId === a.id).length} workflows
                </p>
                <button onClick={() => toggleAgent(a.id, a.status)}>
                  {a.status === 'active' ? 'Pause' : 'Resume'}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2>Give an agent a task</h2>
          {hiredCatalog.length === 0 && <p className="muted">Hire an agent first — finish onboarding.</p>}
          {hiredCatalog.length > 0 && (
            <div className="card stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label>
                  <span className="muted">Agent</span>{' '}
                  <select value={activeAgentKey} onChange={(e) => { setTaskAgent(e.target.value); setTaskTemplate(''); }}>
                    {hiredCatalog.map((c) => (
                      <option key={c.key} value={c.key}>{c.persona} · {c.role}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="muted">Task</span>{' '}
                  <select value={activeTemplateKey} onChange={(e) => setTaskTemplate(e.target.value)}>
                    {templates.map((t) => (
                      <option key={t.key} value={t.key}>{t.title}</option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                rows={3}
                placeholder={`Tell ${persona(activeAgentKey)} what you need, in your own words…`}
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
              />
              <div className="row">
                <button onClick={submitTask} disabled={submittingTask || !taskInput.trim()}>
                  {submittingTask ? 'Working…' : `Ask ${persona(activeAgentKey)}`}
                </button>
                <span className="muted">Runs instantly — you see the result here.</span>
              </div>
              {latestTask && (
                <div className="stack" style={{ gap: 4 }}>
                  <div className="spread">
                    <strong>{latestTask.title}</strong>
                    {statusPill(latestTask.status)}
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{latestTask.output}</pre>
                  <p className="muted">{latestTask.tokensUsed} tokens used</p>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="stack">
          <h2>Recent tasks</h2>
          {tasks.length === 0 && <p className="muted">No tasks yet — ask an agent for something above.</p>}
          <div className="stack" style={{ gap: 8 }}>
            {tasks.map((t) => (
              <div key={t.id} className="card spread">
                <div>
                  <h3>{t.title}</h3>
                  <p className="muted">
                    {persona(t.agent)} · {t.category} · {new Date(t.createdAt).toLocaleString()}
                  </p>
                </div>
                {statusPill(t.status)}
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2>Workflows</h2>
          <div className="stack" style={{ gap: 8 }}>
            {data.workflows.map((w) => (
              <div key={w.id} className="card spread">
                <div>
                  <h3>{w.name}</h3>
                  <p className="muted">
                    {agentName(w.workspaceAgentId)} · <span className="mono">{w.definitionKey}</span>
                  </p>
                </div>
                <div className="row">
                  {w.status !== 'active' && <span className="pill">{w.status}</span>}
                  <button onClick={() => runWorkflow(w.id)} disabled={runningId === w.id || w.status !== 'active'}>
                    {runningId === w.id ? 'Running…' : 'Run now'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2>Recent runs</h2>
          {runs.length === 0 && <p className="muted">Nothing has run yet.</p>}
          <div className="stack" style={{ gap: 8 }}>
            {runs.map((r) => (
              <div key={r.id} className="card spread">
                <div>
                  <h3>{data.workflows.find((w) => w.id === r.workflowId)?.name ?? 'Workflow'}</h3>
                  <p className="muted">
                    {r.trigger} · {new Date(r.createdAt).toLocaleString()}
                    {r.error && <> · <span style={{ color: 'var(--danger)' }}>{r.error}</span></>}
                  </p>
                </div>
                {statusPill(r.status)}
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2>Activity</h2>
          <div className="card stack" style={{ gap: 10 }}>
            {activity.length === 0 && <p className="muted">No activity yet.</p>}
            {activity.map((e) => (
              <div key={e.id} className="spread">
                <span>{e.summary}</span>
                <span className="muted mono">{new Date(e.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<main className="shell"><p className="muted">Loading…</p></main>}>
      <Dashboard />
    </Suspense>
  );
}
