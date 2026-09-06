/**
 * Next.js server boot hook. Re-imports the prototype's historical leads
 * (LIN-58) into the platform database on startup; see
 * src/lib/analytics/importLegacyLeads.ts. Failures are logged, never fatal —
 * a missing or corrupt legacy file must not take the app down.
 *
 * LIN-167: also initializes the env-gated Sentry SDK per server process, and
 * onRequestError forwards unhandled framework errors (route handlers, server
 * components) to it. With SENTRY_DSN unset both additions are no-ops and
 * @sentry/nextjs is never imported.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { getDb } = await import('./lib/db/index.ts');
    const { importLegacyLeads } = await import('./lib/analytics/importLegacyLeads.ts');
    const { imported, skipped } = importLegacyLeads(getDb());
    if (imported > 0 || skipped > 0) {
      console.log(`[legacy-import] historical leads: ${imported} imported, ${skipped} already present`);
    }
  } catch (err) {
    console.error('[legacy-import] failed:', err);
  }
  const { initSentry } = await import('./lib/observability/sentry.ts');
  await initSentry();
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[]> },
  context: { routePath: string; routeType: string },
): Promise<void> {
  const { captureServerError } = await import('./lib/observability/sentry.ts');
  await captureServerError(err, {
    url: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });
}
