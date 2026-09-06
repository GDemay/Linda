import Link from 'next/link';
import { buildMetadata, changelogJsonLd } from '@/lib/seo.ts';
import { CHANGELOG } from '@/lib/changelog.ts';
import { JsonLd } from '../components/JsonLd.tsx';

export const metadata = buildMetadata({
  title: 'Changelog — Linda',
  description:
    'Every Linda feature that has shipped, newest first — agent memory, self-serve upgrades, starter tasks, and the reliability fixes behind them.',
  path: '/changelog',
});

export default function ChangelogPage() {
  return (
    <>
      {/* LIN-206: dated ItemList so the shipped log is machine-readable. */}
      <JsonLd data={changelogJsonLd(CHANGELOG)} />
      <nav className="topbar">
        <div className="inner">
          <Link href="/" className="brand">
            Linda
          </Link>
          <div className="row">
            <Link href="/pricing">Pricing</Link>
            <Link href="/changelog">Changelog</Link>
            <Link href="/build">Build log</Link>
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
          <h1>Changelog</h1>
          <p className="muted">
            What shipped, and when — {CHANGELOG.length} entries since{' '}
            {CHANGELOG[CHANGELOG.length - 1].date}. The story behind these ships is in the{' '}
            <Link href="/build">build log</Link>.
          </p>
        </header>

        <section className="stack">
          {CHANGELOG.map((entry, i) => (
            // #entry-N anchor (matches the ItemList in the page JSON-LD) lets
            // release notes and outreach deep-link to a specific fix.
            <article
              key={`${entry.date}-${entry.title}`}
              id={`entry-${i + 1}`}
              className="card stack"
              style={{ gap: 6 }}
            >
              <div className="spread">
                <h3>{entry.title}</h3>
                <a className="mono muted" href={`/changelog#entry-${i + 1}`}>
                  {entry.date}
                </a>
              </div>
              <p className="muted">{entry.body}</p>
            </article>
          ))}
        </section>

        <div className="card stack" style={{ gap: 8 }}>
          <h3>Ship-watch, in public</h3>
          <p className="muted">
            Product changes land here; the numbers and the misses land in the{' '}
            <Link href="/build">build log</Link>. Nothing on either page is written by marketing.
          </p>
          <Link href="/signup?utm_source=site&utm_medium=changelog&utm_campaign=phase3">
            <button className="primary">Try Linda free for 14 days</button>
          </Link>
        </div>
      </main>
    </>
  );
}
