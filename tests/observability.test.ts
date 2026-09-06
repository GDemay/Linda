import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, newAccount, onboard } from './helpers.ts';
import { submitCompanyProfile } from '../src/lib/onboarding/machine.ts';
import { eventStats, recordEvent } from '../src/lib/analytics/events.ts';
import { posthogEnabled, captureFunnelEvent } from '../src/lib/observability/posthog.ts';
import { sentryEnabled, captureServerError, initSentry } from '../src/lib/observability/sentry.ts';
import { FUNNEL_EVENTS, POSTHOG_EVENTS, funnelStageFor } from '../src/lib/observability/taxonomy.ts';
import { EVENT_NAMES, type EventName } from '../src/lib/analytics/events.ts';

// The PostHog client is mocked so tests never touch the network, enabled or not.
const captureMock = vi.fn();
vi.mock('posthog-node', () => ({
  PostHog: vi.fn().mockImplementation(() => ({ capture: captureMock })),
}));

const sentryInitMock = vi.fn();
const captureExceptionMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  init: sentryInitMock,
  captureException: captureExceptionMock,
}));

beforeEach(() => {
  captureMock.mockClear();
  sentryInitMock.mockClear();
  captureExceptionMock.mockClear();
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
});

afterEach(() => {
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
});

describe('event taxonomy (LIN-167)', () => {
  it('maps every funnel event to a known EventName', () => {
    for (const stage of Object.keys(FUNNEL_EVENTS) as (keyof typeof FUNNEL_EVENTS)[]) {
      for (const name of FUNNEL_EVENTS[stage]) {
        expect(EVENT_NAMES, `${stage}/${name}`).toContain(name);
      }
    }
  });

  it('covers visitor → signup → activated with the sale-funnel events', () => {
    expect(FUNNEL_EVENTS.visitor).toContain('landing_view');
    expect(FUNNEL_EVENTS.signup).toContain('signup_success');
    expect(FUNNEL_EVENTS.activated).toContain('onboarding_started');
    expect(FUNNEL_EVENTS.activated).toContain('onboarding_completed');
    expect(FUNNEL_EVENTS.activated).toContain('first_task_dispatched');
  });

  it('classifies stages and leaves diagnostics out of the funnel', () => {
    expect(funnelStageFor('signup_success')).toBe('signup');
    expect(funnelStageFor('first_task_dispatched')).toBe('activated');
    expect(funnelStageFor('magic_link_sent')).toBeNull();
    expect(POSTHOG_EVENTS).not.toContain('magic_link_sent' as EventName);
  });
});

describe('PostHog gating (LIN-167)', () => {
  it('is disabled and inert without POSTHOG_KEY/POSTHOG_HOST', () => {
    expect(posthogEnabled()).toBe(false);
    // recordEvent must not blow up nor enqueue anything server-side.
    const d = db();
    recordEvent(d, 'signup_success', { workspaceId: 'ws_1' });
    expect(captureMock).not.toHaveBeenCalled();
    expect(eventStats(d).find((e) => e.name === 'signup_success')?.count).toBe(1);
  });

  it('does not initialize when only one of the two env vars is set', () => {
    process.env.POSTHOG_KEY = 'phc_dummy';
    expect(posthogEnabled()).toBe(false);
    delete process.env.POSTHOG_KEY;
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
    expect(posthogEnabled()).toBe(false);
  });

  it('mirrors funnel events with workspace distinct ids when enabled', () => {
    process.env.POSTHOG_KEY = 'phc_dummy';
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
    expect(posthogEnabled()).toBe(true);

    const d = db();
    recordEvent(d, 'signup_success', { workspaceId: 'ws_1', audience: 'external' });
    recordEvent(d, 'first_task_dispatched', { workspaceId: 'ws_1', agent: 'sdr' });
    recordEvent(d, 'landing_view');

    expect(captureMock).toHaveBeenCalledTimes(3);
    expect(captureMock).toHaveBeenCalledWith({
      distinctId: 'ws:ws_1',
      event: 'signup_success',
      properties: { workspaceId: 'ws_1', audience: 'external' },
    });
    expect(captureMock).toHaveBeenCalledWith({ distinctId: 'anonymous', event: 'landing_view', properties: {} });
  });

  it('never mirrors diagnostic events even when enabled', () => {
    process.env.POSTHOG_KEY = 'phc_dummy';
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
    captureFunnelEvent('magic_link_sent', { via: 'email' });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('is inert again after the env vars are removed', () => {
    process.env.POSTHOG_KEY = 'phc_dummy';
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
    expect(posthogEnabled()).toBe(true);
    delete process.env.POSTHOG_KEY;
    expect(posthogEnabled()).toBe(false);
    captureFunnelEvent('signup_success', { workspaceId: 'ws_1' });
    expect(captureMock).not.toHaveBeenCalled();
  });
});

describe('Sentry gating (LIN-167)', () => {
  it('is disabled without SENTRY_DSN and capture is a no-op', async () => {
    expect(sentryEnabled()).toBe(false);
    await initSentry();
    await captureServerError(new Error('boom'));
    expect(sentryInitMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('initializes once and captures server errors when SENTRY_DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://dummy@o0.ingest.sentry.io/0';
    expect(sentryEnabled()).toBe(true);
    expect(await initSentry()).toBe(true);
    expect(await initSentry()).toBe(true); // idempotent — SDK inits once
    expect(sentryInitMock).toHaveBeenCalledTimes(1);

    const err = new Error('boom');
    await captureServerError(err, { url: '/api/tasks', method: 'POST' });
    expect(captureExceptionMock).toHaveBeenCalledWith(err, { extra: { url: '/api/tasks', method: 'POST' } });
  });

  it('also accepts NEXT_PUBLIC_SENTRY_DSN (the client-readable form)', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    expect(await initSentry()).toBe(true);
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://public@o0.ingest.sentry.io/0' }),
    );
  });
});

describe('onboarding funnel events (LIN-167)', () => {
  it('records onboarding_started on first profile save only, and onboarding_completed at done', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    submitProfile(d, workspace.id);
    expect(count(d, 'onboarding_started')).toBe(1);
    expect(count(d, 'onboarding_completed')).toBe(0);

    // Re-saving the profile later must not re-fire "started".
    submitProfile(d, workspace.id);
    expect(count(d, 'onboarding_started')).toBe(1);

    await onboard(d, workspace.id);
    expect(count(d, 'onboarding_completed')).toBe(1);
  });
});

function count(d: ReturnType<typeof db>, name: EventName): number {
  return eventStats(d).find((e) => e.name === name)?.count ?? 0;
}

function submitProfile(d: ReturnType<typeof db>, workspaceId: string): void {
  submitCompanyProfile(d, workspaceId, {
    legalName: 'Acme',
    industry: 'software',
    size: '2-10',
    website: 'https://acme.example',
    description: 'Widgets',
    tone: 'professional',
    timezone: 'UTC',
  });
}
