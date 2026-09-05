'use client';

import type { OnboardingStep } from '@/lib/repos/types.ts';

const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: 'company_profile', label: 'Your business' },
  { key: 'pick_goals', label: 'What you want done' },
  { key: 'hire_agents', label: 'Pick your agents' },
  { key: 'add_knowledge', label: 'Add knowledge (optional)' },
  { key: 'connect_tools', label: 'Connect your tools' },
  { key: 'first_run', label: 'First task' },
];

export type Trial = { plan: string; daysLeft: number; trialDays: number };

/**
 * Persistent left rail of the onboarding wizard (design v1.1). Everything a
 * customer could panic about mid-flow lives here on every screen: how far they
 * are, that agents can't act without them, that progress is saved, and that
 * the trial ends in a downgrade — never a charge.
 */
export function OnboardingRail({
  step,
  progress,
  isComplete,
  trial,
}: {
  step: OnboardingStep;
  progress: number;
  isComplete: boolean;
  trial: Trial;
}) {
  return (
    <aside
      style={{
        padding: 'var(--space-6) var(--space-4)',
        borderRight: '1px solid var(--border-subtle)',
        background: 'var(--bg-canvas)',
      }}
    >
      <div className="l-row" style={{ marginBottom: 'var(--space-6)' }}>
        <span className="logo-mark">L</span>
        <b>Linda</b>
      </div>

      <div className="l-steps">
        {STEPS.map((s, i) => {
          const state = isComplete || STEPS.findIndex((x) => x.key === step) > i ? 'done' : s.key === step ? 'active' : 'todo';
          return (
            <div key={s.key} className={`l-step ${state === 'done' ? 'is-done' : state === 'active' ? 'is-active' : ''}`}>
              <span className="l-step__num">{state === 'done' ? '✓' : i + 1}</span>
              <span className="l-step__label">{s.label}</span>
            </div>
          );
        })}
      </div>

      <div className="l-meter" style={{ marginTop: 'var(--space-6)', padding: '0 var(--space-3)' }}>
        <div className="l-meter__track">
          <div className="l-meter__fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="l-meter__label l-row" style={{ justifyContent: 'space-between' }}>
          <span className="l-xs l-muted">Setup</span>
          <span className="l-num l-xs">{progress}%</span>
        </div>
      </div>

      <div className="l-card" style={{ marginTop: 'var(--space-6)', background: 'var(--bg-surface)' }}>
        <div className="l-card__body" style={{ padding: 'var(--space-4)' }}>
          <div className="l-row" style={{ gap: 'var(--space-2)' }}>
            <span aria-hidden>🔒</span>
            <b className="l-sm">Draft only</b>
          </div>
          <p className="l-xs l-muted" style={{ margin: 'var(--space-2) 0 0' }}>
            Your agents can read and draft. Nothing is sent, posted or spent without your approval.
          </p>
        </div>
      </div>

      <p className="l-xs l-muted" style={{ marginTop: 'var(--space-5)', padding: '0 var(--space-3)' }}>
        You can leave and come back — we save every step.
      </p>

      <p className="l-xs l-muted" style={{ marginTop: 'var(--space-3)', padding: '0 var(--space-3)' }}>
        {trial.plan === 'trial' ? (
          <>
            Trial: {trial.daysLeft} day{trial.daysLeft === 1 ? '' : 's'} left, then you drop to the free tier.{' '}
            <b>We never charge automatically.</b>
          </>
        ) : (
          <>
            Plan: {trial.plan}. <b>We never charge automatically.</b>
          </>
        )}
      </p>
    </aside>
  );
}
