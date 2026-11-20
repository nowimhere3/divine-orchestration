import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { goTo, openApp, openBirth } from './helpers';

const readingPanel = (page: Page) => page.locator('#personal-reading');
const readingBody = (page: Page) => page.locator('#personal-reading-body');
const trigger = (page: Page) => page.getByRole('button', { name: 'Interpret my birth chart' });
const inspection = (page: Page) => page.locator('#inspection');

test.describe('U5A Personalized Natal Interpretation', () => {
  test('opens Personal Reading for the demo chart, cites verifiable facts, links to wheel/Inspector and updates Inspector "In this chart"', async ({ page }) => {
    await openApp(page);
    await expect(readingPanel(page)).toBeVisible();
    await expect(readingBody(page)).toBeHidden();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');

    await trigger(page).click();
    await expect(readingBody(page)).toBeVisible();
    await expect(page.locator('#reading-heading')).toBeFocused();

    // Demo-chart honesty notice
    await expect(readingBody(page)).toContainText('Greenwich demonstration chart');
    // Core sections & epistemic distinction
    await expect(readingBody(page)).toContainText('Capricorn Sun');
    await expect(readingBody(page)).toContainText('Scorpio Moon');
    await expect(readingBody(page)).toContainText('Core Trio, angles & chart ruler');
    await expect(readingBody(page)).toContainText('Major chart themes');
    await expect(readingBody(page)).toContainText('Element & modality balance');
    await expect(readingBody(page)).toContainText('traditional and modern symbolism');
    await expect(readingBody(page)).toContainText('not scientific measurement or guaranteed prediction');

    // Click a citation button inside the Personal Reading -> selects on wheel and updates Inspector
    await readingBody(page).getByRole('button', { name: /Inspect Natal Sun/i }).first().click();
    await expect(inspection(page).locator('.inspect-title')).toHaveText('Natal Sun');
    await expect(inspection(page).locator('.inspect-personal')).toBeVisible();
    await expect(inspection(page).locator('.inspect-personal')).toContainText('In this chart');
    await expect(inspection(page).locator('.inspect-personal')).toContainText('Capricorn');

    // Ascendant Inspector also shows "In this chart" + chart ruler context
    await readingBody(page).getByRole('button', { name: /Inspect ASC/i }).first().click();
    await expect(inspection(page).locator('.inspect-title')).toHaveText('Ascendant');
    await expect(inspection(page).locator('.inspect-personal')).toContainText('In this chart');
    await expect(inspection(page).locator('.inspect-personal')).toContainText('chart ruler');

    // Transit planet Inspector does NOT show natal "In this chart" block
    await page.getByRole('button', { name: 'Transit Sun', exact: true }).click();
    await expect(inspection(page).locator('.inspect-title')).toHaveText('Transit Sun');
    await expect(inspection(page).locator('.inspect-personal')).toHaveCount(0);

    // Hide reading returns focus to trigger
    await page.getByRole('button', { name: 'Hide reading' }).click();
    await expect(readingBody(page)).toBeHidden();
    await expect(trigger(page)).toBeVisible();
    await expect(trigger(page)).toBeFocused();
  });

  test('supports Whole Sign vs Placidus, missing coordinates, unknown birth time and saved-profile switching', async ({ page }) => {
    await openApp(page);
    await trigger(page).click();
    await expect(readingPanel(page)).toContainText('Whole Sign houses');

    // Switch to custom chart with Placidus houses and save as a profile
    await openBirth(page);
    await page.getByLabel('Birth date').fill('1990-07-15');
    await page.getByLabel('Local birth time').fill('18:30');
    await page.getByRole('button', { name: 'Use Calgary / Edmonton (Alberta)' }).click();
    await page.locator('#house-system').selectOption('Placidus');
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(readingPanel(page)).not.toContainText('Greenwich demonstration chart');
    await expect(readingPanel(page)).toContainText('Placidus houses');
    await expect(readingPanel(page)).toContainText('Cancer Sun');

    // Save this profile
    await page.getByRole('button', { name: 'Save as profile' }).click();
    await page.getByLabel('Name for this chart').fill('Alberta Placidus');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.locator('#birth-profile-status')).toContainText('Saved');
    await page.getByRole('button', { name: 'Close birth details' }).click();
    await expect(page.locator('#reading-subtitle')).toContainText('Alberta Placidus');

    // Missing coordinates -> omits houses/angles cleanly
    await openBirth(page);
    await page.getByLabel('Latitude').fill('');
    await page.getByLabel('Longitude').fill('');
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(readingPanel(page)).toContainText('No houses (coordinates needed)');
    await expect(readingPanel(page)).toContainText('Birthplace coordinates are not set');
    await expect(readingPanel(page)).not.toContainText('Chart ruler:');

    // Unknown birth time on equinox boundary day (2024-03-20 UTC)
    await openBirth(page);
    await page.getByLabel('Birth date').fill('2024-03-20');
    await page.getByLabel('Birth time unknown').check();
    await page.locator('#birth-zone').fill('UTC');
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(readingPanel(page)).toContainText('Date-only (birth time unknown)');
    await expect(readingPanel(page)).toContainText('Birth time is unknown');
    await expect(readingPanel(page)).toContainText('boundary day');

    // Switch back to saved profile -> restores full Placidus reading with profile name
    await page.getByRole('button', { name: 'Load profile' }).click();
    await expect(page.locator('#reading-subtitle')).toContainText('Alberta Placidus');
    await expect(readingPanel(page)).toContainText('Placidus houses');
    await expect(readingPanel(page)).toContainText('Cancer Sun');
  });

  test('integrates optional local natal symbolic synthesis in AI Export Studio with strict redaction', async ({ page }) => {
    await openApp(page);
    await openBirth(page);
    await page.getByLabel('Birth date').fill('1988-11-04');
    await page.getByLabel('Local birth time').fill('06:45');
    await page.getByRole('button', { name: 'Use Calgary / Edmonton (Alberta)' }).click();
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Save with an identifying name
    await page.getByRole('button', { name: 'Save as profile' }).click();
    await page.getByLabel('Name for this chart').fill('Private U5A Tester');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.locator('#birth-profile-status')).toContainText('Saved');
    await page.getByRole('button', { name: 'Close birth details' }).click();

    await goTo(page, 'export');
    const includeCheckbox = page.getByLabel('Include local natal symbolic synthesis');
    await expect(includeCheckbox).not.toBeChecked();
    await includeCheckbox.check();
    await expect(page.getByRole('radio', { name: 'Redacted', exact: true })).toBeChecked();

    await page.getByRole('button', { name: 'Prepare export' }).click();
    await expect(page.locator('#export-step-two')).toBeVisible();
    await expect(page.locator('#export-summary')).toContainText('symbolic notes');

    await page.getByRole('radio', { name: 'JSON', exact: true }).check();
    const jsonText = await page.getByLabel('Export preview').inputValue();
    for (const secret of ['Private U5A Tester', '1988-11-04', '06:45', '51.0447', '-114.0719', 'America/Edmonton']) {
      expect(jsonText).not.toContain(secret);
    }
    const parsed = JSON.parse(jsonText);
    expect(parsed.interpretations.length).toBeGreaterThan(5);
    expect(parsed.interpretations[0].factId).toBe('chart-1/overview');

    // Prompt presets work and preserve default
    await expect(page.locator('#interpretation-prompt')).toContainText('Do not invent planetary positions');
    await page.getByRole('radio', { name: 'Deeper natal reading', exact: true }).check();
    await expect(page.locator('#interpretation-prompt')).toContainText('personalized birth-chart synthesis');
  });

  test('renders cleanly on mobile (390px) with no horizontal overflow and accessible tap targets', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    const triggerBox = await trigger(page).boundingBox();
    expect(triggerBox!.height).toBeGreaterThanOrEqual(43);

    await trigger(page).click();
    await expect(readingBody(page)).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const citeBox = await readingBody(page).locator('.reading-cite').first().boundingBox();
    expect(citeBox!.height).toBeGreaterThanOrEqual(43);
  });
});
