/**
 * LIN-203 ops script: demonstrate the onboarding lifecycle email triggers in
 * dry-run mode against the real DB — every due nudge is logged, nothing is
 * sent. Run:
 *
 *   LIFECYCLE_EMAIL_DRY_RUN=1 APP_ORIGIN=https://your-app \
 *     node --experimental-strip-types scripts/lifecycle-dryrun.ts [--rearm]
 *
 * --rearm deletes the lifecycle_emails rows first, so a previous dry run can
 * be replayed (dry-run rows count as "sent" for the one-shot guard).
 */
import { getDb } from '../src/lib/db/index.ts';
import { dispatchDueLifecycleEmails } from '../src/lib/onboarding/lifecycle.ts';

const db = getDb();
const appUrl = process.env.APP_ORIGIN ?? 'http://localhost:3000';
const dryRun = process.env.LIFECYCLE_EMAIL_DRY_RUN === '1';
if (!dryRun) {
  console.error('[lifecycle-dryrun] refusing to run without LIFECYCLE_EMAIL_DRY_RUN=1');
  process.exit(1);
}

if (process.argv.includes('--rearm')) {
  db.exec('DELETE FROM lifecycle_emails');
  console.log('[lifecycle-dryrun] re-armed: cleared lifecycle_emails');
}

const outcomes = await dispatchDueLifecycleEmails(db, { appUrl, dryRun });
if (outcomes.length === 0) {
  console.log(`[lifecycle-dryrun] no due lifecycle emails (appUrl=${appUrl})`);
}
for (const o of outcomes) {
  console.log(`[lifecycle-dryrun] ${o.kind} workspace=${o.workspaceId} → ${o.status}${'via' in o ? ` via=${o.via}` : ''}${'reason' in o ? ` reason=${o.reason}` : ''}`);
}
console.log(`[lifecycle-dryrun] done: ${outcomes.length} outcome(s), 0 emails sent`);
