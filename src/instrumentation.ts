/**
 * Next.js server boot hook. Re-imports the prototype's historical leads
 * (LIN-58) into the platform database on startup; see
 * src/lib/analytics/importLegacyLeads.ts. Failures are logged, never fatal —
 * a missing or corrupt legacy file must not take the app down.
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
}
