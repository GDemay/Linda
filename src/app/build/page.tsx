import Link from 'next/link';
import { buildMetadata, buildLogJsonLd } from '@/lib/seo.ts';
import { publishedBuildLog } from '@/lib/buildlog.ts';
import { JsonLd } from '../components/JsonLd.tsx';

export const metadata = buildMetadata({
  title: 'Build log — Linda',
  description:
    'Building 8 autonomous AI employees in public: real signups, real unit costs, honest friction — 3x a week. Every number published, including the ugly ones.',
  path: '/build',
});

// Re-render hourly so dated entries go live on their own date without a deploy.
export const revalidate = 3600;

export default function BuildLogPage() {
  // Only entries dated today or earlier — the Mon/Wed/Fri cadence is what
  // visitors should see, not drafts staged for future dates.
  const published = publishedBuildLog();
  const first = published[published.length - 1];
  return (
    <>
      {/* LIN-206: Blog + BlogPosting schema so the log's claims (unit costs,
          real funnel numbers) are attributable per post. */}
      <JsonLd data={buildLogJsonLd(published)} />
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
          <h1>Build log</h1>
          <p className="muted">
            Building 8 autonomous AI employees in public — 3x a week, real numbers, honest friction.
          </p>
          <p className="mono muted" style={{ fontSize: 13 }}>
            {published.length} posts published since {first?.date ?? '—'} · feature ships are in the{' '}
            <Link href="/changelog">changelog</Link>
          </p>
        </header>

        <section className="stack">
          {published.map((entry, i) => (
            // #post-N anchor (matches the BlogPosting URLs in the page
            // JSON-LD) so a specific post can be cited and deep-linked.
            <article
              key={`${entry.date}-${entry.title}`}
              id={`post-${i + 1}`}
              className="card stack"
              style={{ gap: 6 }}
            >
              <div className="spread">
                <h3>{entry.title}</h3>
                <a className="mono muted" href={`/build#post-${i + 1}`}>
                  {entry.date}
                </a>
              </div>
              <p className="muted">{entry.body}</p>
            </article>
          ))}
        </section>

        <div className="card stack" style={{ gap: 8 }}>
          <h3>Watch the next one land</h3>
          <p className="muted">
            New entries every Monday, Wednesday, and Friday. Product changes land in the{' '}
            <Link href="/changelog">changelog</Link> — this log is the story behind them.
          </p>
          <Link href="/signup?utm_source=site&utm_medium=bip&utm_campaign=phase3">
            <button className="primary">Try Linda free for 14 days</button>
          </Link>
        </div>
      </main>
    </>
  );
}
