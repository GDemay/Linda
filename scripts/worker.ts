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
import { purgeExpiredSessions } from '../src/lib/repos/accounts.ts';
import { drainQueue } from '../src/lib/workflows/runner.ts';

const INTERVAL_MS = Number(process.env.LINDA_WORKER_INTERVAL_MS ?? 5000);
const BATCH = Number(process.env.LINDA_WORKER_BATCH ?? 25);

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
