'use client';

import { useEffect } from 'react';

/**
 * Last-resort client error boundary (LIN-167). Forwards uncaught browser
 * errors to Sentry via the env-gated sink — with no DSN configured the
 * import resolves to a no-op and this stays a plain error screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void (async () => {
      const { captureServerError } = await import('@/lib/observability/sentry.ts');
      await captureServerError(error, { source: 'global-error', digest: error.digest });
    })();
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0b0d12',
          color: '#e7eaf0',
        }}
      >
        <main style={{ textAlign: 'center', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
            An unexpected error occurred. Our team has been notified — please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '8px',
              border: '1px solid #3b4254',
              background: '#171b26',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
