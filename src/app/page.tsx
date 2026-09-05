import Link from 'next/link';
import { AGENT_CATALOG, AGENT_KEYS } from '@/lib/agents/catalog.ts';

export default function Home() {
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
            <Link href="/login">Log in</Link>
            <Link href="/signup">
              <button className="primary">Get started</button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="shell stack">
        <header className="stack" style={{ gap: 8, marginBottom: 8 }}>
          <h1>Hire the coworkers you can&apos;t afford yet.</h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 620 }}>
            Linda gives you a team of AI agents that answer your phone, run your marketing, chase your
            pipeline and keep your books — working while you sleep.
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <Link href="/signup">
              <button className="primary">Set up in 3 minutes</button>
            </Link>
            <span className="muted">No sales call. No demo booking. No credit card.</span>
          </div>
        </header>

        <section className="stack">
          <h2>Your team</h2>
          <div className="grid">
            {AGENT_KEYS.map((key) => {
              const agent = AGENT_CATALOG[key];
              return (
                <article key={key} className="card stack" style={{ gap: 6 }}>
                  <div className="spread">
                    <h3>{agent.name}</h3>
                    <span className="pill">{agent.role}</span>
                  </div>
                  <p className="muted">{agent.blurb}</p>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
}
