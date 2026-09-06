/**
 * Background worker: drains scheduled and retried runs.
 *
 * Manual "run now" executes inline in the request, so the app is fully usable
 * without this process. It exists for scheduled triggers and for runs that
 * were requeued with backoff after a failure.
 *
 *   node --experimental-strip-types scripts/worker.ts
 */
import { getDb } from '../src/lib/db/index.ts';
import { expireDueTrials } from '../src/lib/billing/entitlements.ts';
import { purgeExpiredSessions } from '../src/lib/repos/accounts.ts';
import { dispatchDueLifecycleEmails } from '../src/lib/onboarding/lifecycle.ts';
import { drainQueue } from '../src/lib/workflows/runner.ts';

const INTERVAL_MS = Number(process.env.LINDA_WORKER_INTERVAL_MS ?? 5000);
const BATCH = Number(process.env.LINDA_WORKER_BATCH ?? 25);
// Lifecycle nudges (LIN-203): links must point at the public app; set
// LIFECYCLE_EMAIL_DRY_RUN=1 to log instead of send (staging/prove-out).
const APP_URL = process.env.APP_ORIGIN ?? 'http://localhost:3000';
const LIFECYCLE_DRY_RUN = process.env.LIFECYCLE_EMAIL_DRY_RUN === '1';

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} — finishing current batch`);
    stopping = true;
  });
}

async function main() {
  const db = getDb();
  console.log(`[worker] polling every ${INTERVAL_MS}ms, batch ${BATCH}`);

  let ticks = 0;
  while (!stopping) {
    try {
      // AC9: expired trials downgrade to free automatically, no human action.
      const expired = expireDueTrials(db);
      if (expired.length) console.log(`[worker] expired ${expired.length} trial(s)`);

      // LIN-203: onboarding lifecycle nudges (day-2 stuck, day-10 expiry).
      // One-shot per workspace+kind, so an empty result is the steady state.
      const lifecycle = await dispatchDueLifecycleEmails(db, { appUrl: APP_URL, dryRun: LIFECYCLE_DRY_RUN });
      if (lifecycle.length) {
        const tally = lifecycle.reduce<Record<string, number>>((acc, o) => {
          const key = `${o.kind}:${o.status}`;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        console.log(`[worker] lifecycle emails${LIFECYCLE_DRY_RUN ? ' (dry run)' : ''}`, tally);
      }

      const outcomes = await drainQueue(db, BATCH);
      if (outcomes.length) {
        const tally = outcomes.reduce<Record<string, number>>((acc, o) => {
          acc[o.status] = (acc[o.status] ?? 0) + 1;
          return acc;
        }, {});
        console.log(`[worker] processed ${outcomes.length}`, tally);
      }
      // Session housekeeping roughly every 10 minutes.
      if (++ticks % Math.max(1, Math.round(600_000 / INTERVAL_MS)) === 0) {
        const purged = purgeExpiredSessions(db);
        if (purged) console.log(`[worker] purged ${purged} expired sessions`);
      }
    } catch (err) {
      // A bad batch must not kill the loop.
      console.error('[worker] batch failed', err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log('[worker] stopped');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
