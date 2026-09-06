'use client';

// LIN-118: the Journey Spec state-switcher is an internal QA harness and must never
// render for customers. Hidden in production builds unless explicitly enabled via
// NEXT_PUBLIC_JOURNEY_SPEC=1 (e.g. for a QA pass); always available in dev.
// The guard is kept in a module-local const: every operand is inlined by the
// compiler (NODE_ENV always, the flag via the next.config env default), so in a
// production build it folds to a literal `false` that terser propagates — the
// toolbar is dead-code eliminated out of the client bundle entirely, not just
// gated at runtime.
const harnessOn =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_JOURNEY_SPEC === '1';

export const journeySpecEnabled = harnessOn;

export type JourneyState = 'live' | 'empty' | 'loading' | 'error' | 'destructive-confirm' | 'success';

interface StateBarProps {
  currentState: JourneyState;
  onStateChange: (state: JourneyState) => void;
  pageName: string;
}

export function StateBar({ currentState, onStateChange, pageName }: StateBarProps) {
  if (!harnessOn) return null;

  const states: { id: JourneyState; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'empty', label: 'Empty' },
    { id: 'loading', label: 'Loading' },
    { id: 'error', label: 'Error' },
    { id: 'destructive-confirm', label: 'Destructive' },
    { id: 'success', label: 'Success' },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Journey Spec state switcher"
      style={{
        background: 'var(--bg-sunken)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: 'var(--space-2) var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 'var(--space-2)',
        fontSize: '0.75rem',
        zIndex: 50,
      }}
    >
      <div className="l-row" style={{ gap: 'var(--space-2)' }}>
        <span className="l-eyebrow" style={{ fontSize: '0.6875rem' }}>
          Journey Spec · {pageName}
        </span>
        <span className="l-xs l-muted">All 5 states:</span>
      </div>
      <div className="l-row" style={{ gap: 'var(--space-1)' }}>
        {states.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`l-btn l-btn--sm ${currentState === s.id ? 'l-btn--primary' : 'l-btn--ghost'}`}
            style={{ height: '24px', padding: '0 var(--space-2)', fontSize: '0.6875rem' }}
            onClick={() => onStateChange(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
