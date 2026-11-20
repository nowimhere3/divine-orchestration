import { expect, test } from '@playwright/test';
import { goTo, openApp } from './helpers';

test('Alberta entry, midnight stepping, export and preference persistence', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Display time zone').selectOption('alberta');
  await page.locator('#transit-date').fill('2027-01-05');
  await page.locator('#transit-time').fill('23:45');
  await page.getByRole('button', { name: 'Hour', exact: true }).click();
  await page.getByRole('button', { name: 'Next hour' }).click();
  await expect(page.locator('#selected-epoch')).toHaveText('2027-01-06 · 00:45 ABT (UTC-06:00)');
  await goTo(page, 'export');
  await page.getByRole('radio', { name: 'Full', exact: true }).check();
  await page.getByRole('button', { name: 'Prepare export' }).click();
  await page.getByRole('radio', { name: 'JSON', exact: true }).check();
  const snapshot = JSON.parse(await page.locator('#export-preview').inputValue());
  expect(snapshot.context.selectedAt.utc).toBe('2027-01-06T06:45:00.000Z');
  await goTo(page, 'chart');
  await page.reload();
  await expect(page.getByLabel('Display time zone')).toHaveValue('alberta');
});

test('named local entry distinguishes repeated hours and rejects skipped ones', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Display time zone').selectOption('named');
  await page.locator('#named-zone').fill('America/New_York');
  await page.locator('#named-zone').press('Tab');
  await page.locator('#transit-date').fill('2025-11-02');
  await page.locator('#transit-time').fill('01:30');
  await page.locator('#transit-fold').selectOption('1');
  await expect(page.locator('#selected-epoch')).toContainText('UTC-05:00');
  await page.getByRole('button', { name: 'Hour', exact: true }).click();
  await page.getByRole('button', { name: 'Previous hour' }).click();
  await expect(page.locator('#selected-epoch')).toHaveText('2025-11-02 · 01:30 America/New_York (UTC-04:00)');
  await page.getByRole('button', { name: 'Next hour' }).click();
  await page.getByLabel('Display time zone').selectOption('utc');
  await expect(page.locator('#selected-epoch')).toHaveText('2025-11-02 · 06:30 UTC');
  await page.getByLabel('Display time zone').selectOption('named');
  await page.locator('#transit-time').fill('12:00');
  await page.locator('#transit-date').fill('2025-03-09');
  await page.locator('#transit-time').fill('02:30');
  await page.locator('#transit-time').press('Tab');
  await expect(page.locator('#transit-status')).toContainText('skipped');
});
