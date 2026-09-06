/**
 * Env-gated Sentry sink (LIN-167). Disabled unless a DSN is present — with
 * no SENTRY_DSN the SDK is never imported and every function here is a pure
 * no-op, so the app builds and deploys identically until keys land (M2).
 *
 * Server code reads SENTRY_DSN; client bundles read NEXT_PUBLIC_SENTRY_DSN
 * (the only form Next inlines into the browser). The DSN is a public
 * identifier, not a secret — both names may hold the same value.
 */

type SentrySdk = {
  init(options: Record<string, unknown>): void;
  captureException(err: unknown, hint?: Record<string, unknown>): void;
};

function sentryDsn(): string | undefined {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

/** Whether Sentry capture is active (used by tests and diagnostics). */
export function sentryEnabled(): boolean {
  return Boolean(sentryDsn());
}

let initPromise: Promise<SentrySdk | null> | null = null;
let initializedDsn: string | null = null;

/** Idempotently imports + initializes the SDK. Returns null when disabled. */
function sdk(): Promise<SentrySdk | null> {
  const dsn = sentryDsn();
  if (!dsn) return Promise.resolve(null);
  // DSN changed under us (tests, config reload) — re-init for the new DSN.
  if (!initPromise || initializedDsn !== dsn) {
    initPromise = (async () => {
      const Sentry = (await import('@sentry/nextjs')) as unknown as SentrySdk;
      Sentry.init({ dsn, environment: process.env.NODE_ENV, tracesSampleRate: 0 });
      return Sentry;
    })();
    initializedDsn = dsn;
  }
  return initPromise;
}

/** Initializes Sentry at process start (called from instrumentation.ts). */
export async function initSentry(): Promise<boolean> {
  return (await sdk()) !== null;
}

/**
 * Fire-and-forget error capture for server code (route handlers, workers).
 * Never throws — observability must not take the product down.
 */
export async function captureServerError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  try {
    const Sentry = await sdk();
    Sentry?.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // Swallowed on purpose.
  }
}
