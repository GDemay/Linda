'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.ts';
import { STARTER_TASKS, starterTaskBody, type StarterTask } from '@/lib/tasks/starters.ts';
import { dashboardNudges, type UpgradeNudge } from '@/lib/billing/nudges.ts';
import { formatDate, formatDateTime, formatTime, stripMarkup } from '@/lib/ui/format.ts';
import { MemoryPanel, type Memory } from '@/app/components/MemoryPanel.tsx';

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

type KnowledgeDoc = {
  id: string;
  title: string;
  source: string;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  agentKeys: string[];
  chunkCount: number;
  lastUsedAt: string | null;
};

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

/** Billing slice the dashboard needs to decide whether to show the upgrade prompt (LIN-131) and nudges (LIN-143). */
type BillingBanner = {
  plan: { key: string; name: string; readOnly: boolean };
  trial: { daysLeft: number } | null;
  usage: { creditsUsed: number; limitCredits: number; ratio: number; capped: boolean };
  agents: { name: string; status: string; pausedReason: string | null }[];
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

/** Fire-and-forget nudge funnel beacon — same shape as PageEvent, plus which nudge. */
function nudgeBeacon(name: 'upgrade_nudge_view' | 'upgrade_nudge_click', kind: UpgradeNudge['kind']) {
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data: { kind } }),
    keepalive: true,
  }).catch(() => {});
}

const NUDGE_DISMISSED_KEY = 'linda.nudges.dismissed';
const NUDGE_VIEWED_KEY = 'linda.nudges.viewed';

function readSessionList(key: string): string[] {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Pre-expiry trial nudges (LIN-143): soft, dismissible-per-session warning
 * banners, unlike the hard LIN-131 prompt. The view beacon fires once per
 * nudge kind per session so nudge CTR keeps a stable denominator across
 * dashboard reloads.
 */
function useUpgradeNudges(billing: BillingBanner | null) {
  const [dismissed, setDismissed] = useState<string[]>([]);

  // Dismissal survives remounts within the session (not across sessions).
  useEffect(() => {
    setDismissed(readSessionList(NUDGE_DISMISSED_KEY));
  }, []);

  useEffect(() => {
    if (!billing) return;
    const viewed = readSessionList(NUDGE_VIEWED_KEY);
    const fresh = dashboardNudges(billing).filter((n) => !viewed.includes(n.kind));
    if (fresh.length === 0) return;
    for (const n of fresh) nudgeBeacon('upgrade_nudge_view', n.kind);
    sessionStorage.setItem(NUDGE_VIEWED_KEY, JSON.stringify([...viewed, ...fresh.map((n) => n.kind)]));
  }, [billing]);

  const dismiss = useCallback((kind: UpgradeNudge['kind']) => {
    setDismissed((prev) => {
      const next = prev.includes(kind) ? prev : [...prev, kind];
      sessionStorage.setItem(NUDGE_DISMISSED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const nudges = billing ? dashboardNudges(billing).filter((n) => !dismissed.includes(n.kind)) : [];
  return { nudges, dismiss };
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

/** The URL starter (LIN-153) needs one well-formed link before it can run. */
function isValidStarterUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
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
  const [knowledge, setKnowledge] = useState<KnowledgeDoc[]>([]);
  const [kbTitle, setKbTitle] = useState('');
  const [kbText, setKbText] = useState('');
  const [kbUrl, setKbUrl] = useState('');
  const [kbScope, setKbScope] = useState<string[]>([]);
  const [removingDoc, setRemovingDoc] = useState<KnowledgeDoc | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [billing, setBilling] = useState<BillingBanner | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const { toast, show } = useToast();
  const { nudges, dismiss } = useUpgradeNudges(billing);

  // Composer state: which hired agent, which template, what instruction.
  const [taskAgent, setTaskAgent] = useState<string>('');
  const [taskTemplate, setTaskTemplate] = useState<string>('');
  const [taskInput, setTaskInput] = useState('');
  const [submittingTask, setSubmittingTask] = useState(false);
  const [latestTask, setLatestTask] = useState<Task | null>(null);

  // Deliverable-edit state (LIN-53): correcting a result can teach the agent.
  const [editingTask, setEditingTask] = useState(false);
  const [editText, setEditText] = useState('');
  const [rememberNote, setRememberNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Starter-launch state (LIN-153): one click from the empty state runs the
  // task; the URL starter needs a single link first.
  const [starterUrl, setStarterUrl] = useState('');
  const [launchingStarter, setLaunchingStarter] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const [overview, runsRes, activityRes, tasksRes, approvalsRes, knowledgeRes, memoriesRes, billingRes] = await Promise.all([
      api<Overview>(`/workspaces/${workspaceId}`),
      api<{ runs: Run[] }>(`/workspaces/${workspaceId}/runs?limit=15`),
      api<{ events: ActivityEvent[] }>(`/workspaces/${workspaceId}/activity?limit=15`),
      api<{ tasks: Task[] }>(`/tasks?workspaceId=${workspaceId}&limit=10`),
      api<{ approvals: Approval[] }>(`/workspaces/${workspaceId}/approvals?status=pending`),
      api<{ documents: KnowledgeDoc[] }>(`/workspaces/${workspaceId}/knowledge`),
      api<{ memories: Memory[] }>(`/workspaces/${workspaceId}/memories`),
      api<BillingBanner>(`/workspaces/${workspaceId}/billing`).catch(() => null),
    ]);
    setData(overview);
    setRuns(runsRes.runs);
    setActivity(activityRes.events);
    setTasks(tasksRes.tasks);
    // The deliverable card is the only surface that shows a task's output.
    // Without this, a reload or fresh login silently loses the latest
    // deliverable (found by the LIN-94 UI-quality gate).
    setLatestTask((current) => current ?? tasksRes.tasks[0] ?? null);
    setApprovals(approvalsRes.approvals);
    setKnowledge(knowledgeRes.documents);
    setMemories(memoriesRes.memories);
    setBilling(billingRes);
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

  function addKnowledgeDoc() {
    return withActionError(async () => {
      const payload = kbText.trim()
        ? { title: kbTitle.trim() || undefined, content: kbText, agentKeys: kbScope }
        : { url: kbUrl.trim(), agentKeys: kbScope };
      await api(`/workspaces/${workspaceId}/knowledge`, { method: 'POST', body: payload });
      setKbTitle('');
      setKbText('');
      setKbUrl('');
      show('Added — your agents ground on it from their next task');
      await load();
    });
  }

  function deleteKnowledgeDoc(doc: KnowledgeDoc) {
    return withActionError(async () => {
      const res = await api<{ removed: string }>(`/workspaces/${workspaceId}/knowledge/${doc.id}`, {
        method: 'DELETE',
      });
      show(res.removed);
      await load();
    });
  }

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
    // `activeAgentKey` (declared below with the other derived values) is the
    // agent the composer actually shows: `taskAgent` stays empty until the
    // user touches the dropdown, and guarding on it made the Ask button a
    // silent no-op for a freshly loaded composer (LIN-94).
    const agent = taskAgent || activeAgentKey;
    if (!agent || !taskInput.trim()) return;
    return withActionError(async () => {
      setSubmittingTask(true);
      try {
        const res = await api<{ task: Task }>('/tasks', {
          body: {
            workspaceId,
            agent,
            template: taskTemplate || undefined,
            input: taskInput.trim(),
          },
        });
        setLatestTask(res.task);
        setTaskInput('');
        setEditingTask(false);
        setRememberNote('');
        await load();
        show(`${res.task.title} — done.`);
      } finally {
        setSubmittingTask(false);
      }
    });
  }

  /**
   * One-click starter (LIN-153): the empty state's task is created and
   * executed in a single POST, then the deliverable lands in the composer
   * card — first value with no human in the loop.
   */
  function launchStarter(starter: StarterTask) {
    const url = starter.inputMode === 'url' ? starterUrl.trim() : undefined;
    if (starter.inputMode === 'url' && !isValidStarterUrl(url ?? '')) return;
    return withActionError(async () => {
      setLaunchingStarter(starter.key);
      try {
        const res = await api<{ task: Task }>('/tasks', {
          body: starterTaskBody(starter, workspaceId ?? '', url),
        });
        setLatestTask(res.task);
        setStarterUrl('');
        await load();
        show(`${res.task.title} — done.`);
        // Land them where the result is visible without reading docs.
        document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } finally {
        setLaunchingStarter(null);
      }
    });
  }

  /** Deliverable edit + "Remember this correction" (LIN-53). */
  function saveTaskEdit() {
    if (!latestTask) return;
    return withActionError(async () => {
      setSavingEdit(true);
      try {
        const res = await api<{ task: Task; memory: Memory | null }>(
          `/tasks/${latestTask.id}?workspaceId=${workspaceId}`,
          {
            method: 'PATCH',
            body: { output: editText, rememberNote: rememberNote.trim() || undefined },
          },
        );
        setLatestTask(res.task);
        setEditingTask(false);
        setRememberNote('');
        await load();
        show(res.memory ? 'Saved. The correction is now part of their memory.' : 'Deliverable updated.');
      } finally {
        setSavingEdit(false);
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

  // Guided first-task empty state (LIN-153): offered only until the first
  // *task* exists. Deliberately not gated on runs — onboarding's automatic
  // first workflow run (machine.ts completeOnboarding) would otherwise
  // suppress the starters for every newly-onboarded workspace.
  const showStarters = tasks.length === 0;

  // Upgrade prompt (LIN-131): shown exactly when a limit is in the way —
  // cap reached, trial ending soon / ended (read-only), or billing paused an agent.
  const billingPaused = (billing?.agents ?? []).filter((a) =>
    ['spend_cap', 'trial_ended', 'subscription_canceled'].includes(a.pausedReason ?? ''),
  );
  const upgradePrompt: { title: string; body: string } | null = billing
    ? billing.plan.readOnly
      ? { title: 'Your trial has ended', body: 'The workspace is read-only until you pick a plan — upgrade to resume your agents. Nothing was deleted.' }
      : billing.usage.capped
        ? { title: 'Monthly usage cap reached', body: `Agents are paused at ${billing.usage.creditsUsed.toFixed(0)} of ${billing.usage.limitCredits.toLocaleString('en-US')} credits. Upgrade for a higher cap, or raise it in billing settings.` }
        : billingPaused.length > 0
          ? { title: `${billingPaused.length === 1 ? 'An agent is' : `${billingPaused.length} agents are`} paused by a billing limit`, body: 'Upgrade lifts the limit and resumes them immediately.' }
          : billing.trial && billing.trial.daysLeft <= 3
            ? { title: `Trial ends in ${billing.trial.daysLeft} day${billing.trial.daysLeft === 1 ? '' : 's'}`, body: 'Pick a plan now so your agents keep running without a pause.' }
            : null
    : null;

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
            <a className="l-nav__item" href="#knowledge">📚 Knowledge</a>
            <a className="l-nav__item" href="#activity">📊 Activity</a>
            <a className="l-nav__item" href={`/dashboard/upgrade?workspace=${encodeURIComponent(workspaceId ?? '')}`}>
              💳 Upgrade
            </a>
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
          {/* Pre-expiry nudges (LIN-143): soft, dismissible; the hard prompt below still owns the post-facto states. */}
          {nudges.map((nudge) => (
            <div key={nudge.kind} role="status" className="l-banner l-banner--warning" style={{ margin: 'var(--space-3)' }}>
              <span>
                {nudge.kind === 'trial_days' ? (
                  <>
                    <b>
                      {nudge.daysLeft} day{nudge.daysLeft === 1 ? '' : 's'} left in your trial
                    </b>{' '}
                    — keep your agents running.
                  </>
                ) : (
                  <>
                    <b>You've used {Math.round(nudge.ratio * 100)}% of this month's credits</b>{' '}
                    ({nudge.creditsUsed.toFixed(0)}/{nudge.limitCredits.toLocaleString('en-US')}) — agents pause at the
                    cap.
                  </>
                )}{' '}
                <a
                  href={`/dashboard/upgrade?workspace=${encodeURIComponent(workspaceId ?? '')}`}
                  onClick={() => nudgeBeacon('upgrade_nudge_click', nudge.kind)}
                >
                  Upgrade to keep everything running
                </a>
              </span>
              <span className="l-spacer" />
              <button
                className="l-btn l-btn--ghost l-btn--sm"
                aria-label="Dismiss"
                onClick={() => dismiss(nudge.kind)}
              >
                Dismiss
              </button>
            </div>
          ))}
          {upgradePrompt && (
            <div
              role="alert"
              className="l-card"
              style={{
                margin: 'var(--space-3)',
                borderColor: 'var(--accent)',
                background: 'var(--bg-sunken)',
              }}
            >
              <div className="l-card__body" style={{ padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 320px' }}>
                  <b>{upgradePrompt.title}.</b>
                  <p className="l-xs l-muted" style={{ margin: '4px 0 0' }}>{upgradePrompt.body}</p>
                </div>
                <Link href={`/dashboard/upgrade?workspace=${encodeURIComponent(workspaceId ?? '')}`}>
                  <button className="l-btn l-btn--primary l-btn--sm">See plans — from $49/mo</button>
                </Link>
              </div>
            </div>
          )}
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

            {/* Guided first task (LIN-153): one click, instant execution, the
                result lands below — no docs, no human in the loop. */}
            {showStarters && (
              <div className="l-card" id="starters" style={{ borderColor: 'var(--border-accent)' }}>
                <div className="l-card__header">
                  <h3>Start here — your first result in under a minute</h3>
                </div>
                <div className="l-card__body l-grid l-grid--3">
                  {STARTER_TASKS.map((s) => (
                    <article key={s.key} className="l-card l-card--interactive l-col" style={{ gap: 'var(--space-2)', margin: 0 }}>
                      <div>
                        <b>{s.title}</b>
                        <p className="l-xs l-muted" style={{ margin: '4px 0 0' }}>{s.description}</p>
                      </div>
                      <span className="l-spacer" />
                      {s.inputMode === 'url' && (
                        <input
                          className="l-input"
                          type="url"
                          placeholder="https://…"
                          aria-label="URL to summarize"
                          value={starterUrl}
                          onChange={(e) => setStarterUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') launchStarter(s);
                          }}
                        />
                      )}
                      <button
                        className="l-btn l-btn--primary"
                        disabled={
                          launchingStarter !== null ||
                          (s.inputMode === 'url' && !isValidStarterUrl(starterUrl.trim()))
                        }
                        onClick={() => launchStarter(s)}
                      >
                        {launchingStarter === s.key ? 'Working…' : 'Run it'}
                      </button>
                    </article>
                  ))}
                </div>
                <p className="l-xs l-muted" style={{ margin: '0 var(--space-2) var(--space-2)' }}>
                  Runs instantly — you see the result right here. {persona('assistant')} picks up anything else you ask below.
                </p>
              </div>
            )}

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
                            {agentName(ap.workspaceAgentId)} · {ap.actionKind} · {formatDateTime(ap.createdAt)}
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
                      {editingTask ? (
                        <div className="l-col" style={{ gap: 'var(--space-2)' }}>
                          <textarea
                            className="l-textarea"
                            rows={8}
                            aria-label="Edit the deliverable"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                          />
                          <label className="l-field">
                            <span className="l-label">Remember this correction</span>
                            <input
                              className="l-input"
                              placeholder={`What should ${persona(latestTask.agent)} always do next time?`}
                              value={rememberNote}
                              onChange={(e) => setRememberNote(e.target.value)}
                            />
                          </label>
                          <div className="l-row" style={{ gap: 8 }}>
                            <button
                              className="l-btn l-btn--primary l-btn--sm"
                              disabled={savingEdit || !editText.trim()}
                              onClick={saveTaskEdit}
                            >
                              {savingEdit ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              className="l-btn l-btn--ghost l-btn--sm"
                              disabled={savingEdit}
                              onClick={() => setEditingTask(false)}
                            >
                              Cancel
                            </button>
                            <span className="l-help">
                              {rememberNote.trim()
                                ? `${persona(latestTask.agent)} will apply this on every future task — editable in the agent card below.`
                                : 'Optional: teach the correction so it sticks.'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Display-only: agent markup is stripped so tags never
                              sit in the visible text (LIN-94 bug class). The
                              editor below still gets the raw output. */}
                          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{stripMarkup(latestTask.output)}</pre>
                          <p className="l-xs l-muted l-num" style={{ margin: 0 }}>{latestTask.tokensUsed} tokens used</p>
                          <div>
                            <button
                              className="l-btn l-btn--ghost l-btn--sm"
                              onClick={() => {
                                setEditText(latestTask.output ?? '');
                                setRememberNote('');
                                setEditingTask(true);
                              }}
                            >
                              Edit &amp; correct
                            </button>
                          </div>
                        </>
                      )}
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
                          <td className="l-muted l-num">{formatDateTime(t.createdAt)}</td>
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
                    <MemoryPanel
                      workspaceId={workspaceId}
                      agentKey={a.agentKey}
                      persona={persona(a.agentKey)}
                      memories={memories.filter((m) => m.agentKey === a.agentKey)}
                      onChanged={load}
                      onError={(err) => setActionError(err.message)}
                    />
                  </article>
                ))}
              </div>
            </div>

            {/* Knowledge base — the "add it later" landing spot from onboarding. */}
            <div className="l-card" id="knowledge">
              <div className="l-card__header">
                <h3>Knowledge</h3>
                <span className="l-xs l-muted">
                  {knowledge.length === 0
                    ? 'nothing uploaded yet'
                    : `${knowledge.length} document${knowledge.length === 1 ? '' : 's'} · agents ground on these`}
                </span>
              </div>
              <div className="l-card__body l-col" style={{ gap: 'var(--space-3)' }}>
                {knowledge.length === 0 ? (
                  <p className="l-sm l-muted" style={{ margin: 0 }}>
                    Add pricing sheets, policies or FAQs and your agents draft from them. Skipped this during
                    setup? This is where it lives.
                  </p>
                ) : (
                  <div className="l-col" style={{ gap: 'var(--space-2)' }}>
                    {knowledge.map((doc) => (
                      <div key={doc.id} className="l-row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                        <span aria-hidden>{doc.status === 'ready' ? '📄' : '⚠️'}</span>
                        <span className="l-sm" style={{ flex: 1 }}>
                          {doc.title}
                          <span className="l-xs l-muted" style={{ marginLeft: 'var(--space-2)' }}>
                            {doc.status === 'ready'
                              ? `${doc.chunkCount} chunks${doc.agentKeys.length ? ` · ${doc.agentKeys.length} agent(s)` : ' · everyone'}${doc.lastUsedAt ? ` · last used ${formatDate(doc.lastUsedAt)}` : ''}`
                              : `couldn't be read${doc.error ? `: ${doc.error}` : ''}`}
                          </span>
                        </span>
                        <button
                          className="l-btn l-btn--ghost l-btn--sm"
                          onClick={() =>
                            setConfirm({
                              title: `Remove "${doc.title}"?`,
                              body: `This deletes the document and every extracted chunk derived from it — fully, immediately. Your agents simply stop grounding on it; nothing else in your workspace changes.`,
                              confirmLabel: 'Delete document',
                              onConfirm: () => deleteKnowledgeDoc(doc),
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form
                  className="l-row"
                  style={{ gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (kbText.trim() || kbUrl.trim()) addKnowledgeDoc();
                  }}
                >
                  <label className="l-field" style={{ flex: '1 1 160px', margin: 0 }}>
                    <span className="l-label">Title</span>
                    <input
                      className="l-input"
                      placeholder='e.g. "Pricing 2026"'
                      maxLength={200}
                      value={kbTitle}
                      onChange={(e) => setKbTitle(e.target.value)}
                    />
                  </label>
                  <label className="l-field" style={{ flex: '2 1 240px', margin: 0 }}>
                    <span className="l-label">Paste text</span>
                    <input
                      className="l-input"
                      placeholder="Paste any document your agents should know by heart…"
                      value={kbText}
                      onChange={(e) => setKbText(e.target.value)}
                    />
                  </label>
                  <label className="l-field" style={{ flex: '2 1 240px', margin: 0 }}>
                    <span className="l-label">Or a URL</span>
                    <input
                      className="l-input"
                      type="url"
                      placeholder="https://your-site.com/pricing"
                      value={kbUrl}
                      onChange={(e) => setKbUrl(e.target.value)}
                      disabled={kbText.trim().length > 0}
                    />
                  </label>
                  <button
                    className="l-btn l-btn--secondary l-btn--sm"
                    disabled={!kbText.trim() && !kbUrl.trim()}
                    type="submit"
                  >
                    Add
                  </button>
                </form>
                {data.agents.length > 0 && (
                  <div className="l-row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <span className="l-xs l-muted">Ground everyone, or only:</span>
                    {data.agents.map((a) => (
                      <label key={a.id} className="l-row l-xs" style={{ gap: 'var(--space-1)' }}>
                        <input
                          type="checkbox"
                          checked={kbScope.includes(a.agentKey)}
                          onChange={() =>
                            setKbScope((v) => (v.includes(a.agentKey) ? v.filter((k) => k !== a.agentKey) : [...v, a.agentKey]))
                          }
                        />
                        {a.displayName}
                      </label>
                    ))}
                  </div>
                )}
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
                              {r.trigger} · {formatDateTime(r.createdAt)}
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
                      <span className="l-xs l-muted l-num">{formatTime(e.createdAt)}</span>
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
