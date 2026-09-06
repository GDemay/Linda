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
    date: '2026-09-18',
    title: 'Post 6 — What our testers broke, and what we shipped because of it',
    body: 'Two weeks of testers trying Linda unassisted produced better bug reports than any QA plan. They could not tell who did what because our AI employees had human first names — so every agent is now named by its role: Phone, Marketing, SEO, Sales, Finance, Legal, Recruiting, Chief of Staff. They corrected a deliverable, then watched the agent make the same mistake next run — so we shipped agent memory: check “Remember this correction” once and every future task applies it, citing which memories it used, all inspectable and deletable in the agent card. They asked “what does this cost and how do I get my data out” — so flat pricing went live with no “contact us” tier, and workspaces can export everything or delete the account without a support ticket. Every fix shipped within days, not quarters. Come break the next thing: /signup?utm_source=site&utm_medium=bip&utm_campaign=phase3',
  },
  {
    date: '2026-09-16',
    title: 'Post 5 — Tester spotlight: no quotes yet, so here are the raw numbers',
    body: 'We planned to open this post with a tester quote. We asked; nobody had replied by publish time — and we would rather show you the real funnel than wait for a compliment. So far: 13 signups (8 from outside our own team), 13 active trials, 6 tasks executed on production with all 6 completed — zero abandoned mid-run. Two agencies found us through a single Reddit thread — no ads, no sponsorships, $0 spend of any kind on distribution. The honest caveats: those are small numbers, the trials are 14 days free with no card, and a signup is not a customer until the card clears. When a tester puts their name to a quote, you will read it here unedited — including the parts that sting. Watch the funnel yourself: /signup?utm_source=site&utm_medium=bip&utm_campaign=phase3',
  },
  {
    date: '2026-09-14',
    title: 'Post 4 — Transparent unit economics: what a task actually costs us',
    body: 'Every Linda task runs on gpt-5.6-luna, and we publish the math instead of hiding it behind “credits.” A typical task meters 120–220 tokens; the heaviest real task we have observed on production ran 522 tokens and finished in 4.9 seconds. Our published conversion is 1 credit ≈ 1k tokens, and Starter is $49/mo including 10,000 credits — so a full month’s allotment prices at under half a cent per credit, and the marginal inference cost of even that heavy task rounds to a quarter of a cent. Every task run to date costs us less than a third of a cent, against a flat $49/mo price with no metered billing and no per-minute surprises. That gap is what funds the product. And because someone will ask: ad spend to date is exactly $0 — every signup so far came from organic channels. Check our math with your own first task: /signup?utm_source=site&utm_medium=bip&utm_campaign=phase3',
  },
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
