import { PostHog } from 'posthog-node';
import { POSTHOG_EVENTS } from './taxonomy.ts';
import type { EventName } from '../analytics/events.ts';

/**
 * Server-side PostHog mirror (LIN-167). Chosen over posthog-js because every
 * funnel event in the taxonomy is already recorded server-side where the
 * action happens (recordEvent call sites) — no client SDK, no extra payload,
 * and the env var names stay exactly POSTHOG_KEY + POSTHOG_HOST.
 *
 * Gating contract: with the env vars unset, no client is ever constructed,
 * no network is attempted, and captureFunnelEvent is a pure no-op. When the
 * keys land (M2), wiring is env-vars-only.
 */

let client: PostHog | null = null;
let clientKey: string | null = null;

/** Lazy client: only constructed once POSTHOG_KEY + POSTHOG_HOST are both set. */
function posthogClient(): PostHog | null {
  const key = process.env.POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST;
  if (!key || !host) return null;
  // Env changed under us (tests stub env vars) — drop the stale client.
  if (!client || clientKey !== key) {
    // capture() is enqueue-only (batched flush at 20 events), so this stays
    // off the request hot path.
    client = new PostHog(key, { host, flushAt: 20 });
    clientKey = key;
  }
  return client;
}

/** Whether PostHog mirroring is active (used by tests and diagnostics). */
export function posthogEnabled(): boolean {
  return posthogClient() !== null;
}

/**
 * Mirrors a taxonomy funnel event to PostHog. Fire-and-forget: telemetry
 * must never break the request path it observes, so all failures are swallowed.
 * Distinct id is the workspace when the event carries one (workspace-scoped
 * funnels), otherwise the shared 'anonymous' id used by the visitor stage.
 */
export function captureFunnelEvent(name: EventName, data: Record<string, unknown> = {}): void {
  try {
    if (!POSTHOG_EVENTS.includes(name)) return;
    const c = posthogClient();
    if (!c) return;
    const workspaceId = data.workspaceId;
    c.capture({
      distinctId: typeof workspaceId === 'string' && workspaceId ? `ws:${workspaceId}` : 'anonymous',
      event: name,
      properties: data,
    });
  } catch {
    // Never let observability take the product down.
  }
}
