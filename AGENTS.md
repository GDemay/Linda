# Architecture rules for Linda

Read this before touching code. It exists so agents (there are no human
engineers) keep the codebase easy to extend instead of it rotting into
something only the agent who wrote it understands.

## The shape we keep (don't change this)

One Next.js app. One SQLite-backed data layer. No separate services, no
message queue, no microservices, no monorepo. Linda is a single product used
by small teams — a distributed architecture would be pure overhead for our
scale and would slow agents down, not speed them up. If a future task
proposes splitting this into services, treat that as a red flag, not a
default.

Folder layout, and what belongs where:

```
src/app/            Next.js routes only. Pages + API route handlers.
                     Handlers stay thin: parse input, call src/lib, return.
src/app/api/<x>/    One route.ts per action. No business logic here.
src/lib/<domain>/   All business logic, grouped by domain
                     (auth, accounts, workflows, onboarding, agents, ...).
src/lib/repos/      All DB reads/writes. Nothing outside repos/ touches
                     the db object directly.
src/lib/db/         Schema + migrations + connection only.
tests/              One test file per domain area, mirrors src/lib.
scripts/            One-off/ops scripts (seed, worker, e2e) — not app code.
```

When adding a feature: find the matching `src/lib/<domain>/`, extend it (or
add a new domain folder if it's genuinely new), add a thin route handler if
it needs an HTTP surface, and add/extend the matching test file. That's the
whole loop. If you find yourself wanting a new top-level folder or a new
"service", stop and reconsider the smaller version first.

## Non-negotiables

- **Business logic never lives in `src/app/`.** Route handlers call into
  `src/lib`, they don't contain logic themselves.
- **DB access only through `src/lib/repos/`.** Keeps queries in one place so
  schema changes don't require hunting across the codebase.
- **Every domain module has a matching test file.** `npm test` must pass
  before anything is considered done. Untested code is not shippable code.
- **Types over comments.** Zod schemas / TS types at boundaries (API input,
  DB rows) instead of prose explaining shapes.
- **No new runtime dependency, no new external service, without a one-line
  justification in the PR description.** Budget and simplicity both matter
  more than convenience here.

## Workflow for every change

1. `npm run typecheck && npm test` before you start, so you know the
   baseline is green.
2. Make the change inside the existing folder structure above.
3. Add/update tests in `tests/` for whatever you touched.
4. `npm run typecheck && npm test && npm run build` before calling it done.
5. Commit with a message describing *why*, open a PR. Don't hand-wave "should
   work" — if the checks above weren't run, the task isn't finished.

## Known gap (tracked separately)

There is no git repository and no CI yet, so none of the above can be
enforced automatically today. Setting up `git init` + a remote + GitHub
Actions (typecheck + test + build on every PR, with an agent auto-fix step)
is tracked as a follow-up and should land before this project takes on
outside contributions or a second concurrent agent.
