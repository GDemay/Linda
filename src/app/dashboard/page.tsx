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
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const [overview, runsRes, activityRes] = await Promise.all([
      api<Overview>(`/workspaces/${workspaceId}`),
      api<{ runs: Run[] }>(`/workspaces/${workspaceId}/runs?limit=15`),
      api<{ events: ActivityEvent[] }>(`/workspaces/${workspaceId}/activity?limit=15`),
    ]);
    setData(overview);
    setRuns(runsRes.runs);
    setActivity(activityRes.events);
  }, [workspaceId]);

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

  if (!workspaceId) return null;
  if (error && !data) return <main className="shell"><p className="error">{error}</p></main>;
  if (!data) return <main className="shell"><p className="muted">Loading…</p></main>;

  const agentName = (workspaceAgentId: string) =>
    data.agents.find((a) => a.id === workspaceAgentId)?.displayName ?? 'Agent';

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
