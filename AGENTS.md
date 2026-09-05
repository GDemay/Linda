# Architecture guide for agents working on Linda

Linda is currently a single-file Express service (`server.js`). Keep it that
way until there's a real reason not to — no microservices, no framework
migration, no premature abstraction for a service this small.

## Non-negotiables

1. **One file until it hurts.** Split `server.js` into modules only when it
   stops fitting on one screen of scrolling (roughly >300 lines) or when a
   second unrelated concern (e.g. a second product surface) needs its own
   routes.
2. **`module.exports = app` stays.** `server.js` exports the Express app and
   only calls `.listen()` when run directly (`require.main === module`). This
   is what makes it testable — don't remove it.
3. **Every route change needs a test.** Tests live in `server.test.js` using
   Node's built-in `node:test` runner (no extra test framework dependency).
   Run with `npm test`.
4. **CI must pass before merging.** `.github/workflows/ci.yml` runs `npm ci &&
   npm test` on every push/PR. Don't merge with a red CI run; fix forward
   instead of disabling the check.
5. **No secrets in code.** Config (`OPENAI_API_KEY`, `ADMIN_TOKEN`, etc.) comes
   from environment variables only, as it does today.

## Required loop for any change

1. Make the change.
2. `npm test` locally.
3. Push a branch and open a PR (don't push directly to `main`).
4. Confirm CI is green, then merge.

## When to actually add structure

Only split into multiple files/services once one of these is true, not
before:
- `server.js` has more than ~2-3 unrelated route groups.
- There's a second deployable surface (e.g. a frontend build step, a worker).
- Shared logic needs to be reused outside this process.

Until then, resist adding folders, layers, or services "for scalability" —
that's over-engineering for what this product needs today.
