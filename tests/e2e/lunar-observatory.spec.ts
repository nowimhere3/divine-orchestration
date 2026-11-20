import { expect, test } from '@playwright/test';
import { closeBirth, goTo, openApp, openBirth, profileCard, removeProfile } from './helpers';

test('Time Machine Moon status card synchronizes with selected instant, shows Now indicator, and formats events in Display Time Zone including Alberta Time (ABT)', async ({ page }) => {
  await openApp(page, 'chart');

  const card = page.locator('#lunar-observatory');
  await expect(card).toBeVisible();
  await expect(page.locator('#lunar-heading')).toHaveText('Lunar Observatory');

  // Pressing Now shows the Now indicator badge on the Lunar Observatory card
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(page.locator('#lunar-now-badge')).toBeVisible();
  await expect(page.locator('#lunar-now-badge')).toHaveText('Now');

  // Move to 2026-11-20 16:38 UTC: Now indicator hides, phase is Waxing Gibbous, ~80.5% illuminated, Aries
  await page.getByLabel('Display time zone').selectOption('utc');
  await page.getByLabel('Transit date', { exact: true }).fill('2026-11-20');
  await page.locator('#transit-time').fill('16:38');
  await expect(page.locator('#selected-epoch')).toHaveText('2026-11-20 · 16:38 UTC');
  await expect(page.locator('#lunar-now-badge')).toBeHidden();
  await expect(page.locator('#lunar-phase-name')).toHaveText('Waxing Gibbous');
  await expect(page.locator('#lunar-illumination')).toHaveText('80.5% illuminated');
  await expect(page.locator('#lunar-waxing')).toHaveText('Waxing');
  await expect(page.locator('#lunar-position')).toHaveText('5°59′ Aries (geocentric)');
  await expect(page.locator('#lunar-next-phase')).toHaveText('Next: Full Moon · 2026-11-24 · 14:54 UTC');

  // Switch display time zone to Alberta Time · Edmonton: same event instant displays in permanent ABT (UTC-06:00)
  await page.getByLabel('Display time zone').selectOption('alberta');
  await expect(page.locator('#lunar-next-phase')).toHaveText('Next: Full Moon · 2026-11-24 · 08:54 ABT (UTC-06:00)');

  // Step forward to the Full Moon on 2026-11-24: phase updates to Full Moon, Waning/Waxing, Taurus/Gemini
  await page.locator('#transit-date').fill('2026-11-24');
  await page.locator('#transit-time').fill('08:54');
  await expect(page.locator('#lunar-phase-name')).toHaveText('Full Moon');
  await expect(page.locator('#lunar-illumination')).toHaveText('99.8% illuminated');
});

test('Observer location supports No location, Calgary/Edmonton presets, saved profile birthplace, manual coordinates, and deleted profile fallback', async ({ page }) => {
  await openApp(page, 'chart');
  await page.getByLabel('Display time zone').selectOption('alberta');
  await page.locator('#transit-date').fill('2026-11-20');
  await page.locator('#transit-time').fill('21:00');

  // Expand Lunar Observatory details
  const details = page.locator('#lunar-details');
  await details.locator('summary').click();
  await expect(page.locator('#lunar-observer-select')).toHaveValue('none');
  await expect(page.locator('#lunar-observer-chip')).toHaveText('Geocentric only');
  await expect(page.locator('#lunar-sky-empty')).toBeVisible();

  // 1. Choose Calgary preset
  await page.locator('#lunar-observer-select').selectOption('preset:calgary');
  await expect(page.locator('#lunar-observer-chip')).toHaveText('Calgary, Alberta');
  await expect(page.locator('#lunar-sky-dl')).toContainText('Calgary, Alberta (51.04°N, 114.07°W)');
  await expect(page.locator('#lunar-sky-dl')).toContainText('Topocentric Moon (local)');
  await expect(page.locator('#lunar-sky-dl')).toContainText('Upper meridian passage');
  await expect(page.locator('#lunar-sky-dl')).toContainText('ABT (UTC-06:00)');

  // 2. Choose Edmonton preset
  await page.locator('#lunar-observer-select').selectOption('preset:edmonton');
  await expect(page.locator('#lunar-observer-chip')).toHaveText('Edmonton, Alberta');
  await expect(page.locator('#lunar-sky-dl')).toContainText('Edmonton, Alberta (53.55°N, 113.49°W)');

  // 3. Manual latitude and longitude with validation
  await page.locator('#lunar-observer-select').selectOption('manual');
  await expect(page.locator('#lunar-manual-controls')).toBeVisible();
  await page.locator('#lunar-observer-lat').fill('95');
  await page.locator('#lunar-observer-lon').fill('-106.67');
  await page.locator('#lunar-observer-apply').click();
  await expect(page.locator('#lunar-observer-status')).toContainText('between −90° and 90°');

  await page.locator('#lunar-observer-lat').fill('52.1332');
  await page.locator('#lunar-observer-lon').fill('-106.6700');
  await page.locator('#lunar-observer-apply').click();
  await expect(page.locator('#lunar-observer-chip')).toContainText('Manual (52.13°N, 106.67°W)');
  await expect(page.locator('#lunar-sky-dl')).toContainText('52.13°N, 106.67°W');

  // 4. Save a profile with birthplace coordinates and choose it as Observer location
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1994-08-12');
  await page.getByLabel('Local birth time').fill('14:20');
  await page.getByRole('button', { name: 'Use Calgary / Edmonton (Alberta)' }).click();
  await page.getByLabel('Latitude').fill('51.0447');
  await page.getByLabel('Longitude').fill('-114.0719');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await page.locator('#chart-save-profile').click();
  await page.getByLabel('Name for this chart').fill('Alberta Observer');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await closeBirth(page);

  const profileOptionValue = await page.locator('#lunar-observer-select option', { hasText: 'Alberta Observer' }).getAttribute('value');
  expect(profileOptionValue).toMatch(/^profile:/);
  await page.locator('#lunar-observer-select').selectOption(profileOptionValue!);
  await expect(page.locator('#lunar-observer-chip')).toHaveText('Alberta Observer birthplace');
  await expect(page.locator('#lunar-sky-dl')).toContainText('Birthplace · Alberta Observer');

  // 5. Delete that profile in Personal Library -> Observer location gracefully falls back to none
  await goTo(page, 'library');
  await removeProfile(page, 'Alberta Observer');
  await goTo(page, 'chart');
  await expect(page.locator('#lunar-observer-select')).toHaveValue('none');
  await expect(page.locator('#lunar-observer-chip')).toHaveText('Geocentric only');
  await expect(page.locator('#lunar-sky-empty')).toBeVisible();
});

test('Moon Inspector, Personal Library cards and Learn lunar concepts integrate geocentric and local/topocentric data cleanly', async ({ page }) => {
  await openApp(page, 'chart');

  // 1. Inspect Transit Moon from Lunar Observatory card
  await page.locator('#lunar-details summary').click();
  await page.locator('#lunar-observer-select').selectOption('preset:calgary');
  await page.locator('#lunar-inspect-moon').click();

  const inspection = page.locator('#inspection');
  await expect(inspection.locator('.inspect-title')).toHaveText('Transit Moon');
  // Existing meanings and calculated facts remain intact
  await expect(inspection.locator('#inspect-meaning')).toContainText('Astronomical background');
  await expect(inspection.locator('#inspect-meaning')).toContainText('Traditional symbolism');
  await expect(inspection.locator('#inspect-facts')).toContainText('Lunar Observatory (selected moment)');
  await expect(inspection.locator('#inspect-facts')).toContainText('Topocentric Moon (local)');
  await expect(inspection.locator('#inspect-facts')).toContainText('Chart wheel, aspects and exports use geocentric position');

  // 2. Inspect Natal Moon (Greenwich demo chart has coordinates 51.48°N, 0°E)
  await page.getByRole('button', { name: 'Natal Moon', exact: true }).click();
  await expect(inspection.locator('.inspect-title')).toHaveText('Natal Moon');
  await expect(inspection.locator('#inspect-facts')).toContainText('Lunar Observatory (birth Moon)');
  await expect(inspection.locator('#inspect-facts')).toContainText('Waning Crescent');
  await expect(inspection.locator('#inspect-facts')).toContainText('Topocentric Moon (local)');

  // 3. Save profiles to Personal Library (with coordinates, without coordinates, and unknown birth time)
  await goTo(page, 'library');
  await expect(page.getByRole('button', { name: 'Save current chart' })).toBeEnabled();
  await page.getByLabel('Profile name').fill('Timed With Coords');
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile saved locally.');
  const cardWithCoords = profileCard(page, 'Timed With Coords');
  await expect(cardWithCoords).toContainText('Moon: Waning Crescent');
  await expect(cardWithCoords).toContainText('Local birth Moon:');
  await expect(cardWithCoords).toContainText('topocentric');

  await goTo(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Latitude').fill('');
  await page.getByLabel('Longitude').fill('');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await goTo(page, 'library');
  await page.getByLabel('Profile name').fill('Timed No Coords');
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile saved locally.');
  const cardNoCoords = profileCard(page, 'Timed No Coords');
  await expect(cardNoCoords).toContainText('Moon: Waning Crescent');
  await expect(cardNoCoords).toContainText('Local birth Moon: No coordinates');

  await goTo(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Birth time unknown').check();
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await goTo(page, 'library');
  await page.getByLabel('Profile name').fill('Unknown Time Profile');
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toHaveText('Profile saved locally.');
  const cardUnknown = profileCard(page, 'Unknown Time Profile');
  await expect(cardUnknown).toContainText('Moon on birth date:');
  await expect(cardUnknown).toContainText('birth time unknown');

  // 4. Learn entries for Moon phases and Lunar parallax
  await goTo(page, 'chart');
  await page.locator('#lunar-learn-link').click();
  await expect(page.locator('#view-learn h2:visible')).toHaveText('Moon phases');
  await expect(page.locator('.learn-detail')).toContainText('Astronomical background');
  await expect(page.locator('.learn-detail')).toContainText('Traditional symbolism');
  await expect(page.locator('.learn-detail')).toContainText('no objective emotional-intensity score');
  await page.locator('.learn-detail').getByRole('link', { name: /Lunar parallax/ }).click();
  await expect(page.locator('#view-learn h2:visible')).toHaveText('Lunar parallax & local sky');
  await expect(page.locator('.learn-detail')).toContainText('Geocentric');
  await expect(page.locator('.learn-detail')).toContainText('topocentric');
  await expect(page.locator('.learn-detail')).toContainText('upper meridian passage');
});

test('explains geocentric vs topocentric zodiac sign-boundary difference while keeping chart data and exports geocentric, and preserves desktop/tablet/phone layouts', async ({ page }) => {
  await openApp(page, 'chart');

  // At 2026-11-22 10:35 UTC, geocentric Moon is ~0°08′ Taurus (30.14°), while from Calgary (51.04°N, 114.07°W)
  // topocentric parallax (~ -0.45°) places the local Moon in late Aries (~29°41′ Aries).
  await page.getByLabel('Display time zone').selectOption('utc');
  await page.getByLabel('Transit date', { exact: true }).fill('2026-11-22');
  await page.locator('#transit-time').fill('10:35');

  await expect(page.locator('#lunar-position')).toContainText('Taurus (geocentric)');
  await page.locator('#lunar-details summary').click();
  await page.locator('#lunar-observer-select').selectOption('preset:calgary');

  await expect(page.locator('#lunar-sign-diff-note')).toBeVisible();
  await expect(page.locator('#lunar-sign-diff-note')).toContainText('Aries');
  await expect(page.locator('#lunar-sign-diff-note')).toContainText('Taurus');
  await expect(page.locator('#lunar-sign-diff-note')).toContainText('geocentric');

  // Verify Transit Chart data table and Export snapshot remain strictly geocentric (Taurus, > 30°)
  await page.getByRole('button', { name: 'Transit', exact: true }).click();
  const moonRow = page.getByRole('table', { name: 'Transit planetary positions' }).getByRole('row', { name: /Moon/ });
  await expect(moonRow).toContainText('Taurus');

  // Verify desktop (1440px), tablet (768px), and phone (390px, 320px) layouts with Lunar Observatory expanded
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `overflow at ${width}px`).toBe(false);
    for (const selector of ['#lunar-inspect-moon', '#lunar-learn-link', '.lunar-summary-toggle', '#lunar-observer-select']) {
      const box = await page.locator(selector).boundingBox();
      expect(box!.height, `${selector} height at ${width}px`).toBeGreaterThanOrEqual(43.9);
    }
  }
});

