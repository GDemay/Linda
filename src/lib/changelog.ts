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
  // 2026-09-06 batch — entries summarize what actually merged to main that
  // day (see git history); nothing here is planned work.
  {
    date: '2026-09-06',
    title: 'One-click starter tasks for new workspaces',
    body: 'The dashboard empty state now suggests real starter tasks you can run with one click instead of facing a blank prompt. First task in minutes, unassisted — the metric we optimize.',
  },
  {
    date: '2026-09-06',
    title: 'Self-serve upgrades and checkout',
    body: 'The upgrade flow runs end to end without a sales call: pick a plan, check out, and your workspace entitlements update. Trial-expiry nudges now appear in the dashboard before a trial ends, and checkout only reports success when the subscription is actually live.',
  },
  {
    date: '2026-09-06',
    title: 'AI agents vs virtual assistant — honest comparison page',
    body: 'Published a side-by-side comparison of Linda against hiring a human virtual assistant, including where the human wins. Linked from the home page footer.',
  },
  {
    date: '2026-09-06',
    title: 'Reliability and account-safety batch',
    body: 'Added a /api/health endpoint wired to the deploy healthcheck so bad releases fail fast. Magic-link sends are rate-limited per address with a resend throttle, expired login links now show an explicit error instead of a dead end, and sessions survive deep links to the dashboard.',
  },
  {
    date: '2026-09-06',
    title: 'Terms, privacy, and accessibility polish',
    body: 'Shipped /terms and /privacy, linked from the signup footer. Mobile nav links meet 44px touch-target minimums, the brand icon renders on all pages, and internal loading copy was replaced with text a customer can read.',
  },
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
