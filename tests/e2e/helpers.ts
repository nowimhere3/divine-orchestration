import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export type View = 'chart' | 'events' | 'library' | 'export';
const label: Record<View, string> = { chart: 'Chart', events: 'Events', library: 'Library', export: 'Export' };

/** Opens the app, waits for the chart to finish loading, then optionally moves to another view. */
export async function openApp(page: Page, view: View = 'chart') {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Natal Sun', exact: true })).toBeVisible();
  if (view !== 'chart') await goTo(page, view);
}

/** Uses the primary navigation, as a person would. */
export async function goTo(page: Page, view: View) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label[view] }).click();
  await expect(page.locator(`#view-${view}`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#${view}$`));
}

export async function openBirth(page: Page) {
  await page.getByRole('button', { name: 'Edit birth details' }).click();
  await expect(page.getByRole('dialog', { name: 'Birth details' })).toBeVisible();
}

export async function closeBirth(page: Page) {
  await page.getByRole('button', { name: 'Close birth details' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** A saved-profile card in the Library, found by its heading. */
export const profileCard = (page: Page, name: string) =>
  page.locator('#profile-cards > li').filter({ has: page.getByRole('heading', { name, exact: true }) });

/** Deletes through the card's inline confirmation. */
export async function removeProfile(page: Page, name: string) {
  await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Delete profile', exact: true }).click();
}

export async function openBackup(page: Page) {
  await page.getByRole('button', { name: 'Backup & restore' }).click();
  await expect(page.getByRole('dialog', { name: 'Backup and restore' })).toBeVisible();
}

export async function closeBackup(page: Page) {
  await page.getByRole('button', { name: 'Close backup and restore' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
