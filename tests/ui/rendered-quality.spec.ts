// Rendered-UI quality gate (LIN-94) — the browser layer.
//
// What this catches that tests/ui-quality.test.ts cannot:
//   - console errors and uncaught page errors on real navigation
//   - raw markup leaking into *visible text* (the LIN-94 screenshot shows
//     `<i class="gamma-class-name"></i>` rendered inside dashboard copy)
//   - horizontal layout overflow at desktop and mobile widths
//   - broken same-origin requests (404/500 assets, failing API calls)
//   - missing image alt text
//   - an HTML-injection regression on the deliverable surface: an agent
//     output containing hostile markup must render as escaped text, never
//     as elements or executed script.

import { expect, test, type Page } from '@playwright/test';

const PUBLIC_PAGES = ['/', '/pricing', '/changelog', '/trust', '/terms', '/privacy', '/login', '/signup'];

/** Tag fragments that must never appear as visible text on a rendered page. */
const RAW_MARKUP_IN_TEXT = /<\/?(?:i|span|div|p|br|img|script|style|button|a)\b[^>]{0,120}>/i;

/** Raw ISO timestamps must never render as-is (LIN-94 screenshot bug class). */
const RAW_ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** The exact bug class from the LIN-94 screenshots (Gamma export markup). */
const HOSTILE_OUTPUT = [
  'Executive Summary',
  '<i class="gamma-class-name"></i><span class="gamma-class-name">Q3 highlights</span>',
  '<img src="https://evil.example/x.png" onerror="window.__pwned = 1">',
].join('\n');

type Problems = { consoleErrors: string[]; pageErrors: string[]; badRequests: string[] };

/** Collects everything we treat as a UI defect while a page loads and settles. */
function watch(page: Page): Problems {
  const problems: Problems = { consoleErrors: [], pageErrors: [], badRequests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => problems.pageErrors.push(String(err)));
  page.on('response', (res) => {
    if (res.status() >= 400 && new URL(res.url()).origin === new URL(page.url()).origin) {
      problems.badRequests.push(`${res.status()} ${res.url()}`);
    }
  });
  return problems;
}

async function load(page: Page, path: string): Promise<Problems> {
  const problems = watch(page);
  await page.goto(path, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  return problems;
}

/** One assertion bundle per page; failures name the page and the defect. */
async function expectCleanPage(page: Page, path: string, problems: Problems): Promise<void> {
  const label = `${page.viewportSize()?.width}px ${path}`;

  expect(problems.consoleErrors, `${label}: console errors`).toEqual([]);
  expect(problems.pageErrors, `${label}: uncaught exceptions`).toEqual([]);
  expect(problems.badRequests, `${label}: failing same-origin requests`).toEqual([]);

  const text = await page.evaluate(() => document.body?.innerText ?? '');
  const leaked = text.split('\n').filter((line) => RAW_MARKUP_IN_TEXT.test(line));
  expect(leaked, `${label}: raw markup rendered as visible text`).toEqual([]);
  expect(text, `${label}: raw ISO timestamp rendered as visible text`).not.toMatch(RAW_ISO_IN_TEXT);
  // NOTE: "[object Object]" must be matched as a literal — a regex character
  // class like /[object Object]/ matches almost any text and always fails.
  for (const garbage of ['[object Object]', 'Invalid Date', '>undefined<', '>NaN<']) {
    expect(text, `${label}: stringified value rendered as visible text (${garbage})`).not.toContain(garbage);
  }

  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, `${label}: horizontal overflow (scrollWidth - clientWidth)`).toBeLessThanOrEqual(1);

  const noAlt = await page.evaluate(() =>
    Array.from(document.images)
      .filter((img) => !img.hasAttribute('alt'))
      .map((img) => img.src),
  );
  expect(noAlt, `${label}: <img> without alt attribute`).toEqual([]);
}

test.describe('public pages render clean', () => {
  for (const path of PUBLIC_PAGES) {
    test(path, async ({ page }) => {
      const problems = await load(page, path);
      await expectCleanPage(page, path, problems);
    });
  }
});

// LIN-123: nav links measured ~22px tall at 390px — below the 44px
// touch-target minimum (Apple HIG). Every customer-facing nav element
// must now clear the floor; the fix lives in globals.css (min-height on
// nav.topbar a/button), this keeps it from regressing.
test('nav tap targets meet the 44px touch-target minimum (LIN-123)', async ({ page }) => {
  const width = page.viewportSize()?.width ?? 1280;
  test.skip(width > 880, 'touch-target floor only asserted at mobile widths');

  for (const path of ['/', '/pricing']) {
    await page.goto(path, { waitUntil: 'load' });
    const targets = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav.topbar a, nav.topbar button')).map((el) => ({
        label: (el.textContent ?? '').trim().slice(0, 24),
        height: Math.round(el.getBoundingClientRect().height),
      })),
    );
    expect(targets.length, `${path}: topbar must have nav targets to measure`).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.height, `${path} @ ${width}px: nav tap target "${t.label}"`).toBeGreaterThanOrEqual(44);
    }
  }
});

// LIN-121: the signup footer references "Terms and Privacy Policy" — the
// words must be real links and the targets must actually exist (they 404'd
// in production when the ticket was filed).
test('signup footer links the legal reference to live pages', async ({ page }) => {
  await page.goto('/signup', { waitUntil: 'load' });

  for (const target of ['/terms', '/privacy']) {
    const link = page.locator(`main a[href="${target}"]`);
    await expect(link, `${target} link in the signup footer`).toHaveCount(1);
    const href = await link.first().getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.status(), `${target} must resolve, not 404`).toBe(200);
  }
});

test.describe.serial('authed dashboard', () => {
  // Unique per project run — the mobile project repeats the flow with its own account.
  let email = '';
  let workspaceId: string;

  test('seed account, onboarding, and a hostile-markup deliverable', async ({ browser }, testInfo) => {
    email = `ui-qa-${testInfo.project.name}-${Date.now()}@example.com`;
    const ctx = await browser.newContext();
    const api = ctx.request;

    const signup = await api.post('/api/auth/signup', {
      data: { email, name: 'UI QA', password: 'correct-horse-battery', workspaceName: 'QA Co' },
    });
    expect(signup.ok(), 'signup should succeed').toBeTruthy();
    workspaceId = (await signup.json()).workspace.id;

    // Same onboarding sequence as scripts/e2e.sh, condensed.
    const steps: [string, unknown][] = [
      ['/onboarding/profile', { legalName: 'QA SAS', industry: 'software', size: '2-10', website: 'https://qa.example', description: 'We test UIs', tone: 'friendly', timezone: 'Europe/Paris' }],
      ['/onboarding/goals', { goals: ['capture_leads'] }],
      ['/onboarding/agents', { agents: [{ key: 'assistant', config: {} }, { key: 'marketing', config: {} }] }],
      ['/onboarding/connections', { connections: [{ provider: 'calendar' }] }],
      ['/onboarding/complete', {}],
    ];
    for (const [path, data] of steps) {
      const res = await api.post(`/api/workspaces/${workspaceId}${path}`, { data });
      expect(res.status(), `onboarding step ${path}`).toBe(200);
    }

    await ctx.close();
  });

  test('dashboard renders the hostile output as text, never as markup or script', async ({ page }) => {
    test.skip(!workspaceId, 'seeding failed');
    // page.request shares the context cookie jar, so the session cookie set
    // here rides along on the page navigation below.
    const login = await page.request.post('/api/auth/login', { data: { email, password: 'correct-horse-battery' } });
    expect(login.status()).toBe(200);

    const problems = await load(page, `/dashboard?workspace=${workspaceId}`);

    // Drive the real deliverable flow: submit a task through the composer,
    // then correct its output with the hostile payload via "Edit & correct".
    await page.getByPlaceholder(/what you need|what I need|in your own words/).fill('Summarize Q3.');
    await page.getByRole('button', { name: /^Ask / }).click();
    await expect(page.getByRole('button', { name: 'Edit & correct' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit & correct' }).click();
    await page.getByLabel('Edit the deliverable').fill(HOSTILE_OUTPUT);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Executive Summary')).toBeVisible();

    // The payload must appear as escaped text — never as elements or script.
    const injected = await page.evaluate(() => ({
      gammaEl: document.querySelector('i.gamma-class-name, span.gamma-class-name'),
      evilImg: document.querySelector('img[src*="evil.example"]'),
      pwned: (window as { __pwned?: unknown }).__pwned ?? null,
    }));
    expect(injected.gammaEl, 'gamma-class markup must not become an element').toBeNull();
    expect(injected.evilImg, 'img with onerror must not be injected').toBeNull();
    expect(injected.pwned, 'onerror script must never execute').toBeNull();

    await expectCleanPage(page, '/dashboard', problems);
  });

  test('onboarding wizard renders clean', async ({ page }) => {
    test.skip(!workspaceId, 'seeding failed');
    const login = await page.request.post('/api/auth/login', { data: { email, password: 'correct-horse-battery' } });
    expect(login.status()).toBe(200);
    const problems = await load(page, `/onboarding?workspace=${workspaceId}`);
    await expectCleanPage(page, '/onboarding', problems);
  });
});
