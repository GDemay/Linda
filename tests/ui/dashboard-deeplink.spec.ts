// LIN-150: a full-page load of bare /dashboard (or /dashboard/upgrade) with a
// valid session used to bounce to /login, kicking trial users — and, after
// Stripe go-live, fresh paying customers — out of the app. The workspace must
// now be resolved from the session instead.

import { expect, test } from '@playwright/test';

test.describe.serial('workspace-less deep links keep a valid session (LIN-150)', () => {
  let email = '';
  let workspaceId = '';

  test.beforeAll(async ({ browser }, testInfo) => {
    email = `deeplink-qa-${testInfo.project.name}-${Date.now()}@example.com`;
    const ctx = await browser.newContext();
    const signup = await ctx.request.post('/api/auth/signup', {
      data: { email, name: 'Deeplink QA', password: 'correct-horse-battery', workspaceName: 'Deeplink Co' },
    });
    expect(signup.ok(), 'signup should succeed').toBeTruthy();
    workspaceId = (await signup.json()).workspace.id;
    await ctx.close();
  });

  async function login(page: import('@playwright/test').Page) {
    // page.request shares the context cookie jar, so the session cookie set
    // here rides along on the page navigation below.
    const res = await page.request.post('/api/auth/login', { data: { email, password: 'correct-horse-battery' } });
    expect(res.status(), 'login should succeed').toBe(200);
  }

  test('bare /dashboard resolves the workspace and stays in the app', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard', { waitUntil: 'load' });

    // Not the login page — the dashboard itself, on the session's workspace.
    await expect(page).toHaveURL(new RegExp(`/dashboard\\?workspace=${workspaceId}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  });

  test('bare /dashboard survives a refresh (the exact QA repro)', async ({ page }) => {
    await login(page);
    await page.goto(`/dashboard?workspace=${workspaceId}`, { waitUntil: 'load' });
    await page.goto('/dashboard', { waitUntil: 'load' }); // simulate bookmark/deep link
    await expect(page).toHaveURL(new RegExp(`/dashboard\\?workspace=${workspaceId}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  });

  test('bare /dashboard/upgrade resolves the workspace too', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/upgrade', { waitUntil: 'load' });
    await expect(page).toHaveURL(new RegExp(`/dashboard/upgrade\\?workspace=${workspaceId}`));
    await expect(page.getByRole('heading', { level: 1, name: 'Upgrade' })).toBeVisible();
  });

  test('anonymous bare /dashboard still goes to /login', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/login/);
  });
});
