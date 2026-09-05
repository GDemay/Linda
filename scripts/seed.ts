/**
 * Creates a fully-onboarded demo workspace so the app has something to show on
 * first run. Safe to re-run: it uses a fixed email and exits if it already exists.
 *
 *   npm run seed
 */
import { getDb } from '../src/lib/db/index.ts';
import { signup } from '../src/lib/auth/service.ts';
import { findUserByEmail } from '../src/lib/repos/accounts.ts';
import {
  completeOnboarding,
  hireAgents,
  submitCompanyProfile,
  submitConnections,
  submitGoals,
} from '../src/lib/onboarding/machine.ts';
import { listWorkflows, listRuns } from '../src/lib/repos/workflows.ts';
import { runNow } from '../src/lib/workflows/runner.ts';

const EMAIL = 'demo@linda.local';
const PASSWORD = 'demo-password-1234';

async function main() {
  const db = getDb();

  if (findUserByEmail(db, EMAIL)) {
    console.log(`Demo account already exists — log in as ${EMAIL} / ${PASSWORD}`);
    return;
  }

  const { workspace } = await signup(db, {
    email: EMAIL,
    name: 'Dana Demo',
    password: PASSWORD,
    workspaceName: 'Northwind Studio',
  });

  submitCompanyProfile(db, workspace.id, {
    legalName: 'Northwind Studio SAS',
    industry: 'design agency',
    size: '2-10',
    website: 'https://northwind.example',
    description: 'A small branding studio for early-stage companies.',
    tone: 'friendly',
    timezone: 'Europe/Paris',
  });

  submitGoals(db, workspace.id, { goals: ['capture_leads', 'book_meetings', 'grow_audience', 'control_costs'] });

  hireAgents(db, workspace.id, {
    agents: [
      { key: 'assistant', config: {} },
      { key: 'phone', config: { greeting: 'Northwind Studio — how can I help?' } },
      { key: 'marketing', config: { channels: ['linkedin', 'instagram'], postsPerWeek: 4 } },
      { key: 'accounting', config: { currency: 'EUR', forecastMonths: 6 } },
    ],
  });

  submitConnections(db, workspace.id, { connections: [{ provider: 'calendar', externalAccount: 'dana@northwind.example' }] });
  await completeOnboarding(db, workspace.id);

  // A little run history, so the dashboard isn't a single row.
  const workflows = listWorkflows(db, workspace.id);
  const extra: [string, Record<string, unknown>][] = [
    ['inbound_enquiry', { channel: 'web', contact: { name: 'Priya', handle: 'priya@acme.example' }, message: 'Can we book a demo next week?' }],
    ['inbound_enquiry', { channel: 'call', contact: { handle: '+33 6 12 34 56 78' }, message: 'urgent — the site is broken' }],
    ['content_calendar', { weeks: 4, themes: ['brand identity', 'case studies'] }],
    ['cash_forecast', { openingBalance: 42000, monthlyInflow: 18000, monthlyOutflow: 21000 }],
    ['route_request', { request: 'Draft an NDA for the new supplier' }],
  ];

  for (const [key, input] of extra) {
    const wf = workflows.find((w) => w.definitionKey === key);
    if (wf) await runNow(db, { workspaceId: workspace.id, workflowId: wf.id, input, trigger: 'seed' });
  }

  const runs = listRuns(db, workspace.id);
  console.log(`Seeded "${workspace.name}"`);
  console.log(`  login    ${EMAIL} / ${PASSWORD}`);
  console.log(`  agents   4`);
  console.log(`  workflows ${workflows.length}`);
  console.log(`  runs     ${runs.length} (${runs.filter((r) => r.status === 'succeeded').length} succeeded)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
