# Linda

A team of AI agents that run a small company's phone, marketing, SEO, sales,
finance, legal and hiring — and that a customer can set up **entirely on their
own**, with nobody from our side involved.

This repository is the source of the live hosted product — you don't have to
run anything to try it:

- **14-day free trial, no credit card, no onboarding call:**
  [linda-llm-production.up.railway.app/signup](https://linda-llm-production.up.railway.app/signup?utm_source=github&utm_medium=readme&utm_campaign=lin141)
- **Flat published pricing** ($49 / $149 / $399 per month, no "contact sales"):
  [pricing](https://linda-llm-production.up.railway.app/pricing?utm_source=github&utm_medium=readme&utm_campaign=lin141)
- **We build in public** — shipping log and funnel numbers:
  [/build](https://linda-llm-production.up.railway.app/build?utm_source=github&utm_medium=readme&utm_campaign=lin141)

To run the whole thing yourself instead:

Everything runs locally. No Stripe, no Railway, no external services.

## Quick start

```bash
npm install
npm run seed      # optional: a fully-onboarded demo workspace
npm run dev       # http://localhost:3000
```

The seed account is `demo@linda.local` / `demo-password-1234`. To see the flow
this project is really about, skip the seed and sign up from scratch at
`/signup`.

```bash
npm test          # 71 unit/integration tests
npm run typecheck
npm run build && npm start
npm run worker    # background runner for scheduled + retried runs
```

End-to-end smoke test against a running server:

```bash
npm run build
LINDA_DB_PATH=.data/e2e.db npx next start -p 3111 &
./scripts/e2e.sh http://localhost:3111
```

## The onboarding flow

This is the part that differentiates us. The competitor we're chasing
(Limova.ai) advertises onboarding as *"1:1 personalised guidance from the
team"* — a human bottleneck on every single signup. Linda has none.

```
signup → company profile → goals → hire agents → connect tools → first run → live
```

- **No approval queue.** `signup()` creates the user, workspace, owner
  membership and session in one transaction. The account is usable the moment
  it returns.
- **No mandatory integrations.** Every connection is optional. A workspace can
  finish onboarding with zero tools connected; steps that need a missing
  provider report as `skipped`, never `failed`.
- **No empty dashboard.** Activation runs one real workflow chosen to produce
  useful output with no data connected, so the first screen shows actual work.
- **Every step is idempotent.** Re-submitting a step is safe: re-hiring an
  agent refreshes its config without duplicating workflows, and the step marker
  never moves backwards. A refresh or double-submit cannot half-provision a
  workspace.
- **Activation never blocks on a background job.** If the first run fails, the
  customer is still onboarded — the failure is logged to the activity feed.
  Blocking here would put a human back in the loop.

## Architecture

```
src/lib/db/          connection + append-only migrations (node:sqlite, WAL)
src/lib/repos/       data access, one module per aggregate
src/lib/auth/        scrypt hashing, sessions, workspace authorization
src/lib/agents/      the agent catalog (Zod config schemas, goal mapping)
src/lib/workflows/   workflow definitions + the execution engine
src/lib/onboarding/  the onboarding state machine
src/app/api/         REST routes (thin — all logic lives in lib)
src/app/             UI: landing, signup, login, onboarding, dashboard
```

Routes are deliberately thin: they authenticate, parse, delegate to a service,
and map `AppError.code` to a status. That keeps the interesting logic testable
without HTTP.

### Data model

13 tables. `workspaces` is the tenant boundary; every scoped table carries
`workspace_id` with `ON DELETE CASCADE`. Migrations are append-only and applied
on first DB access.

### Agents and workflows

Eight agents (Tom/phone, John/marketing, Lou/SEO, Elio/sales, Manue/finance,
Julia/legal, Rony/recruiting, Charly/chief-of-staff), each owning a set of the
16 workflow definitions. A definition is an ordered list of steps plus a Zod
input schema; a `workflows` row is a workspace's configured instance; a
`workflow_runs` row is one execution.

The engine:

- persists every step's status and output as it goes, so a crash leaves a
  readable trail rather than a black box;
- retries a throwing step up to 3 attempts with exponential backoff
  (30s → 2m → 8m), but fails **invalid input immediately** since retrying
  deterministic validation cannot help;
- skips (never fails) steps whose integration isn't connected;
- claims runs with a conditional `UPDATE ... WHERE status='queued'`, so two
  concurrent workers can't execute the same run.

Manual "run now" executes inline in the request. The worker process only exists
for scheduled triggers and backoff retries.

### Security

- Passwords: scrypt at OWASP parameters (N=2^17), per-password salt, encoded
  with its parameters so they can be raised later without breaking old hashes.
- Sessions: opaque 256-bit tokens; only the SHA-256 **hash** is stored, so a
  database leak can't be replayed as a login. Delivered as `HttpOnly`,
  `SameSite=Lax` cookies (`Secure` in production).
- Login hashes against a dummy when the user doesn't exist, so response timing
  doesn't reveal which addresses are registered.
- Tenant isolation goes through a single `authorize()` chokepoint. A non-member
  gets **404, not 403** — you shouldn't be able to learn that a workspace exists.

## Testing

71 tests across three suites, run against a fresh in-memory database each time:

| suite | covers |
| --- | --- |
| `tests/auth.test.ts` | hashing, signup, login, sessions, role floors, tenant isolation |
| `tests/onboarding.test.ts` | the full flow, idempotence, ordering, validation, optional integrations |
| `tests/workflows.test.ts` | catalog integrity, execution, retries, queue semantics, step logic |

`scripts/e2e.sh` additionally drives the real HTTP API end-to-end against a
production build — signup through activation, cross-tenant probes, and session
lifecycle.

## Deliberately not built yet

- **Billing.** `workspaces.plan` exists and defaults to `trial`; no payment
  integration, per the brief.
- **Real integrations.** Connections store a `secret_ref` pointer rather than
  credentials. Provider steps are structured for a real client to drop in.
- **Real model calls.** Drafting steps go through a single `draft()` helper in
  `definitions.ts`, isolated so swapping in a provider is a one-file change and
  tests stay deterministic.
- **Scheduled trigger dispatch.** Workflows carry `trigger_kind: 'schedule'`
  and their cron config, and the worker drains due runs, but nothing enqueues
  from a schedule yet.
