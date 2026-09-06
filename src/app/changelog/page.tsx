import Link from 'next/link';
import { buildMetadata } from '@/lib/seo.ts';
import { CHANGELOG } from '@/lib/changelog.ts';

export const metadata = buildMetadata({
  title: 'Changelog — Linda',
  description: 'What shipped, and when.',
  path: '/changelog',
});

export default function ChangelogPage() {
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
          <h1>Changelog</h1>
          <p className="muted">What shipped, and when.</p>
        </header>

        <section className="stack">
          {CHANGELOG.map((entry) => (
            <article key={`${entry.date}-${entry.title}`} className="card stack" style={{ gap: 6 }}>
              <div className="spread">
                <h3>{entry.title}</h3>
                <span className="mono muted">{entry.date}</span>
              </div>
              <p className="muted">{entry.body}</p>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
