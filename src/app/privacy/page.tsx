import Link from 'next/link';
import { buildMetadata } from '@/lib/seo.ts';

export const metadata = buildMetadata({
  title: 'Privacy Policy — Linda',
  description: 'What Linda collects, why, and the controls you have over it.',
  path: '/privacy',
});

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'What we collect',
    body: [
      'Account basics: your name and email address — that is the entire signup gate.',
      'Workspace content: the tasks, documents and knowledge you (and your agents) put into Linda, plus the outputs they produce.',
      'Connection metadata: when you connect a tool, we store the credentials you provide and the minimal metadata needed to read and act on your behalf. We never post or send from your accounts without your approval.',
      'Product telemetry: which pages and funnel events you touch, so we know what is broken and what to build next.',
    ],
  },
  {
    title: 'Why we process it',
    body: [
      'To provide the service: running your agents, executing your workflows, and showing you what happened. Data we hold about you is processed on the legal basis of performing our contract with you.',
      'To keep the service working: debugging, abuse prevention, and aggregate product analytics.',
    ],
  },
  {
    title: 'AI sub-processors',
    body: [
      'Linda uses OpenAI models to power its agents. Prompts and content needed for a task are sent to OpenAI as API inputs and are not used by OpenAI to train their models. OpenAI processes that data under their own terms — see the Trust page for details.',
    ],
  },
  {
    title: 'What we never do',
    body: [
      'We never sell your data. We never send anything from your connected accounts without your approval. We never charge you automatically — the trial converts to the free plan, not to a paid subscription.',
    ],
  },
  {
    title: 'Retention and deletion',
    body: [
      'Your content stays in your workspace until you delete it. Deleting data or your whole workspace removes it from the active service; backups age out on a rolling cycle. Ask us to delete everything and confirm, and we will.',
    ],
  },
  {
    title: 'Your rights',
    body: [
      'You can access, correct, export or delete your data at any time, yourself, from your workspace — or by asking us. If you are in the EU/UK, you have GDPR-style rights (access, rectification, erasure, portability, objection) and we honour them without a lawyer exchange. You can complain to your local supervisory authority.',
    ],
  },
  {
    title: 'Contact',
    body: [
      'Privacy questions or requests: ask in the app or reply to any email we have sent you — the same humans answer both.',
    ],
  },
];

export default function PrivacyPage() {
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

      <main className="shell narrow stack">
        <header>
          <h1>Privacy Policy</h1>
          <p className="muted">
            Plain language, no dark patterns. Last updated 2026-09-06.
          </p>
        </header>

        <section className="stack">
          {SECTIONS.map((s) => (
            <article key={s.title} className="card stack" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>{s.title}</h3>
              {s.body.map((p, i) => (
                <p key={i} className="muted" style={{ margin: 0 }}>
                  {p}
                </p>
              ))}
            </article>
          ))}
        </section>

        <p className="muted" style={{ fontSize: 13 }}>
          How we handle AI providers is detailed on the <Link href="/trust">Trust</Link> page. The rules that govern
          your use of Linda are in the <Link href="/terms">Terms of Service</Link>.
        </p>
      </main>
    </>
  );
}
