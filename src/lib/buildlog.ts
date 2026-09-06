/**
 * Public build-in-public log. Newest first. Append entries here — this
 * file is the source of truth for the /build page. Cadence: 3x/week
 * (Mon/Wed/Fri) for the 6 weeks post-launch. See LIN-50 calendar.
 */

export type BuildLogEntry = {
  date: string; // YYYY-MM-DD
  title: string;
  body: string;
};

export const BUILD_LOG: BuildLogEntry[] = [
  {
    date: '2026-09-06',
    title: 'Post 3 — Why we killed the demo call',
    body: 'Unpopular opinion: the demo call is where SaaS goes to die. If your product needs a 30-minute walkthrough before a small business owner gets value, that is a product bug, not a sales stage. We made Linda self-serve-only: no demos, no onboarding calls, no implementation fees. Sign up, type a task in plain English, one of 8 AI employees does it. Our testers’ first task took minutes, alone. That is the metric we optimize. See if you can break it: /signup?utm_source=site&utm_medium=bip&utm_campaign=phase3',
  },
  {
    date: '2026-09-06',
    title: 'Post 2 — Work that waits for nobody’s hands',
    body: 'A lawyer’s office loses ~4h/week to intake typing. An agency loses Friday afternoons to client reports. Same root cause: knowledge work trapped in one human’s hands. Linda’s answer is 8 autonomous employees (SEO, outreach, reception, ops…) who work asynchronously — the SEO agent drafts content briefs overnight, you review with coffee instead of deadlines. $49/mo flat, no per-seat math, no “book a call to see pricing.” Try it unassisted — that is the point: /signup?utm_source=site&utm_medium=bip&utm_campaign=phase3',
  },
  {
    date: '2026-09-06',
    title: 'Post 1 — We stopped writing sales emails by hand. So we hired software.',
    body: 'Elio is one of 8 AI employees at Linda. Last week he drafted and queued outbound prospecting for our testers — no prompt engineering, no demo call, no onboarding meeting. You type the task like a Slack message. A live task we just ran on production completed in 4.9 seconds, 522 tokens, untouched by any human. 14-day trial, no credit card: /signup?utm_source=site&utm_medium=bip&utm_campaign=phase3. We are building this in public — this log carries the numbers, including the ugly ones.',
  },
];
