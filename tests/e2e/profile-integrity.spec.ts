import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeBirth, goTo, openApp, openBirth, profileCard, removeProfile } from './helpers';

async function open(page: Page) {
  await openApp(page, 'library');
  await expect(page.getByRole('button', { name: 'Save current chart' })).toBeEnabled();
}

async function saveUnknownTimeProfile(page: Page, name: string) {
  await goTo(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1980-04-15');
  await page.getByLabel('Birth time unknown').check();
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await goTo(page, 'library');
  await page.getByLabel('Profile name').fill(name);
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile saved locally.');
}

const deleteSelected = removeProfile;
const rename = async (page: Page, from: string, to: string) => {
  await page.getByRole('button', { name: `Rename ${from}`, exact: true }).click();
  await page.getByLabel(`New name for ${from}`).fill(to);
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
};

test('loading a profile deleted in another tab reports it missing and keeps the current chart', async ({ page, context }) => {
  await open(page);
  await saveUnknownTimeProfile(page, 'Gone soon');
  await goTo(page, 'library');
  const other = await context.newPage();
  await open(other);
  await expect(profileCard(other, 'Gone soon')).toBeVisible();
  const caption = await other.locator('#wheel-caption').textContent();

  await deleteSelected(page, 'Gone soon');
  await expect(page.locator('#profile-status')).toHaveText('Profile deleted.');

  await other.getByRole('button', { name: 'Load Gone soon', exact: true }).click();
  await expect(other.locator('#profile-status')).toContainText('no longer exists');
  await expect(other.locator('#profile-status')).not.toContainText('Profile loaded');
  await expect(other.locator('#wheel-caption')).toHaveText(caption!);
  await expect(other.getByLabel('Birth date', { exact: true })).toHaveValue('2000-01-01');
  await expect(other.locator('#profile-cards > li')).toHaveCount(0);
  await expect(other.locator('#profile-empty')).toBeVisible();
});

test('loading a profile renamed in another tab uses the stored record', async ({ page, context }) => {
  await open(page);
  await saveUnknownTimeProfile(page, 'Before');
  const other = await context.newPage();
  await open(other);
  await expect(profileCard(other, 'Before')).toBeVisible();

  await rename(page, 'Before', 'After');
  await expect(page.locator('#profile-status')).toHaveText('Profile renamed.');

  await other.getByRole('button', { name: 'Load Before', exact: true }).click();
  await expect(other.locator('#profile-status')).toHaveText('Profile loaded.');
  await expect(profileCard(other, 'After')).toBeVisible();
  await expect(profileCard(other, 'Before')).toHaveCount(0);
  await expect(other.getByLabel('Birth time unknown')).toBeChecked();
});

test('renaming or deleting a profile already deleted in another tab is reported honestly', async ({ page, context }) => {
  await open(page);
  await saveUnknownTimeProfile(page, 'Twice');
  const other = await context.newPage();
  await open(other);
  await expect(profileCard(other, 'Twice')).toBeVisible();
  await deleteSelected(page, 'Twice');
  await expect(page.locator('#profile-status')).toHaveText('Profile deleted.');

  await rename(other, 'Twice', 'Revived?');
  await expect(other.locator('#profile-status')).toContainText('no longer exists');
  await other.reload();
  await expect(other.locator('#profile-status')).toHaveText('Library ready.');
  await expect(other.locator('#profile-cards > li')).toHaveCount(0);

  // A record deleted elsewhere is reported as already gone, not as a fresh deletion.
  await saveUnknownTimeProfile(other, 'Raced');
  await page.reload();
  await expect(page.locator('#profile-status')).toHaveText('Library ready.');
  await expect(profileCard(page, 'Raced')).toBeVisible();
  await deleteSelected(other, 'Raced');
  await expect(other.locator('#profile-status')).toHaveText('Profile deleted.');
  await deleteSelected(page, 'Raced');
  await expect(page.locator('#profile-status')).toContainText('already deleted');
});

test('unknown birth time with one coordinate is rejected before calculating or saving', async ({ page }) => {
  await openApp(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1980-04-15');
  await page.getByLabel('Birth time unknown').check();
  const status = page.locator('#birth-status');

  await page.getByLabel('Latitude').fill('45');
  await page.getByLabel('Longitude').fill('');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(status).toContainText('both latitude and longitude');
  await expect(page.getByRole('dialog', { name: 'Birth details' })).toBeVisible();
  await expect(page.getByLabel('Latitude')).toHaveValue('45');
  await expect(page.locator('#wheel-caption')).not.toContainText('Transit only');
  await closeBirth(page);
  await goTo(page, 'library');
  await page.getByLabel('Profile name').fill('Partial');
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toContainText('Calculate the edited birth details');
  await expect(page.locator('#profile-cards > li')).toHaveCount(0);

  await goTo(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Latitude').fill('');
  await page.getByLabel('Longitude').fill('12.5');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(status).toContainText('both latitude and longitude');
  await expect(page.getByLabel('Longitude')).toHaveValue('12.5');
});

test('unknown birth time with both coordinates blank, or both given, still calculates and saves', async ({ page }) => {
  await openApp(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1980-04-15');
  await page.getByLabel('Birth time unknown').check();
  await page.getByLabel('Latitude').fill('');
  await page.getByLabel('Longitude').fill('');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.locator('#wheel-caption')).toContainText('Transit only');
  await goTo(page, 'library');
  await page.getByLabel('Profile name').fill('Blank coords');
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile saved locally.');

  await goTo(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Latitude').fill('45');
  await page.getByLabel('Longitude').fill('7');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.locator('#wheel-caption')).toContainText('Transit only');
  await goTo(page, 'library');
  await page.getByLabel('Profile name').fill('Both coords');
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile saved locally.');
  await page.getByRole('button', { name: 'Load Both coords', exact: true }).click();
  await expect(page.getByLabel('Latitude')).toHaveValue('45');
  await expect(page.getByLabel('Longitude')).toHaveValue('7');
});
