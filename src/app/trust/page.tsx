import Link from 'next/link';
import { AGENT_CATALOG } from '@/lib/agents/catalog.ts';
import AccountPanel from './AccountPanel.tsx';

export const metadata = {
  title: 'Trust & transparency — Linda',
  description:
    'What powers Linda, where your data lives, who processes it, and how to export or delete everything. Verified against the live deployment.',
};

/** Update whenever the deployment facts change: model, region, sub-processors. */
const LAST_VERIFIED = '5 September 2026';
const MODEL = 'gpt-5.6-luna';
const PROVIDER = 'OpenAI';
const HOST = 'Railway';
const REGION = 'EU West';

const SUBPROCESSORS = [
  {
    who: HOST,
    role: 'Application hosting and data storage',
    data: 'All workspace data (see "Where your data lives" below)',
    where: REGION,
  },
  {
    who: PROVIDER,
    role: 'Language-model inference for generative workflow steps',
    data: 'Only the content of the step being generated, sent via API',
    where: 'Varies by provider region — see their documentation',
  },
];

export default function TrustPage() {
  return (
    <>
      <nav className="topbar">
        <div className="inner">
          <Link href="/" className="brand">
            Linda
          </Link>
          <div className="row">
            <Link href="/pricing">Pricing</Link>
            <Link href="/changelog">Changelog</Link>
            <Link href="/trust">Trust</Link>
            <Link href="/login">Log in</Link>
            <Link href="/signup">
              <button className="primary">Get started</button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="shell stack" style={{ gap: 40 }}>
        <header className="stack" style={{ gap: 8 }}>
          <div className="pill ok" style={{ width: 'fit-content' }}>
            Verified {LAST_VERIFIED}
          </div>
          <h1>Trust &amp; transparency</h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 680 }}>
            Most AI tools hide what&apos;s under the hood. Here is ours, in full — checked against the
            live deployment, not the marketing copy. When any of these facts changes, this page and
            the <Link href="/changelog">changelog</Link> change with it.
          </p>
        </header>

        <section className="stack" style={{ gap: 12 }}>
          <h2>What powers each agent</h2>
          <p style={{ maxWidth: 680 }}>
            Every Linda agent runs on two things: our own workflow engine, and — where a step needs
            generative AI — the <strong>{MODEL}</strong> model from {PROVIDER}, called through their
            API. There is no secret blend of models and no &quot;AI&quot; label over hand-rolled
            scripts: deterministic steps (schedules, routing, retries, approval gates) run on our
            engine, and generative steps (drafting, summarising) name their model here.
          </p>
          <div className="card stack" style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--surface-muted)' }}>
                  <th style={{ padding: '10px 14px' }}>Agent</th>
                  <th style={{ padding: '10px 14px' }}>Role</th>
                  <th style={{ padding: '10px 14px' }}>Generative steps</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(AGENT_CATALOG).map((agent) => (
                  <tr key={agent.key} style={{ borderBottom: '1px solid var(--surface-muted)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                      {agent.persona} · {agent.name}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{agent.role}</td>
                    <td style={{ padding: '10px 14px' }} className="mono">
                      {PROVIDER} / {MODEL}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ maxWidth: 680 }}>
            If we add, swap, or retire a model, we update this table and announce it in the
            changelog <em>before</em> it reaches your workflows. Every run also keeps a
            step-by-step log in your dashboard, so you can always see what an agent actually did.
          </p>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2>Where your data lives</h2>
          <div className="grid">
            <article className="card stack" style={{ gap: 6 }}>
              <strong>Storage</strong>
              <p className="muted" style={{ margin: 0 }}>
                A single SQLite database on a persistent volume we own — not a sprawl of
                third-party data stores.
              </p>
            </article>
            <article className="card stack" style={{ gap: 6 }}>
              <strong>Location</strong>
              <p className="muted" style={{ margin: 0 }}>
                Hosted on {HOST} in the <strong>{REGION}</strong> region. Customer data does not
                leave that deployment.
              </p>
            </article>
            <article className="card stack" style={{ gap: 6 }}>
              <strong>Retention</strong>
              <p className="muted" style={{ margin: 0 }}>
                Your data is kept until <em>you</em> delete it — there is no expiry and no periodic
                purge of your workspaces. Login sessions expire after 30 days.
              </p>
            </article>
            <article className="card stack" style={{ gap: 6 }}>
              <strong>Model training</strong>
              <p className="muted" style={{ margin: 0 }}>
                Your data is <strong>never</strong> used to train models — not ours (we train none)
                and not our providers&apos;. {PROVIDER}&apos;s API terms exclude API inputs and
                outputs from training their models.
              </p>
            </article>
          </div>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2>Sub-processors</h2>
          <p className="muted" style={{ maxWidth: 680 }}>
            The complete list of third parties that can process customer data. If it grows, this
            table grows first.
          </p>
          <div className="card stack" style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--surface-muted)' }}>
                  <th style={{ padding: '10px 14px' }}>Processor</th>
                  <th style={{ padding: '10px 14px' }}>What they do</th>
                  <th style={{ padding: '10px 14px' }}>Data they see</th>
                  <th style={{ padding: '10px 14px' }}>Where</th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map((s) => (
                  <tr key={s.who} style={{ borderBottom: '1px solid var(--surface-muted)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{s.who}</td>
                    <td style={{ padding: '10px 14px' }}>{s.role}</td>
                    <td style={{ padding: '10px 14px' }}>{s.data}</td>
                    <td style={{ padding: '10px 14px' }}>{s.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2>Export or delete everything</h2>
          <p style={{ maxWidth: 680 }}>
            Both are self-serve, built into the product, and free. The export is a single JSON
            document containing everything your workspace owns — agents, connections (never
            credential secrets), workflows, runs, activity, and approvals. Account deletion is
            immediate and permanent; a workspace you solely own is deleted with it, while shared
            workspaces keep running for your co-workers.
          </p>
          <AccountPanel />
          <p className="muted" style={{ maxWidth: 680 }}>
            Not signed in? <Link href="/login">Log in</Link> and return here — the one-click
            buttons appear above, on this page.
          </p>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2>Credits &amp; usage</h2>
          <p className="muted" style={{ maxWidth: 680 }}>
            Linda prices in plain dollars, published on the <Link href="/pricing">pricing page</Link>.
            When metered usage credits ship, the exact credit conversion (what one credit pays for,
            what a typical run costs) will be published here in the same table format — before
            anyone is billed a credit.
          </p>
        </section>

        <footer className="stack" style={{ gap: 4 }}>
          <p className="muted" style={{ margin: 0 }}>
            Last verified against the production deployment: {LAST_VERIFIED}. Spot something
            inaccurate? That&apos;s a bug — please report it.
          </p>
        </footer>
      </main>
    </>
  );
}
