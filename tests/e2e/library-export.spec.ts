import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { closeBackup, goTo, openApp, openBackup, openBirth, profileCard, removeProfile } from './helpers';

async function open(page: Page, view: 'chart' | 'library' | 'export' = 'library') {
  await openApp(page, view);
  if (view === 'library') await expect(page.getByRole('button', { name: 'Save current chart' })).toBeEnabled();
}

const fileText = async (download: Download) => readFile((await download.path())!, 'utf8');

test('persists an unknown-time profile, renames it, restores a backup in a fresh context and deletes it', async ({ page, browser }) => {
  await open(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1980-04-15');
  await page.getByLabel('Birth time unknown').check();
  await page.locator('#house-system').selectOption('Placidus');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await goTo(page, 'library');
  await expect(page.getByRole('button', { name: 'Save current chart' })).toBeEnabled();
  await page.getByLabel('Profile name').fill('Date only');
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile saved locally.');
  await page.reload();
  await page.getByRole('button', { name: 'Load Date only', exact: true }).click();
  await expect(page.locator('#wheel-caption')).toContainText('Transit only');
  await expect(page.getByLabel('Birth date', { exact: true })).toHaveValue('1980-04-15');
  await expect(page.getByLabel('Birth time unknown')).toBeChecked();
  await expect(page.locator('#house-system')).toHaveValue('Placidus');
  await page.getByRole('button', { name: 'Rename Date only', exact: true }).click();
  await page.getByLabel('New name for Date only').fill('Renamed');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile renamed.');
  await expect(profileCard(page, 'Renamed')).toBeVisible();
  await openBackup(page);
  const backupReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download profile backup' }).click();
  const text = await fileText(await backupReady);
  const backup = JSON.parse(text);
  expect(backup).toMatchObject({ version: 1, profiles: [{ name: 'Renamed', birth: { time: null } }] });

  const fresh = await browser.newContext();
  try {
    const restored = await fresh.newPage();
    await restored.goto(page.url());
    await openBackup(restored);
    await expect(restored.getByLabel('Restore profile backup')).toBeEnabled();
    const upload = (content: string) => restored.getByLabel('Restore profile backup')
      .setInputFiles({ name: 'profiles.json', mimeType: 'application/json', buffer: Buffer.from(content) });
    await upload(JSON.stringify({ ...backup, profiles: [...backup.profiles, { ...backup.profiles[0], id: 'invalid', birth: { date: '2023-02-29', time: null } }] }));
    await expect(restored.locator('#profile-status')).toContainText('cannot be resolved');
    await expect(restored.locator('#profile-cards > li')).toHaveCount(0);
    await upload(text);
    await expect(restored.locator('#profile-status')).toHaveText('Restored 1 profile.');
    await upload(text);
    await expect(restored.locator('#profile-status')).toContainText('already exists');
    await closeBackup(restored);
    await restored.getByRole('button', { name: 'Load Renamed', exact: true }).click();
    await expect(restored.locator('#wheel-caption')).toContainText('Transit only');
    await removeProfile(restored, 'Renamed');
    await expect(restored.locator('#profile-status')).toHaveText('Profile deleted.');
    await restored.reload();
    await expect(restored.locator('#profile-status')).toHaveText('Library ready.');
    await expect(restored.locator('#profile-cards > li')).toHaveCount(0);
  } finally { await fresh.close(); }
});
