'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/client.ts';
import { PRICING_COMMON } from '@/lib/pricing.ts';
import { StateBar, type JourneyState } from '../components/StateBar.tsx';
import { OnboardingRail, type Trial } from '../components/OnboardingRail.tsx';
import type { OnboardingStep } from '@/lib/repos/types.ts';

/**
 * The onboarding wizard (LIN-13), rebuilt on the l-* design system against the
 * shipped state machine in src/lib/onboarding/machine.ts. The step you see is
 * always the workspace's server-persisted `onboardingStep` — the UI never
 * guesses, so a refresh or a full browser close resumes exactly here (AC3).
 */

type Status = {
  step: OnboardingStep;
  completedSteps: OnboardingStep[];
  progress: number;
  isComplete: boolean;
  profile: {
    legalName: string;
    industry: string;
    size: string;
    website: string | null;
    description: string;
    tone: string;
    timezone: string;
    goals: string[];
  } | null;
  agents: { key: string; name: string; status: string }[];
  providers: { required: string[]; optional: string[]; connected: string[]; missing: string[] };
  knowledge: { id: string; title: string; status: string; chunkCount: number; lastUsedAt: string | null }[];
  workflowCount: number;
};

type Workspace = { id: string; name: string; plan: string; createdAt: string };

type CatalogAgent = {
  key: string;
  name: string;
  role: string;
  blurb: string;
  requiredProviders: string[];
  optionalProviders: string[];
};

type Catalog = { agents: CatalogAgent[]; goals: { key: string; label: string }[] };

const ORDER: OnboardingStep[] = ['company_profile', 'pick_goals', 'hire_agents', 'add_knowledge', 'connect_tools', 'first_run'];

const STEP_OF = Object.fromEntries(ORDER.map((s, i) => [s, `Step ${i + 1} of ${ORDER.length}`]));

const SIZES = ['solo', '2-10', '11-50', '51-200', '200+'];
const TONES = ['professional', 'friendly', 'concise', 'formal'];

const DAY_MS = 24 * 60 * 60 * 1000;

function trialFor(workspace: Workspace): Trial {
  const endsAt = new Date(workspace.createdAt).getTime() + PRICING_COMMON.trialDays * DAY_MS;
  return {
    plan: workspace.plan,
    trialDays: PRICING_COMMON.trialDays,
    daysLeft: Math.max(0, Math.ceil((endsAt - Date.now()) / DAY_MS)),
  };
}

function OnboardingFlow() {
  const router = useRouter();
  const workspaceId = useSearchParams().get('workspace');

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [recommended, setRecommended] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState<{ runId: string; status: string } | null | undefined>(undefined);
  const [customState, setCustomState] = useState<JourneyState>('live');

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
  const [prefilled, setPrefilled] = useState(false);
  const [kbTitle, setKbTitle] = useState('');
  const [kbText, setKbText] = useState('');
  const [kbUrl, setKbUrl] = useState('');
  const [kbScope, setKbScope] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const data = await api<{ workspace: Workspace; onboarding: Status }>(`/workspaces/${workspaceId}`);
    setWorkspace(data.workspace);
    setStatus(data.onboarding);
    return data.onboarding;
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      router.replace('/signup');
      return;
    }
    Promise.all([api<Catalog>('/catalog'), refresh()])
      .then(([c]) => setCatalog(c))
      .catch((err) => setError((err as Error).message));
  }, [workspaceId, refresh, router]);

  // Resume (AC3): everything the server already knows pre-fills the form once.
  useEffect(() => {
    if (!status || prefilled) return;
    setPrefilled(true);
    if (status.profile) {
      setProfile({
        legalName: status.profile.legalName ?? '',
        industry: status.profile.industry ?? '',
        size: status.profile.size ?? '2-10',
        website: status.profile.website ?? '',
        description: status.profile.description ?? '',
        tone: status.profile.tone ?? 'professional',
        timezone: status.profile.timezone ?? 'UTC',
      });
      setGoals(status.profile.goals ?? []);
    }
    setPicked(status.agents.map((a) => a.key));
    setConnected(status.providers.connected);
  }, [status, prefilled]);

  // Once the recommendation lands, preselect it so the default path is one click.
  useEffect(() => {
    if (recommended.length && picked.length === 0) setPicked(recommended);
  }, [recommended, picked.length]);

  async function step<T>(fn: () => Promise<T>): Promise<T | null> {
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

  const effectiveState: JourneyState =
    customState !== 'live'
      ? customState
      : busy
        ? 'loading'
        : error
          ? 'error'
          : firstRun?.status === 'succeeded'
            ? 'success'
            : 'live';

  if (!workspaceId) return null;

  const loading = !status || !catalog || !workspace;
  if (loading || effectiveState === 'loading') {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--bg-canvas)' }}>
        <StateBar currentState="loading" onStateChange={setCustomState} pageName="Onboarding" />
        <div className="kit-frame" style={{ maxWidth: '1200px', margin: 'var(--space-8) auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: '660px' }}>
            <div style={{ padding: 'var(--space-6) var(--space-4)', borderRight: '1px solid var(--border-subtle)' }}>
              <div className="l-skeleton" style={{ width: '60%', height: '24px', marginBottom: 'var(--space-6)' }} />
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="l-skeleton" style={{ width: '80%', height: '18px', marginBottom: 'var(--space-3)' }} />
              ))}
            </div>
            <div style={{ padding: 'var(--space-10)' }}>
              <div className="l-skeleton" style={{ width: '30%', height: '14px', marginBottom: 'var(--space-3)' }} />
              <div className="l-skeleton" style={{ width: '50%', height: '32px', marginBottom: 'var(--space-4)' }} />
              {[0, 1, 2].map((i) => (
                <div key={i} className="l-skeleton" style={{ width: '100%', height: '46px', marginBottom: 'var(--space-4)' }} />
              ))}
              <div className="l-skeleton" style={{ width: '30%', height: '40px' }} />
              <p className="l-xs l-muted" style={{ margin: 0 }}>
                Skeletons match the step layout so nothing jumps on load.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const hiredKeys = status.agents.map((a) => a.key);
  const teamKeys = [...new Set([...hiredKeys, ...picked])];
  const wantedProviders = [
    ...new Set(
      (catalog?.agents ?? [])
        .filter((a) => teamKeys.includes(a.key))
        .flatMap((a) => [...a.requiredProviders, ...a.optionalProviders]),
    ),
  ];
  const agentByKey = new Map((catalog?.agents ?? []).map((a) => [a.key, a]));

  const clearSelections = () => {
    if (status.step === 'pick_goals') setGoals([]);
    if (status.step === 'hire_agents') setPicked([]);
    if (status.step === 'add_knowledge') {
      setKbTitle('');
      setKbText('');
      setKbUrl('');
      setKbScope([]);
    }
    if (status.step === 'connect_tools') setConnected([]);
    setCustomState('live');
  };

  const trial = trialFor(workspace);

  const stepPane = () => {
    if (status.isComplete && firstRun === undefined) {
      return (
        <div className="l-col" style={{ gap: 'var(--space-5)' }}>
          <p className="l-eyebrow">All done</p>
          <h1 style={{ margin: 0 }}>Your workspace is live</h1>
          <p className="l-sm l-muted" style={{ maxWidth: '54ch' }}>
            Your agents are set up and working. Pick up where you left off in the dashboard.
          </p>
          <div className="l-row">
            <button className="l-btn l-btn--primary l-btn--lg" onClick={() => router.push(`/dashboard?workspace=${workspaceId}`)}>
              Go to dashboard
            </button>
          </div>
        </div>
      );
    }

    switch (status.step) {
      case 'company_profile':
        return (
          <form
            className="l-col"
            style={{ gap: 0, maxWidth: '56ch' }}
            onSubmit={async (e) => {
              e.preventDefault();
              await step(() => api(`/workspaces/${workspaceId}/onboarding/profile`, { body: profile }));
            }}
          >
            <p className="l-eyebrow">{STEP_OF.company_profile}</p>
            <h1 style={{ margin: 'var(--space-2) 0' }}>Tell us about your business</h1>
            <p className="l-sm l-muted" style={{ maxWidth: '54ch' }}>
              Your agents use this to sound like you from their very first message. Nothing here is verified or
              billed — it just makes the drafts better.
            </p>

            <div className="l-field" style={{ marginTop: 'var(--space-6)' }}>
              <label className="l-label" htmlFor="legalName">Business name</label>
              <input
                className="l-input"
                id="legalName"
                required
                maxLength={200}
                value={profile.legalName}
                onChange={(e) => setProfile({ ...profile, legalName: e.target.value })}
              />
            </div>
            <div className="l-field">
              <label className="l-label" htmlFor="industry">Industry</label>
              <input
                className="l-input"
                id="industry"
                required
                maxLength={120}
                value={profile.industry}
                onChange={(e) => setProfile({ ...profile, industry: e.target.value })}
              />
              <span className="l-help">Free text — “property management”, “boutique e-commerce”, whatever fits.</span>
            </div>
            <div className="l-field">
              <label className="l-label" htmlFor="size">Team size</label>
              <select
                className="l-select"
                id="size"
                value={profile.size}
                onChange={(e) => setProfile({ ...profile, size: e.target.value })}
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="l-field">
              <label className="l-label" htmlFor="website">Website (optional)</label>
              <input
                className="l-input"
                id="website"
                type="url"
                placeholder="https://"
                value={profile.website}
                onChange={(e) => setProfile({ ...profile, website: e.target.value })}
              />
            </div>
            <div className="l-field">
              <label className="l-label" htmlFor="description">What do you do?</label>
              <textarea
                className="l-textarea"
                id="description"
                rows={3}
                maxLength={2000}
                value={profile.description}
                onChange={(e) => setProfile({ ...profile, description: e.target.value })}
              />
            </div>
            <div className="l-field">
              <label className="l-label" htmlFor="tone">Tone of voice</label>
              <select
                className="l-select"
                id="tone"
                value={profile.tone}
                onChange={(e) => setProfile({ ...profile, tone: e.target.value })}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className="l-help">This pre-fills how your agents write — you can change it per agent later.</span>
            </div>

            <div className="l-row" style={{ marginTop: 'var(--space-4)' }}>
              <button className="l-btn l-btn--primary l-btn--lg" disabled={busy} type="submit">
                {busy ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </form>
        );

      case 'pick_goals':
        return (
          <form
            className="l-col"
            style={{ gap: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await step(() =>
                api<{ recommended: { key: string }[] }>(`/workspaces/${workspaceId}/onboarding/goals`, {
                  body: { goals },
                }),
              );
              if (res) setRecommended(res.recommended.map((r) => r.key));
            }}
          >
            <p className="l-eyebrow">{STEP_OF.pick_goals} · required</p>
            <h1 style={{ margin: 'var(--space-2) 0' }}>What do you want off your plate?</h1>
            <p className="l-sm l-muted" style={{ maxWidth: '54ch' }}>
              Pick as many as apply — we&apos;ll suggest the agents that cover them. This is the one choice we
              need before your workspace can be built.
            </p>

            <div className="l-col" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-6)', maxWidth: '56ch' }}>
              {(catalog?.goals ?? []).map((g) => {
                const selected = goals.includes(g.key);
                return (
                  <label
                    key={g.key}
                    className="l-card l-card--interactive"
                    style={{
                      display: 'flex',
                      gap: 'var(--space-3)',
                      alignItems: 'center',
                      padding: 'var(--space-4)',
                      borderColor: selected ? 'var(--border-accent)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => setGoals((v) => toggle(v, g.key))}
                    />
                    <span className="l-sm" style={{ fontWeight: selected ? 600 : 400 }}>{g.label}</span>
                  </label>
                );
              })}
              {catalog?.goals.length === 0 && (
                <div className="l-empty">
                  <div className="l-empty__icon">📋</div>
                  <h3>No goals available yet</h3>
                  <p className="l-sm l-muted">The goal catalog is empty — try again in a moment.</p>
                </div>
              )}
            </div>

            <div className="l-row" style={{ marginTop: 'var(--space-6)' }}>
              <button className="l-btn l-btn--primary l-btn--lg" disabled={busy || goals.length === 0} type="submit">
                {busy ? 'Saving…' : 'Continue'}
              </button>
              <span className="l-xs l-muted" style={{ alignSelf: 'center' }}>
                {goals.length} selected
              </span>
            </div>
          </form>
        );

      case 'hire_agents':
        return (
          <form
            className="l-col"
            style={{ gap: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              await step(() =>
                api(`/workspaces/${workspaceId}/onboarding/agents`, {
                  body: { agents: picked.map((key) => ({ key, config: {} })) },
                }),
              );
            }}
          >
            <p className="l-eyebrow">{STEP_OF.hire_agents} · required</p>
            <h1 style={{ margin: 'var(--space-2) 0' }}>Pick your agents</h1>
            <p className="l-sm l-muted" style={{ maxWidth: '54ch' }}>
              {recommended.length
                ? 'Based on your goals — add or remove anyone, this is just a starting team.'
                : 'Choose who joins your workspace. Everyone starts in draft mode.'}
            </p>

            <div className="l-col" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-6)', maxWidth: '64ch' }}>
              {(catalog?.agents ?? []).map((a) => {
                const selected = picked.includes(a.key);
                return (
                  <label
                    key={a.key}
                    className="l-card l-card--interactive"
                    style={{
                      display: 'flex',
                      gap: 'var(--space-3)',
                      alignItems: 'flex-start',
                      padding: 'var(--space-4)',
                      borderColor: selected ? 'var(--border-accent)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => setPicked((v) => toggle(v, a.key))}
                      style={{ marginTop: '3px' }}
                    />
                    <span className="l-col" style={{ gap: 'var(--space-1)' }}>
                      <span className="l-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <b className="l-sm">{a.name}</b>
                        <span className="l-badge">{a.role}</span>
                        {recommended.includes(a.key) && <span className="l-badge l-badge--accent">Recommended</span>}
                        {hiredKeys.includes(a.key) && <span className="l-badge l-badge--success">Hired</span>}
                      </span>
                      <span className="l-xs l-muted">{a.blurb}</span>
                    </span>
                  </label>
                );
              })}
              {catalog?.agents.length === 0 && (
                <div className="l-empty">
                  <div className="l-empty__icon">🤖</div>
                  <h3>No agents available</h3>
                  <p className="l-sm l-muted">The agent catalog is empty — try again in a moment.</p>
                </div>
              )}
            </div>

            <div className="l-banner" style={{ marginTop: 'var(--space-5)', maxWidth: '64ch' }}>
              🔒 Everyone you hire starts on <b>draft only</b>. Nothing is sent, posted or spent until you approve it.
            </div>

            <div className="l-row" style={{ marginTop: 'var(--space-6)' }}>
              <button className="l-btn l-btn--primary l-btn--lg" disabled={busy || picked.length === 0} type="submit">
                {busy ? 'Hiring…' : `Hire ${picked.length} agent${picked.length === 1 ? '' : 's'}`}
              </button>
              <span className="l-xs l-muted" style={{ alignSelf: 'center' }}>
                {picked.length} selected · workflows are provisioned automatically
              </span>
            </div>
          </form>
        );

      case 'add_knowledge':
        return (
          <div className="l-col" style={{ gap: 0, maxWidth: '64ch' }}>
            <p className="l-eyebrow">{STEP_OF.add_knowledge} · optional</p>
            <h1 style={{ margin: 'var(--space-2) 0' }}>Give your agents your own material</h1>
            <p className="l-sm l-muted" style={{ maxWidth: '54ch' }}>
              Paste a document or add a URL — pricing sheets, policies, FAQs — and every agent
              drafts from it. <b>You can skip this and add documents later</b>; your agents work
              fine from your business profile alone.
            </p>

            <div className="l-col" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
              {status.knowledge.length > 0 && (
                <div className="l-card" style={{ padding: 'var(--space-4)' }}>
                  <div className="l-card__header" style={{ padding: 0, marginBottom: 'var(--space-2)' }}>
                    <h3 className="l-sm">Added ({status.knowledge.length})</h3>
                  </div>
                  <div className="l-col" style={{ gap: 'var(--space-2)' }}>
                    {status.knowledge.map((d) => (
                      <div key={d.id} className="l-row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                        <span aria-hidden>{d.status === 'ready' ? '📄' : '⚠️'}</span>
                        <span className="l-sm" style={{ flex: 1 }}>{d.title}</span>
                        {d.status === 'ready' ? (
                          <span className="l-badge">{d.chunkCount} chunks</span>
                        ) : (
                          <span className="l-badge l-badge--warning">couldn&apos;t read — you can retry or delete</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <form
                className="l-card"
                style={{ padding: 'var(--space-4)', gap: 'var(--space-3)', display: 'flex', flexDirection: 'column' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const payload = kbText.trim()
                    ? { title: kbTitle.trim() || undefined, content: kbText, agentKeys: kbScope }
                    : { url: kbUrl.trim(), agentKeys: kbScope };
                  const okAdd = await step(() => api(`/workspaces/${workspaceId}/knowledge`, { method: 'POST', body: payload }));
                  if (okAdd) {
                    setKbTitle('');
                    setKbText('');
                    setKbUrl('');
                  }
                }}
              >
                <b className="l-sm">Paste text</b>
                <input
                  className="l-input"
                  placeholder={'Title, e.g. "Pricing 2026"'}
                  maxLength={200}
                  value={kbTitle}
                  onChange={(e) => setKbTitle(e.target.value)}
                />
                <textarea
                  className="l-textarea"
                  rows={4}
                  placeholder="Paste any document your agents should know by heart…"
                  maxLength={200000}
                  value={kbText}
                  onChange={(e) => setKbText(e.target.value)}
                />
                <b className="l-sm" style={{ marginTop: 'var(--space-2)' }}>Or add a URL</b>
                <input
                  className="l-input"
                  type="url"
                  placeholder="https://your-site.com/pricing"
                  value={kbUrl}
                  onChange={(e) => setKbUrl(e.target.value)}
                  disabled={kbText.trim().length > 0}
                />
                <b className="l-sm" style={{ marginTop: 'var(--space-2)' }}>Or upload a text file</b>
                <input
                  className="l-input"
                  type="file"
                  accept=".txt,.md,.csv,.json,text/*"
                  disabled={busy || (kbText.trim().length > 0 || kbUrl.trim().length > 0)}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ''; // allow re-adding the same file after a failure
                    if (!file) return;
                    const content = await file.text();
                    const okAdd = await step(() =>
                      api(`/workspaces/${workspaceId}/knowledge`, {
                        method: 'POST',
                        body: { title: kbTitle.trim() || file.name, content, filename: file.name, agentKeys: kbScope },
                      }),
                    );
                    if (okAdd) {
                      setKbTitle('');
                      setKbText('');
                      setKbUrl('');
                    }
                  }}
                />
                {status.agents.length > 0 && (
                  <div className="l-col" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <span className="l-xs l-muted">Ground everyone, or only:</span>
                    <div className="l-row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      {status.agents.map((a) => (
                        <label key={a.key} className="l-row l-xs" style={{ gap: 'var(--space-1)' }}>
                          <input
                            type="checkbox"
                            checked={kbScope.includes(a.key)}
                            onChange={() => setKbScope((v) => toggle(v, a.key))}
                          />
                          {a.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="l-row" style={{ marginTop: 'var(--space-1)' }}>
                  <button
                    className="l-btn l-btn--secondary"
                    disabled={busy || (!kbText.trim() && !kbUrl.trim())}
                    type="submit"
                  >
                    Add document
                  </button>
                </div>
              </form>
            </div>

            <div className="l-banner" style={{ marginTop: 'var(--space-5)', maxWidth: '64ch' }}>
              🗑️ Anything you add here can be deleted later in one click — along with every
              extracted chunk derived from it.
            </div>

            <div className="l-row" style={{ marginTop: 'var(--space-6)' }}>
              <button
                className="l-btn l-btn--secondary l-btn--lg"
                type="button"
                disabled={busy}
                onClick={() => step(() => api(`/workspaces/${workspaceId}/onboarding/knowledge`, { body: { documents: [], skip: true } }))}
              >
                Skip — I&apos;ll add this later
              </button>
              <span className="l-spacer" />
              <button
                className="l-btn l-btn--primary l-btn--lg"
                disabled={busy}
                onClick={() => step(() => api(`/workspaces/${workspaceId}/onboarding/knowledge`, { body: { documents: [], skip: status.knowledge.length === 0 } }))}
              >
                {busy ? 'Saving…' : status.knowledge.length > 0 ? 'Continue' : 'Continue without knowledge'}
              </button>
            </div>
          </div>
        );

      case 'connect_tools':
        return (
          <form
            className="l-col"
            style={{ gap: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              await step(() =>
                api(`/workspaces/${workspaceId}/onboarding/connections`, {
                  body: { connections: connected.map((provider) => ({ provider })) },
                }),
              );
            }}
          >
            <p className="l-eyebrow">{STEP_OF.connect_tools} · optional</p>
            <h1 style={{ margin: 'var(--space-2) 0' }}>Connect your tools</h1>
            <p className="l-sm l-muted" style={{ maxWidth: '54ch' }}>
              Your team works without any of these — connecting just lets them act on your real data instead of
              drafting from what you tell them. <b>You can skip this entirely and do it later.</b>
            </p>

            <div className="l-col" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-6)', maxWidth: '56ch' }}>
              {wantedProviders.map((p) => {
                const selected = connected.includes(p);
                const required = status.providers.required.includes(p);
                return (
                  <label
                    key={p}
                    className="l-card l-card--interactive"
                    style={{
                      display: 'flex',
                      gap: 'var(--space-3)',
                      alignItems: 'center',
                      padding: 'var(--space-4)',
                      borderColor: selected ? 'var(--border-accent)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <input type="checkbox" checked={selected} onChange={() => setConnected((v) => toggle(v, p))} />
                    <span className="l-col" style={{ gap: 'var(--space-1)', flex: 1 }}>
                      <span className="l-row" style={{ gap: 'var(--space-2)' }}>
                        <b className="l-sm" style={{ textTransform: 'capitalize' }}>{p.replace(/_/g, ' ')}</b>
                        {required && <span className="l-badge l-badge--warning">Recommended</span>}
                        {status.providers.connected.includes(p) && (
                          <span className="l-badge l-badge--success">Connected</span>
                        )}
                      </span>
                      <span className="l-xs l-muted">
                        Starts read-only — write access only unlocks once you&apos;ve approved your agent&apos;s first drafts.
                      </span>
                    </span>
                  </label>
                );
              })}
              {wantedProviders.length === 0 && (
                <div className="l-empty">
                  <div className="l-empty__icon">🔌</div>
                  <h3>Nothing to connect</h3>
                  <p className="l-sm l-muted">
                    Your agents don&apos;t need any integrations to start — they&apos;ll draft from your company
                    profile and ask when they need more.
                  </p>
                </div>
              )}
            </div>

            <div className="l-banner" style={{ marginTop: 'var(--space-5)', maxWidth: '56ch' }}>
              🔒 Even once a tool is connected, nothing is sent, posted or spent while your agents are on{' '}
              <b>draft only</b>.
            </div>

            <div className="l-row" style={{ marginTop: 'var(--space-6)' }}>
              <button className="l-btn l-btn--secondary l-btn--lg" type="button" disabled={busy} onClick={() => step(() => api(`/workspaces/${workspaceId}/onboarding/connections`, { body: { connections: [], skip: true } }))}>
                Skip — I&apos;ll do this later
              </button>
              <span className="l-spacer" />
              <button className="l-btn l-btn--primary l-btn--lg" disabled={busy} type="submit">
                {busy ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </form>
        );

      case 'first_run':
      case 'done':
        return (
          <div className="l-col" style={{ gap: 'var(--space-4)', maxWidth: '56ch' }}>
            <p className="l-eyebrow">{STEP_OF.first_run}</p>
            <h1 style={{ margin: 0 }}>Your first task</h1>
            <p className="l-sm l-muted" style={{ maxWidth: '54ch' }}>
              {status.agents.map((a) => a.name).join(', ')} {status.agents.length === 1 ? 'is' : 'are'} set up and
              waiting. We&apos;ll kick off one real task now so you land on something real — not an empty screen.
            </p>

            {status.providers.missing.length > 0 && (
              <p className="l-xs l-muted">
                Not connected yet: {status.providers.missing.join(', ')}. Steps that need them will simply stand
                down until you connect them — nothing fails.
              </p>
            )}

            {firstRun === null && !busy && (
              <div className="l-banner">
                ℹ️ Your team didn&apos;t have a no-integration task ready, so we skipped the demo run. Your
                workspace is live either way.
              </div>
            )}
            {firstRun?.status === 'failed' && (
              <div className="l-banner l-banner--warning">
                ⚠️ The first task didn&apos;t finish — nothing is lost. Try it again, or look at it from the
                dashboard.
              </div>
            )}
            {firstRun?.status === 'succeeded' && (
              <div className="l-banner l-banner--success">
                ✅ First task done. Its output is waiting in your approval inbox on the dashboard.
              </div>
            )}

            <div className="l-row" style={{ marginTop: 'var(--space-2)' }}>
              {firstRun?.status !== 'succeeded' && (
                <button
                  className="l-btn l-btn--primary l-btn--lg"
                  disabled={busy}
                  onClick={async () => {
                    const res = await step(() =>
                      api<{ firstRun: { runId: string; status: string } | null }>(
                        `/workspaces/${workspaceId}/onboarding/complete`,
                        { body: {} },
                      ),
                    );
                    setFirstRun(res?.firstRun ?? null);
                  }}
                >
                  {busy ? 'Starting…' : firstRun?.status === 'failed' ? 'Retry first task' : 'Run my first task'}
                </button>
              )}
              <button
                className={`l-btn ${firstRun?.status === 'succeeded' ? 'l-btn--primary' : 'l-btn--ghost'} l-btn--lg`}
                disabled={busy}
                onClick={() => router.push(`/dashboard?workspace=${workspaceId}`)}
              >
                Go to dashboard
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)' }}>
      <StateBar currentState={effectiveState} onStateChange={setCustomState} pageName="Onboarding" />

      <div className="kit-frame" style={{ margin: 'var(--space-8) auto', width: '100%', maxWidth: '1200px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: '660px', background: 'var(--bg-surface)' }}>
          <OnboardingRail step={status.step} progress={status.progress} isComplete={status.isComplete} trial={trial} />

          <div style={{ padding: 'var(--space-10)', overflow: 'hidden' }}>
            {error && (
              <div className="l-banner l-banner--danger" role="alert" style={{ marginBottom: 'var(--space-5)' }}>
                <span className="l-col" style={{ gap: 'var(--space-1)' }}>
                  <b className="l-sm">That didn&apos;t go through</b>
                  <span className="l-xs">
                    {error} — your progress is saved. Fix what&apos;s highlighted and try again; nothing was lost.
                  </span>
                </span>
              </div>
            )}

            {effectiveState === 'destructive-confirm' ? (
              <div className="l-card" style={{ borderColor: 'var(--danger-500)', maxWidth: '56ch' }}>
                <div className="l-card__header">
                  <h3>Clear your selections on this step?</h3>
                </div>
                <div className="l-card__body l-col" style={{ gap: 'var(--space-4)' }}>
                  <p className="l-sm l-muted">
                    This only clears what you&apos;ve ticked on this screen. Anything you already saved stays
                    saved.
                  </p>
                  <div className="l-row">
                    <button className="l-btn l-btn--danger" onClick={clearSelections}>
                      Yes, clear selections
                    </button>
                    <button className="l-btn l-btn--ghost" onClick={() => setCustomState('live')}>
                      Keep them
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              stepPane()
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-canvas)' }}>
          <p className="l-sm l-muted">Loading…</p>
        </main>
      }
    >
      <OnboardingFlow />
    </Suspense>
  );
}
