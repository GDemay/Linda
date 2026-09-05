/**
 * Public changelog. Newest first. Append entries here — this file is the
 * source of truth for both the /changelog page and the API route.
 */

export type ChangelogEntry = {
  date: string; // YYYY-MM-DD
  title: string;
  body: string;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-05',
    title: 'Agents remember what you teach them',
    body: 'Your agents now keep a memory. Teach a fact once — "always reply in French", "open with the prospect’s situation" — and every future task and run applies it, with the applied memories cited in the result. Correct a deliverable and check "Remember this correction" to make it stick. Every memory is inspectable in the agent card: pin it, edit it, or delete it, and every change is logged in your workspace activity.',
  },
  {
    date: '2026-09-05',
    title: 'Pricing, changelog, and data export',
    body: 'Published pricing is now live at /pricing. Added a public changelog. Workspaces can export their data and delete their account at any time — no support ticket required.',
  },
  {
    date: '2026-09-05',
    title: 'Agents are named by role, not by person',
    body: 'Every agent in the catalog is now identified by what it does — Phone, Marketing, SEO, Sales, Finance, Legal, Recruiting, Chief of Staff — instead of a human first name.',
  },
  {
    date: '2026-08-01',
    title: 'Self-serve onboarding',
    body: 'Sign up, describe your company, pick your goals, hire agents, connect the tools you use, and get a real first run — all without talking to anyone.',
  },
];
