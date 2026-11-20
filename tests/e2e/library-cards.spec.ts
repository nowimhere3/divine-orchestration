import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeBackup, goTo, openApp, openBackup, openBirth, profileCard, removeProfile } from './helpers';

async function open(page: Page) {
  await openApp(page, 'library');
  await expect(page.getByRole('button', { name: 'Save current chart' })).toBeEnabled();
}

async function saveChart(page: Page, name: string, date?: string) {
  if (date) {
    await goTo(page, 'chart');
    await openBirth(page);
    await page.getByLabel('Birth date', { exact: true }).fill(date);
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await goTo(page, 'library');
  }
  await page.getByLabel('Profile name').fill(name);
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile saved locally.');
}

test('starts with a guiding empty state and saves a profile as a scannable card', async ({ page }) => {
  await open(page);
  await expect(page.locator('#profile-empty')).toBeVisible();
  await expect(page.locator('#profile-cards > li')).toHaveCount(0);
  await saveChart(page, 'Greenwich Example');
  await expect(page.locator('#profile-empty')).toBeHidden();
  const card = profileCard(page, 'Greenwich Example');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('1 January 2000');
  await expect(card).toContainText('12:00 local');
  await expect(card).toContainText('Europe/London');
  await expect(card).toContainText('51.48° N, 0.00° E');
  await expect(card).toContainText('Whole Sign houses');
  await expect(card.locator('.profile-avatar')).toHaveText('GE');
  await expect(page.getByLabel('Profile name')).toHaveValue('');
  // Actions are named for their profile, so repeated buttons stay distinguishable.
  for (const name of ['Load Greenwich Example', 'Rename Greenwich Example', 'Delete Greenwich Example']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('shows several profiles together and loads the chosen one', async ({ page }) => {
  await open(page);
  await saveChart(page, 'First');
  await saveChart(page, 'Second', '1980-04-15');
  await expect(page.locator('#profile-cards > li')).toHaveCount(2);
  await expect(profileCard(page, 'Second')).toContainText('15 April 1980');
  await page.getByRole('button', { name: 'Load First', exact: true }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile loaded.');
  await expect(page.getByRole('button', { name: 'Load First', exact: true })).toBeFocused();
  await expect(page.getByLabel('Birth date', { exact: true })).toHaveValue('2000-01-01');
  await page.getByRole('button', { name: 'Load Second', exact: true }).click();
  await expect(page.getByLabel('Birth date', { exact: true })).toHaveValue('1980-04-15');
  await goTo(page, 'chart');
  await expect(page.locator('#wheel-caption')).toContainText('1980-04-15');
});

test('renames inline with keyboard support, validation and cancel', async ({ page }) => {
  await open(page);
  await saveChart(page, 'Old name');
  await page.getByRole('button', { name: 'Rename Old name', exact: true }).click();
  const field = page.getByLabel('New name for Old name');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Old name');
  // An invalid name keeps the field open and says why.
  await field.fill('   ');
  await field.press('Enter');
  await expect(page.locator('#profile-status')).toContainText('1–80 characters');
  await expect(page.getByLabel('New name for Old name')).toBeVisible();
  // Escape cancels without changing anything and returns focus to Rename.
  await page.getByLabel('New name for Old name').press('Escape');
  await expect(page.getByRole('button', { name: 'Rename Old name', exact: true })).toBeFocused();
  await expect(profileCard(page, 'Old name')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rename Old name', exact: true }).click();
  await page.getByLabel('New name for Old name').fill('New name');
  await page.getByLabel('New name for Old name').press('Enter');
  await expect(page.locator('#profile-status')).toHaveText('Profile renamed.');
  await expect(profileCard(page, 'New name')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Rename New name', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Rename New name', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel renaming New name' }).click();
  await expect(profileCard(page, 'New name')).toHaveCount(1);
});

test('confirms deletion in the card, lets people keep the profile and moves focus sensibly', async ({ page }) => {
  await open(page);
  await saveChart(page, 'Keep me');
  await saveChart(page, 'Remove me', '1975-06-01');
  await page.getByRole('button', { name: 'Delete Remove me', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Delete “Remove me” from this browser?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep Remove me', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Keep Remove me', exact: true }).click();
  await expect(profileCard(page, 'Remove me')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Delete Remove me', exact: true })).toBeFocused();
  // Nothing was deleted by merely asking.
  await expect(page.locator('#profile-cards > li')).toHaveCount(2);
  await removeProfile(page, 'Remove me');
  await expect(page.locator('#profile-status')).toHaveText('Profile deleted.');
  await expect(page.locator('#profile-cards > li')).toHaveCount(1);
  await removeProfile(page, 'Keep me');
  await expect(page.locator('#profile-empty')).toBeVisible();
  await expect(page.getByLabel('Profile name')).toBeFocused();
});

test('backup and restore live in an accessible dialog that returns focus and reports honestly', async ({ page }) => {
  await open(page);
  await saveChart(page, 'Backed up');
  const opener = page.getByRole('button', { name: 'Backup & restore' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Backup and restore' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#backup-heading')).toBeFocused();
  await expect(dialog).toContainText('birth details and coordinates');
  // The page behind a modal dialog is inert, so keyboard focus stays inside.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('backup-dialog')!.contains(document.activeElement))).toBe(true);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download profile backup' }).click();
  expect((await download).suggestedFilename()).toBe('divine-orchestration-profiles.json');
  await expect(page.locator('#backup-status')).toContainText('personal birth details');
  await page.getByLabel('Restore profile backup').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  await expect(page.locator('#backup-status')).not.toHaveText('');
  await expect(page.locator('#profile-cards > li')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await closeBackup(page);
  await expect(opener).toBeFocused();
  await openBackup(page);
  await page.locator('#backup-dialog').click({ position: { x: 2, y: 2 } });
});

test('the library fits a phone: one column, no overflow, full-width actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await saveChart(page, 'Phone profile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const card = await profileCard(page, 'Phone profile').boundingBox();
  expect(card!.width).toBeGreaterThan(300);
  for (const name of ['Load Phone profile', 'Rename Phone profile', 'Delete Phone profile']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
});
