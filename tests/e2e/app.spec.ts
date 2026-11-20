import { expect, test } from '@playwright/test';

test('starts Divine Orchestration in the browser', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle('Divine Orchestration');
  await expect(page.getByRole('heading', { name: 'Divine Orchestration', level: 1 })).toBeVisible();
});
