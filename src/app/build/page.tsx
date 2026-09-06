import Link from 'next/link';
import { buildMetadata } from '@/lib/seo.ts';
import { BUILD_LOG } from '@/lib/buildlog.ts';

export const metadata = buildMetadata({
  title: 'Build log — Linda',
  description: 'Building 8 autonomous AI employees in public: real numbers, honest friction, 3x a week.',
  path: '/build',
});

export default function BuildLogPage() {
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
        </header>

        <section className="stack">
          {BUILD_LOG.map((entry) => (
            <article key={`${entry.date}-${entry.title}`} className="card stack" style={{ gap: 6 }}>
              <div className="spread">
                <h3>{entry.title}</h3>
                <span className="mono muted">{entry.date}</span>
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
