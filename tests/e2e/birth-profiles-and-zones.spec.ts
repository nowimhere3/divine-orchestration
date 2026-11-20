import { expect, test } from '@playwright/test';
import { closeBirth, goTo, openApp, openBackup, openBirth, profileCard, removeProfile } from './helpers';

test('saves multiple profiles from Birth Details, switches from Chart view, and persists across reload', async ({ page }) => {
  await openApp(page, 'chart');
  await expect(page.locator('#chart-profile-badge')).toHaveText('Demonstration chart');
  await expect(page.locator('#chart-profile-bar')).toBeHidden();

  // 1. Calculate and save "My Chart" directly from Birth Details
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1990-05-15');
  await page.getByLabel('Local birth time').fill('08:30');
  await page.getByRole('button', { name: 'Use Calgary / Edmonton (Alberta)' }).click();
  await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('America/Edmonton');
  await page.getByLabel('Latitude').fill('51.0447');
  await page.getByLabel('Longitude').fill('-114.0719');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await expect(page.locator('#chart-profile-badge')).toHaveText('Unsaved chart');
  await page.locator('#chart-save-profile').click();
  await expect(page.getByRole('dialog', { name: 'Birth details' })).toBeVisible();
  await expect(page.getByLabel('Name for this chart')).toBeFocused();
  await page.getByLabel('Name for this chart').fill('My Chart');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.locator('#birth-profile-status')).toContainText('Saved “My Chart”');
  await closeBirth(page);
  await expect(page.locator('#chart-profile-badge')).toHaveText('Loaded profile: My Chart');

  // 2. Calculate and save "Partner" (does not overwrite My Chart)
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1992-11-20');
  await page.getByLabel('Local birth time').fill('19:15');
  await page.getByLabel('Time zone', { exact: true }).fill('Tokyo');
  await page.locator('#birth-zone-list [role="option"]').first().dispatchEvent('pointerdown');
  await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('Asia/Tokyo');
  await page.getByLabel('Latitude').fill('35.6762');
  await page.getByLabel('Longitude').fill('139.6503');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await openBirth(page);
  await page.getByLabel('Name for this chart').fill('Partner');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.locator('#birth-profile-status')).toContainText('Saved “Partner”');
  await closeBirth(page);
  await expect(page.locator('#chart-profile-badge')).toHaveText('Loaded profile: Partner');

  // 3. Calculate and save "Family Member" with unknown birth time
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1965-03-10');
  await page.getByLabel('Birth time unknown').check();
  await page.getByLabel('Latitude').fill('');
  await page.getByLabel('Longitude').fill('');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await openBirth(page);
  await page.getByLabel('Name for this chart').fill('Family Member');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.locator('#birth-profile-status')).toContainText('Saved “Family Member”');
  await closeBirth(page);

  // 4. Switch between saved profiles from Chart view
  const select = page.locator('#chart-profile-select');
  await expect(select.locator('option')).toHaveCount(3);
  const myChartValue = await select.locator('option', { hasText: 'My Chart' }).getAttribute('value');
  await select.selectOption(myChartValue!);
  await page.getByRole('button', { name: 'Load profile', exact: true }).click();
  await expect(page.locator('#chart-profile-badge')).toHaveText('Loaded profile: My Chart');
  await expect(page.locator('#wheel-caption')).toContainText('1990-05-15');

  // 5. Library remains canonical and shows Loaded badge
  await goTo(page, 'library');
  await expect(page.locator('#profile-cards > li')).toHaveCount(3);
  await expect(profileCard(page, 'My Chart')).toHaveAttribute('data-active', 'true');
  await expect(profileCard(page, 'My Chart')).toContainText('Loaded');

  // 6. Backup compatibility
  await openBackup(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download profile backup' }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const backupJson = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(backupJson.schema).toBe('divine-orchestration/profiles');
  expect(backupJson.version).toBe(1);
  expect(backupJson.profiles).toHaveLength(3);

  // 7. Browser reload preserves profiles in IndexedDB
  await page.reload();
  await expect(page.locator('#profile-cards > li')).toHaveCount(3);
  await goTo(page, 'chart');
  await expect(page.locator('#chart-profile-select option')).toHaveCount(3);
});

test('marks unsaved edits, blocks saving failed calculations, and never silently overwrites another profile', async ({ page }) => {
  await openApp(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1988-07-04');
  await page.getByLabel('Local birth time').fill('10:00');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await page.locator('#chart-save-profile').click();
  await page.getByLabel('Name for this chart').fill('Original');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await closeBirth(page);

  // Edit birth details to an invalid time -> Save profile is disabled & calculation fails
  await openBirth(page);
  await page.getByLabel('Local birth time').fill('2:00 PM');
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await expect(page.locator('#birth-save-state')).toContainText('Calculate the edited birth details before saving');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.locator('#birth-time-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await closeBirth(page);

  // Chart view clearly shows unsaved edits while retaining Original on the wheel
  await expect(page.locator('#chart-profile-badge')).toHaveText('Unsaved edits · showing Original');
  await expect(page.locator('#chart-notice')).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('#wheel-caption')).toContainText('1988-07-04');

  // Fix and calculate a new date -> becomes Unsaved chart, Original is not overwritten
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1999-09-09');
  await page.getByLabel('Local birth time').fill('14:00');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.locator('#chart-profile-badge')).toHaveText('Unsaved chart');
  await expect(page.locator('#wheel-caption')).toContainText('1999-09-09');

  await goTo(page, 'library');
  await expect(profileCard(page, 'Original')).toContainText('4 July 1988');
  await removeProfile(page, 'Original');
});

test('cross-tab deletion is reported honestly when switching from Chart view', async ({ page, context }) => {
  await openApp(page, 'chart');
  await openBirth(page);
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await openBirth(page);
  await page.getByLabel('Name for this chart').fill('Tab Test');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await closeBirth(page);

  const other = await context.newPage();
  await openApp(other, 'library');
  await expect(profileCard(other, 'Tab Test')).toBeVisible();
  await removeProfile(other, 'Tab Test');
  await expect(other.locator('#profile-status')).toHaveText('Profile deleted.');

  await page.getByRole('button', { name: 'Load profile', exact: true }).click();
  await expect(page.locator('#chart-profile-status')).toContainText('no longer exists');
  await expect(page.locator('#chart-profile-bar')).toBeHidden();
});

test('searchable time-zone combobox handles keyboard, Calgary/Alberta, historical rules, and manual IANA', async ({ page }) => {
  await openApp(page, 'chart');
  await openBirth(page);

  const zone = page.getByLabel('Time zone', { exact: true });
  const list = page.locator('#birth-zone-list');
  const summary = page.locator('#birth-zone-summary');

  // Search friendly city "Calgary", navigate with ArrowDown + Enter, Escape closes list without closing dialog
  await zone.click();
  await expect(list).toBeVisible();
  await zone.press('Escape');
  await expect(list).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Birth details' })).toBeVisible();

  await zone.fill('Calgary');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Calgary / Edmonton · Alberta');
  await zone.press('Enter');
  await expect(zone).toHaveValue('America/Edmonton');
  await expect(list).toBeHidden();

  // U1 permanent Alberta Time (from Nov 2026) vs historical Edmonton (1995)
  await page.getByLabel('Birth date', { exact: true }).fill('2027-01-15');
  await expect(summary).toContainText('Permanent Alberta Time');
  await page.getByLabel('Birth date', { exact: true }).fill('1995-01-15');
  await expect(summary).toContainText('7 hours behind Greenwich');

  // Manual IANA entry for uncommon historical location
  await zone.fill('Canada/Mountain');
  await expect(summary).toContainText('Manual IANA zone (Canada/Mountain)');
  await page.getByLabel('Birth date', { exact: true }).fill('1960-06-01');
  await expect(summary).toContainText('Historical zone rules before 1970');

  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#chart-notice')).toContainText('Canada/Mountain');
});

test('Chart view and Birth Details fit a phone layout with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, 'chart');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await openBirth(page);
  await page.getByRole('button', { name: 'Use Calgary / Edmonton (Alberta)' }).click();
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await page.locator('#chart-save-profile').click();
  await page.getByLabel('Name for this chart').fill('Phone Chart');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await closeBirth(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  const loadBox = await page.getByRole('button', { name: 'Load profile', exact: true }).boundingBox();
  expect(loadBox!.height).toBeGreaterThanOrEqual(44);
});
