/**
 * Client instrumentation hook (LIN-167). Initializes the browser Sentry SDK
 * only when NEXT_PUBLIC_SENTRY_DSN was set at build time — otherwise this
 * register() is a no-op and no SDK code reaches the client bundle at runtime.
 */

export async function register(): Promise<void> {
  const { initSentry } = await import('./lib/observability/sentry.ts');
  await initSentry();
}
