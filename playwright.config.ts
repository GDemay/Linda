import { defineConfig, devices } from '@playwright/test';

/**
 * Rendered-UI quality gate (LIN-94).
 *
 * The vitest suite checks formatter invariants and static anti-patterns
 * (tests/ui-quality.test.ts); this config drives the checks that need a real
 * browser: console/page errors, raw markup leaking into visible text, layout
 * overflow at desktop + mobile widths, and injected-HTML regression on the
 * dashboard deliverable surface.
 *
 * Spec files use `.spec.ts` so the vitest glob (tests + ".test.ts") never
 * picks them up, and vice versa. (Note: never write the raw vitest glob in
 * a block comment — its `star star /` sequence closes the comment.)
 *
 * Run: npm run build && npm run test:ui   (CI installs chromium itself)
 */

// Overridable so two concurrent runs (or a dev server) never fight over 3211.
const PORT = Number(process.env.UI_QA_PORT ?? 3211);
const DB = `.data/ui-test${PORT === 3211 ? '' : `-${PORT}`}.db`;

export default defineConfig({
  testDir: 'tests/ui',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  fullyParallel: false, // one server, one seeded account — order is part of the contract
  workers: 1,
  reporter: [['list']],
  // Non-default ports keep artifacts separate so two concurrent local runs
  // never race on test-results/ (the run-to-run ENOENT trace failures).
  outputDir: PORT === 3211 ? 'test-results' : `.data/test-results-${PORT}`,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `rm -f ${DB} && npx next start -p ${PORT} -H 127.0.0.1`,
    // CHECKOUT_PROVIDER=local is test mode (LIN-205): the local billing
    // provider fulfills instantly in SQLite and never contacts a card
    // network. Without it the default resolves to 'none' and the upgrade
    // buttons render disabled — useless for funnel QA.
    env: { LINDA_DB_PATH: DB, LINDA_INSECURE_COOKIES: '1', CHECKOUT_PROVIDER: 'local' },
    url: `http://127.0.0.1:${PORT}/api/catalog`,
    reuseExistingServer: false,
    // This box runs several agents' builds at once; under that load a cold
    // `next start` can legitimately take over a minute.
    timeout: 180_000,
  },
});
