// LIN-205: the revenue funnel, end to end, through the real UI — the exact
// path a trialist's money takes. Every step below is a browser click/typing
// action against the running app; no API shortcuts except where noted (the
// final billing-overview read, which is the same check the success page
// itself performs).
//
// Signup form (+ the magic-link-only account variant) → onboarding wizard →
// dashboard trial state → upgrade page → checkout (LOCAL provider = test
// mode, zero real charge) → post-purchase activation state.
//
// The config's webServer runs with CHECKOUT_PROVIDER=local so the upgrade
// buttons are live; that provider fulfills in SQLite and never touches a
// card network.
//
// Session note: each test gets a fresh browser context, so the journey
// account signs up WITH a password and every later test re-logins through
// the real /api/auth/login (the same cookie-riding trick the LIN-150 spec
// uses). The no-password magic-link variant gets its own one-shot test.

import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'correct-horse-battery';

async function login(page: Page, email: string) {
  // page.request shares the context cookie jar, so the session cookie set
  // here rides along on the page navigations below.
  const res = await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(res.status(), 'login should succeed').toBe(200);
}

test.describe.serial('revenue funnel: signup → onboarding → dashboard → checkout → activation', () => {
  // This suite shares the machine with other agents' builds; under that
  // load even server-rendered pages can take tens of seconds to settle.
  test.setTimeout(90_000);

  // Unique per project run — the mobile project repeats the whole journey
  // on a Pixel 7 viewport, which doubles as the mobile-layout check.
  let email = '';
  let workspaceId = '';

  test('signup form blocks bad input inline (the pre-money gate)', async ({ page }) => {
    email = `funnel-qa-${test.info().project.name}-${Date.now()}@example.com`;
    await page.goto('/signup');

    // Empty submit: three inline errors, no network round trip needed.
    await page.getByRole('button', { name: /Start my free 14-day trial/ }).click();
    await expect(page.getByText('Please tell us your name')).toBeVisible();
    await expect(page.getByText('We need an email address')).toBeVisible();

    // Invalid email + too-short password both flag on the same submit.
    await page.locator('#name').fill('Funnel QA');
    await page.locator('#email').fill('not-an-email');
    await page.locator('#password').fill('short');
    await page.getByRole('button', { name: /Start my free 14-day trial/ }).click();
    await expect(page.getByText('That does not look like a valid email address')).toBeVisible();
    await expect(page.getByText('Passwords need at least 10 characters')).toBeVisible();

    // A fixed field clears its error without another submit (LIN-105 nicety).
    await page.locator('#email').fill(email);
    await expect(page.getByText('That does not look like a valid email address')).toBeHidden();
  });

  test('signup creates the account and rides into onboarding', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('#name').fill('Funnel QA');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: /Start my free 14-day trial/ }).click();

    await expect(
      page.getByText('Workspace created — check your inbox'),
      'success banner must confirm where the sign-in link went',
    ).toBeVisible();

    // Auto-redirect to the wizard (1.6s in the UI — allow slack).
    await expect(page).toHaveURL(/\/onboarding\?workspace=/, { timeout: 10_000 });
    workspaceId = new URL(page.url()).searchParams.get('workspace') ?? '';
    expect(workspaceId, 'onboarding URL carries the workspace id').not.toBe('');
    await expect(page.getByRole('heading', { name: 'Tell us about your business' })).toBeVisible();
  });

  test('the no-password magic-link variant signs up the same way', async ({ page }) => {
    // Blank password = the magic-link account variant (LIN-67 fix #5): the
    // emailed link is the way back in. Creation still opens a session so
    // the trialist lands in onboarding immediately.
    const linkEmail = `funnel-link-${test.info().project.name}-${Date.now()}@example.com`;
    await page.goto('/signup');
    await page.locator('#name').fill('Link QA');
    await page.locator('#email').fill(linkEmail);
    await page.getByRole('button', { name: /Start my free 14-day trial/ }).click();

    await expect(page.getByText('Workspace created — check your inbox')).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding\?workspace=/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Tell us about your business' })).toBeVisible();
  });

  test('magic-link re-entry UX: /login acknowledges without enumerating', async ({ page }) => {
    // The raw link token is stored hashed and no dev capture exists, so the
    // verify-success leg can't be driven without a mailbox (noted in the
    // LIN-205 report). The request-side contract is testable: same response
    // for known and unknown addresses.
    const known = await page.request.post('/api/auth/magic-link', { data: { email } });
    const unknown = await page.request.post('/api/auth/magic-link', {
      data: { email: `nobody-${Date.now()}@example.com` },
    });
    expect(known.status()).toBe(200);
    expect(unknown.status()).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
  });

  test('onboarding wizard: profile → goals → agents → knowledge → tools → done', async ({ page }) => {
    test.skip(!workspaceId, 'signup failed');
    await login(page, email);
    await page.goto(`/onboarding?workspace=${workspaceId}`);

    // Step 1 — company profile (name + industry are the required two).
    await page.locator('#legalName').fill('Funnel QA Co');
    await page.locator('#industry').fill('software');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 2 — pick goals: the one required choice before the workspace builds.
    await expect(page.getByRole('heading', { name: 'What do you want off your plate?' })).toBeVisible();
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 3 — hire agents.
    await expect(page.getByRole('heading', { name: 'Pick your agents' })).toBeVisible();
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: /Hire \d+ agent/ }).click();

    // Step 4 — knowledge is optional and says so; skip it the lazy way.
    await expect(
      page.getByRole('heading', { name: 'Give your agents your own material' }),
    ).toBeVisible();
    await page.getByRole('button', { name: /Continue without knowledge/ }).click();

    // Step 5 — connect tools, also optional; skip.
    await expect(page.getByRole('heading', { name: 'Connect your tools' })).toBeVisible();
    await page.getByRole('button', { name: /Skip — I'll do this later/ }).click();

    // Step 6 — first run: land on the dashboard without needing the demo task.
    await expect(page.getByRole('heading', { name: 'Your first task' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to dashboard' }).click();

    await expect(page).toHaveURL(new RegExp(`/dashboard\\?workspace=${workspaceId}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /Good (morning|afternoon|evening)/,
    );
  });

  test('dashboard shows the trial state and an upgrade path', async ({ page }) => {
    test.skip(!workspaceId, 'signup failed');
    // KNOWN DEFECT (LIN-205 report, hurts-conversion): at ≤900px the sidebar
    // holding the only standing 💳 Upgrade link is display:none, and the
    // nudges/prompt only appear in the trial's final week or at 80% usage —
    // so a mobile trialist mid-trial has no visible way to reach checkout.
    // Expected-to-fail on mobile until that's fixed; remove this gate then.
    test.fail(
      test.info().project.name === 'mobile',
      'no mobile upgrade entry point mid-trial (sidebar hidden at ≤900px)',
    );
    await login(page, email);
    await page.goto(`/dashboard?workspace=${workspaceId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /Good (morning|afternoon|evening)/,
    );
    // The nav upgrade link is the standing conversion path (LIN-131).
    await expect(page.getByRole('link', { name: /💳 Upgrade/ })).toBeVisible();
  });

  test('upgrade page → local checkout → success banner with receipt', async ({ page }) => {
    test.skip(!workspaceId, 'signup failed');
    // KNOWN DEFECT (LIN-205 report, blocks-trialist): invoices.number is
    // globally UNIQUE but sequenced per workspace, so the FIRST invoice of
    // every workspace in a month collides — checkout 500s for every
    // customer after the first. Desktop (first project) proves the happy
    // path; mobile (second) deterministically hits the 500. Expected-to-fail
    // here until the collision is fixed; remove this gate then.
    test.fail(
      test.info().project.name === 'mobile',
      'second checkout of the month 500s: invoices.number collision',
    );
    await login(page, email);
    await page.goto(`/dashboard/upgrade?workspace=${workspaceId}`);

    // Pre-purchase state: trial plan overview with days left.
    await expect(page.getByRole('heading', { name: 'Upgrade', exact: true })).toBeVisible();
    await expect(page.getByText(/trial, \d+ days? left/)).toBeVisible();

    // Buttons must be live (checkout configured = local test mode).
    const buy = page.getByRole('button', { name: 'Upgrade to Starter' });
    await expect(buy).toBeEnabled();
    await buy.click();

    // Local provider redirects to the success URL; the page must gate on the
    // real subscription (LIN-142), then show the receipt (LIN-187 leg).
    await expect(page).toHaveURL(/checkout=success&plan=starter/, { timeout: 15_000 });
    await expect(page.getByText("Payment received — you're on.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Receipt .+— \$49/)).toBeVisible({ timeout: 10_000 });
    // No lingering "activating" state once the gate says active.
    await expect(page.getByText('activating', { exact: false })).toBeHidden();
  });

  test('post-purchase: subscription is active and the plan shows as current', async ({ page }) => {
    test.skip(!workspaceId, 'signup failed');
    // NOTE (LIN-205 defect, partial-write facet): even when checkout 500s on
    // the invoice collision, the subscription upsert has already committed —
    // the plan IS active, only the invoice/success page are missing. That's
    // why this passes on mobile too, and it's part of the defect report.
    await login(page, email);
    // The same read the success page gates on — the authoritative state.
    const overview = await page.request.get(`/api/workspaces/${workspaceId}/billing`);
    expect(overview.ok()).toBeTruthy();
    const body = (await overview.json()) as {
      subscription: { plan: string; status: string } | null;
    };
    expect(body.subscription, 'a live subscription must exist after checkout').toMatchObject({
      plan: 'starter',
      status: 'active',
    });

    // And the human-visible state: the bought tier now reads "Current plan".
    await page.goto(`/dashboard/upgrade?workspace=${workspaceId}`);
    await expect(page.getByRole('button', { name: 'Current plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upgrade to Starter' })).toHaveCount(0);
  });

  test('the funnel never leaks horizontal overflow at this viewport', async ({ page }) => {
    test.skip(!workspaceId, 'signup failed');
    await login(page, email);
    // Cheap layout guard alongside the journey: every funnel surface the
    // trialist touched must not scroll sideways (mobile project = Pixel 7).
    for (const path of [
      '/signup',
      `/onboarding?workspace=${workspaceId}`,
      `/dashboard?workspace=${workspaceId}`,
      `/dashboard/upgrade?workspace=${workspaceId}`,
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflowed = await page.evaluate(() => {
        const d = document.documentElement;
        return d.scrollWidth - d.clientWidth;
      });
      expect(overflowed, `${path} must not overflow horizontally`).toBeLessThanOrEqual(0);
    }
  });
});
