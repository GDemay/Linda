'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/client.ts';

type Status = {
  step: string;
  progress: number;
  isComplete: boolean;
  agents: { key: string; name: string }[];
  providers: { required: string[]; optional: string[]; connected: string[]; missing: string[] };
};

type CatalogAgent = {
  key: string;
  name: string;
  role: string;
  blurb: string;
  requiredProviders: string[];
  optionalProviders: string[];
};

const STEP_LABELS: Record<string, string> = {
  company_profile: 'About you',
  pick_goals: 'Your goals',
  hire_agents: 'Your team',
  connect_tools: 'Connect tools',
  first_run: 'Go live',
  done: 'Done',
};
const ORDER = ['company_profile', 'pick_goals', 'hire_agents', 'connect_tools', 'first_run'];

function OnboardingFlow() {
  const router = useRouter();
  const workspaceId = useSearchParams().get('workspace');

  const [status, setStatus] = useState<Status | null>(null);
  const [catalog, setCatalog] = useState<{ agents: CatalogAgent[]; goals: { key: string; label: string }[] } | null>(null);
  const [recommended, setRecommended] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [profile, setProfile] = useState({
    legalName: '',
    industry: '',
    size: '2-10',
    website: '',
    description: '',
    tone: 'professional',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  const [goals, setGoals] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [connected, setConnected] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setStatus(await api<Status>(`/workspaces/${workspaceId}/onboarding`));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      router.replace('/signup');
      return;
    }
    Promise.all([api('/catalog'), refresh()])
      .then(([c]) => setCatalog(c))
      .catch((err) => setError((err as Error).message));
  }, [workspaceId, refresh, router]);

  // Once the recommendation lands, preselect it so the default path is one click.
  useEffect(() => {
    if (recommended.length && picked.length === 0) setPicked(recommended);
  }, [recommended, picked.length]);

  async function step<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!workspaceId) return null;
  if (error && !status) return <main className="shell narrow"><p className="error">{error}</p></main>;
  if (!status || !catalog) return <main className="shell narrow"><p className="muted">Loading…</p></main>;

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const wantedProviders = [
    ...new Set(
      catalog.agents
        .filter((a) => picked.includes(a.key))
        .flatMap((a) => [...a.requiredProviders, ...a.optionalProviders]),
    ),
  ];

  return (
    <main className="shell narrow stack">
      <header className="stack" style={{ gap: 10 }}>
        <h1>Set up your workspace</h1>
        <div className="progress" role="progressbar" aria-valuenow={status.progress} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${status.progress}%` }} />
        </div>
        <ol className="steps">
          {ORDER.map((s, i) => (
            <li
              key={s}
              data-state={
                ORDER.indexOf(status.step) > i || status.isComplete
                  ? 'done'
                  : status.step === s
                    ? 'current'
                    : 'todo'
              }
            >
              {i > 0 && <span aria-hidden> · </span>}
              {STEP_LABELS[s]}
            </li>
          ))}
        </ol>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      {status.step === 'company_profile' && (
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await step(() => api(`/workspaces/${workspaceId}/onboarding/profile`, { body: profile }));
          }}
        >
          <h2>Tell us about your company</h2>
          <p className="muted">Your agents use this to sound like you from their first message.</p>
          <div>
            <label htmlFor="legalName">Company name</label>
            <input id="legalName" required value={profile.legalName} onChange={(e) => setProfile({ ...profile, legalName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="industry">Industry</label>
            <input id="industry" required value={profile.industry} onChange={(e) => setProfile({ ...profile, industry: e.target.value })} />
          </div>
          <div>
            <label htmlFor="size">Team size</label>
            <select id="size" value={profile.size} onChange={(e) => setProfile({ ...profile, size: e.target.value })}>
              {['solo', '2-10', '11-50', '51-200', '200+'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="website">Website (optional)</label>
            <input id="website" type="url" placeholder="https://" value={profile.website} onChange={(e) => setProfile({ ...profile, website: e.target.value })} />
          </div>
          <div>
            <label htmlFor="description">What do you do?</label>
            <textarea id="description" rows={3} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} />
          </div>
          <div>
            <label htmlFor="tone">Tone of voice</label>
            <select id="tone" value={profile.tone} onChange={(e) => setProfile({ ...profile, tone: e.target.value })}>
              {['professional', 'friendly', 'concise', 'formal'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
        </form>
      )}

      {status.step === 'pick_goals' && (
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await step(() =>
              api<{ recommended: { key: string }[] }>(`/workspaces/${workspaceId}/onboarding/goals`, { body: { goals } }),
            );
            if (res) setRecommended(res.recommended.map((r) => r.key));
          }}
        >
          <h2>What should we take off your plate?</h2>
          <p className="muted">Pick as many as you like — we&apos;ll suggest the right agents.</p>
          <div className="stack" style={{ gap: 8 }}>
            {catalog.goals.map((g) => (
              <label key={g.key} className="choice" data-selected={goals.includes(g.key)}>
                <input type="checkbox" checked={goals.includes(g.key)} onChange={() => setGoals((v) => toggle(v, g.key))} />
                <span>{g.label}</span>
              </label>
            ))}
          </div>
          <button className="primary" disabled={busy || goals.length === 0}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </form>
      )}

      {status.step === 'hire_agents' && (
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await step(() =>
              api(`/workspaces/${workspaceId}/onboarding/agents`, {
                body: { agents: picked.map((key) => ({ key, config: {} })) },
              }),
            );
          }}
        >
          <h2>Meet your team</h2>
          <p className="muted">
            {recommended.length ? 'Based on your goals. Add or remove anyone.' : 'Choose who joins your workspace.'}
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {catalog.agents.map((a) => (
              <label key={a.key} className="choice" data-selected={picked.includes(a.key)}>
                <input type="checkbox" checked={picked.includes(a.key)} onChange={() => setPicked((v) => toggle(v, a.key))} />
                <span>
                  <strong>{a.name}</strong> <span className="pill">{a.role}</span>
                  {recommended.includes(a.key) && <span className="pill ok" style={{ marginLeft: 4 }}>Recommended</span>}
                  <br />
                  <span className="muted">{a.blurb}</span>
                </span>
              </label>
            ))}
          </div>
          <button className="primary" disabled={busy || picked.length === 0}>
            {busy ? 'Hiring…' : `Hire ${picked.length || ''} agent${picked.length === 1 ? '' : 's'}`}
          </button>
        </form>
      )}

      {status.step === 'connect_tools' && (
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await step(() =>
              api(`/workspaces/${workspaceId}/onboarding/connections`, {
                body: { connections: connected.map((provider) => ({ provider })) },
              }),
            );
          }}
        >
          <h2>Connect your tools</h2>
          <p className="muted">
            Every one of these is optional. Skip them and your agents still run — the steps that need a
            tool simply stand down until you connect it.
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {wantedProviders.map((p) => (
              <label key={p} className="choice" data-selected={connected.includes(p)}>
                <input type="checkbox" checked={connected.includes(p)} onChange={() => setConnected((v) => toggle(v, p))} />
                <span>
                  {p}
                  {status.providers.required.includes(p) && <span className="pill warn" style={{ marginLeft: 6 }}>Recommended</span>}
                </span>
              </label>
            ))}
            {wantedProviders.length === 0 && <p className="muted">Your agents don&apos;t need any integrations.</p>}
          </div>
          <div className="row">
            <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setConnected([]);
                await step(() => api(`/workspaces/${workspaceId}/onboarding/connections`, { body: { connections: [], skip: true } }));
              }}
            >
              Skip for now
            </button>
          </div>
        </form>
      )}

      {status.step === 'first_run' && (
        <div className="card stack">
          <h2>You&apos;re ready</h2>
          <p className="muted">
            {status.agents.map((a) => a.name).join(', ')} {status.agents.length === 1 ? 'is' : 'are'} configured
            and waiting. We&apos;ll kick off their first job now so you land on something real.
          </p>
          {status.providers.missing.length > 0 && (
            <p className="muted">
              Not connected yet: {status.providers.missing.join(', ')}. You can add these any time from settings.
            </p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              const res = await step(() => api(`/workspaces/${workspaceId}/onboarding/complete`, { body: {} }));
              if (res) router.push(`/dashboard?workspace=${workspaceId}`);
            }}
          >
            {busy ? 'Starting…' : 'Activate my workspace'}
          </button>
        </div>
      )}

      {status.isComplete && (
        <div className="card stack">
          <h2>Your workspace is live</h2>
          <button className="primary" onClick={() => router.push(`/dashboard?workspace=${workspaceId}`)}>
            Go to dashboard
          </button>
        </div>
      )}
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<main className="shell narrow"><p className="muted">Loading…</p></main>}>
      <OnboardingFlow />
    </Suspense>
  );
}
