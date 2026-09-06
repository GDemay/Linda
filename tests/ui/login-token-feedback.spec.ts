import { test, expect } from '@playwright/test';

/**
 * LIN-120: a magic-link token landing directly on /login (old-format or
 * hand-edited links) must never render the silent plain form. It is forwarded
 * through the verify route, and a dead token bounces back as an explicit,
 * visible error with the email field pre-focused for a fresh request.
 */
test('invalid token on /login shows the expired-link banner, not a silent form', async ({ page }) => {
  await page.goto('/login?token=deadbeef');

  // Forwarded to the verify route, which bounces back with the error flag.
  await expect(page).toHaveURL(/\/login\?error=invalid_link$/);

  // Explicit invalid/expired feedback, not just the plain login form.
  await expect(page.getByText('That sign-in link is invalid or expired.')).toBeVisible();
  await expect(page.getByText('That sign-in link has expired or was already used.')).toBeVisible();

  // The user's next step is requesting a fresh link — pre-focus the field.
  await expect(page.locator('#email')).toBeFocused();
});
