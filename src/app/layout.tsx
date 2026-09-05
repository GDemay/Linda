import type { Metadata } from 'next';
// Design system (LIN-4/LIN-10): tokens + component reference CSS from the
// design handoff, imported once at the app root per design/README.md.
// globals.css still owns page layout classes until pages are rebuilt
// against `.l-*` components (tracked separately — see LIN-10 follow-ups).
import './styles/tokens.css';
import './styles/components.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Linda — your AI coworkers',
  description: 'Hire AI agents that run your calls, marketing, sales, finance, legal and hiring.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
