import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { goTo, openApp, openBirth } from './helpers';

async function loadPlacidusCalgary(page: Page) {
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1987-03-14');
  await page.getByLabel('Local birth time', { exact: true }).fill('07:25');
  await page.locator('#birth-alberta').click();
  await page.locator('#birth-lat').fill('51.0447');
  await page.locator('#birth-lon').fill('-114.0719');
  await page.locator('#house-system').selectOption('Placidus');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test.describe('U6B-2 Interactive Research Workspace', () => {
  test('supports all 3 modes, simultaneous life themes, all 12 houses, broader context, score breakdown, and Time Machine jump', async ({ page }) => {
    await openApp(page, 'chart');
    await loadPlacidusCalgary(page);
    await goTo(page, 'events');

    await expect(page.locator('#research-chart-status')).toContainText('Placidus houses');
    await expect(page.getByRole('tab', { name: 'Explore Everything' })).toHaveAttribute('aria-selected', 'true');

    // Switch to Life Themes mode
    await page.getByRole('tab', { name: 'Life Themes' }).click();
    await expect(page.getByRole('tab', { name: 'Life Themes' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.research-house-grid .house-tile')).toHaveCount(12);
    await expect(page.locator('.research-theme-grid .theme-card')).toHaveCount(10);

    // Select simultaneous multi-area themes + exclude Moon for crisp 12-month focus
    await page.getByLabel('From (UTC midnight)', { exact: true }).fill('2026-01-01');
    await page.getByRole('button', { name: '12 months' }).click();
    await expect(page.getByLabel('To (UTC midnight)', { exact: true })).toHaveValue('2027-01-01');
    await page.getByLabel('Include fast Moon transits').uncheck();
    await expect(page.locator('#research-coverage-note')).toContainText('Moon excluded');

    await page.locator('.theme-card[data-theme-id="project-development"]').click();
    await page.locator('.theme-card[data-theme-id="finances"]').click();
    await page.locator('.theme-card[data-theme-id="emotional-growth"]').click();

    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-status')).toContainText(/Found \d+ events/, { timeout: 30_000 });

    // Relevant vs Broader context scope toggle works client-side without discarding events
    const scopeGroup = page.locator('#research-scope-group');
    await expect(scopeGroup).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Relevant/ })).toBeChecked();
    await expect(page.locator('.event-card .event-why').first()).toContainText('Why relevant:');
    await expect(page.locator('.event-card .chip-score').first()).toContainText(/Score \d+/);

    // Expand details on first card to inspect transparent additive score breakdown
    await page.locator('.event-card details').first().locator('summary').click();
    await expect(page.locator('.event-card details').first().locator('dl')).toContainText('Relevance tier');
    await expect(page.locator('.event-card details').first().locator('dl')).toContainText('pts (');

    // Switch to Broader context and verify events outside selected themes remain inspectable
    await page.getByRole('radio', { name: /^Broader context/ }).check();
    await expect(page.locator('.event-card .chip-tier-context').first()).toBeVisible();
    await page.getByRole('radio', { name: /^Relevant/ }).check();

    // Sort by relevance score
    await page.locator('#research-sort').selectOption('relevance');
    await expect(page.locator('.event-card').first()).toBeVisible();

    // Jump to Time Machine from an event card
    const firstJump = page.locator('.event-card .event-jump').first();
    await expect(firstJump).toBeVisible();
    await firstJump.click();
    await expect(page.locator('#view-chart')).toBeVisible();
    await expect(page.locator('#selected-epoch')).toContainText('2026-');
  });

  test('supports creating, editing, persisting, and resetting custom theme presets plus custom exclusions and session reuse', async ({ page }) => {
    await openApp(page, 'events');
    await page.getByRole('tab', { name: 'Life Themes' }).click();
    await page.getByLabel('From (UTC midnight)', { exact: true }).fill('2026-01-01');
    await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2026-04-01');
    await page.getByLabel('Include fast Moon transits').uncheck();

    // Create a custom theme preset and persist to localStorage
    await page.locator('.research-theme-editor summary').click();
    await page.getByLabel('Theme name').fill('Creative Launch');
    await page.getByLabel('Description (optional)').fill('Shipping original work.');
    await page.locator('.research-theme-editor fieldset').first().getByLabel('H5').check();
    await page.locator('.research-theme-editor fieldset').first().getByLabel('H10').check();
    await page.getByRole('button', { name: 'Save new preset' }).click();
    await expect(page.locator('.theme-card', { hasText: 'Creative Launch' })).toBeVisible();

    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-status')).toContainText(/Found \d+ events/, { timeout: 30_000 });

    // Switch to Custom Search and apply exclusion — reuses cached calculation instantaneously!
    await page.getByRole('tab', { name: 'Custom Search' }).click();
    await page.getByLabel('House 5 rule').selectOption('exclude');
    await expect(page.locator('#event-status')).toContainText('cached calculation');

    // Reload page and confirm custom preset survived in localStorage
    await page.reload();
    await page.getByRole('tab', { name: 'Life Themes' }).click();
    await expect(page.locator('.theme-card', { hasText: 'Creative Launch' })).toBeVisible();

    // Delete custom preset cleanly
    await page.locator('.research-theme-editor summary').click();
    await page.locator('#theme-editor-select').selectOption('custom-creative-launch');
    await page.getByRole('button', { name: 'Delete preset' }).click();
    await expect(page.locator('.theme-card', { hasText: 'Creative Launch' })).toHaveCount(0);
  });

  test('discloses missing coordinates and unknown birth time honestly and clears stale sessions on chart change', async ({ page }) => {
    await openApp(page, 'chart');
    await loadPlacidusCalgary(page);
    await goTo(page, 'events');
    await page.getByLabel('From (UTC midnight)', { exact: true }).fill('2026-01-01');
    await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2026-03-01');
    await page.getByLabel('Transiting planet').selectOption('mercury');
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-status')).toContainText(/Found \d+ events/, { timeout: 30_000 });

    // Edit chart to remove coordinates -> invalidates old session and disables houses honestly
    await goTo(page, 'chart');
    await openBirth(page);
    await page.locator('#birth-lat').fill('');
    await page.locator('#birth-lon').fill('');
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await goTo(page, 'events');
    await expect(page.locator('#event-results')).toBeEmpty();
    await expect(page.locator('#research-chart-status')).toContainText('Birthplace coordinates missing');
    await page.getByRole('tab', { name: 'Life Themes' }).click();
    await expect(page.locator('.research-house-grid input[type="checkbox"]').first()).toBeDisabled();

    // House-only query under missing coordinates degrades honestly to broader context
    await page.getByRole('tab', { name: 'Custom Search' }).click();
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-status')).toContainText(/Found \d+ events/, { timeout: 30_000 });

    // Edit chart to Unknown birth time -> invalidates session and shows stations-only disclosure
    await goTo(page, 'chart');
    await openBirth(page);
    await page.getByLabel('Birth time unknown').check();
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await goTo(page, 'events');
    await expect(page.locator('#event-results')).toBeEmpty();
    await expect(page.locator('#research-chart-status')).toContainText('Birth time unknown');
    await page.getByRole('tab', { name: 'Custom Search' }).click();
    await expect(page.locator('.custom-matrix-item select').first()).toBeDisabled();
  });

  test('renders cleanly at 390px phone width without horizontal overflow across modes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, 'events');
    for (const tab of ['Explore Everything', 'Life Themes', 'Custom Search']) {
      await page.getByRole('tab', { name: tab }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, tab).toBeLessThanOrEqual(0);
    }
  });

  test('planet selector never reads "All planets" for a subset, and keeps the 10-year limit consistent', async ({ page }) => {
    await openApp(page, 'events');
    const body = page.locator('#event-body');
    await body.selectOption('mars');
    await page.getByLabel('Include fast Moon transits').check();
    await expect(body).not.toHaveValue('all');
    await expect(body.locator('option:checked')).toContainText('Custom selection (2 planets)');
    await expect(page.locator('#research-coverage-note')).toContainText('Planets: ');

    // Mars + Moon is slow-planet-free, so only the general 5-year limit applies.
    await page.getByLabel('From (UTC midnight)', { exact: true }).fill('2026-01-01');
    await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2036-01-01');
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-status')).toContainText(/supports at most/i);

    // Selecting every planet again reads "All planets".
    await body.selectOption('all');
    await expect(body.locator('option:checked')).toHaveText('All planets');
    await expect(page.getByLabel('Include fast Moon transits')).toBeChecked();
  });

  test('presents each axis contact once and Moon-off reuse hides Moon events and counts', async ({ page }) => {
    await openApp(page, 'chart');
    await loadPlacidusCalgary(page);
    await goTo(page, 'events');
    await page.getByLabel('From (UTC midnight)', { exact: true }).fill('2026-01-01');
    await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2026-03-01');
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-status')).toContainText(/Found \d+ events/, { timeout: 60_000 });

    // B2: opposite-angle windows are folded into one card ("Same contact"), never listed twice.
    await expect(page.locator('#event-status')).toContainText('shown with the contact they share');
    await expect(page.locator('#event-results .event-axis-companion').first()).toContainText('Same contact:');
    const angleTitles = await page.locator('#event-results .event-card:has(.chip-angle) .event-title').allInnerTexts();
    expect(angleTitles.length).toBeGreaterThan(0);

    const moonCards = page.locator('#event-results .event-card', { hasText: /Transit Moon/ });
    await expect(moonCards.first()).toBeVisible();
    const withMoonStatus = await page.locator('#event-status').innerText();

    // B3: unticking Moon reuses the calculation yet removes every Moon event from results and counts.
    await page.getByLabel('Include fast Moon transits').uncheck();
    await expect(page.locator('#event-status')).toContainText('cached calculation');
    await expect(page.locator('#event-status')).toContainText('not shown');
    await expect(page.locator('#event-status')).not.toHaveText(withMoonStatus);
    await expect(moonCards).toHaveCount(0);
    await expect(page.locator('#research-moon-filter-wrap')).toBeHidden();
    await expect(page.locator('#event-stale')).toBeHidden();

    // The superset still covers Moon, so ticking it back on reuses the same calculation and restores the Moon events.
    await page.getByLabel('Include fast Moon transits').check();
    await expect(page.locator('#event-status')).toContainText('cached calculation');
    await expect(moonCards.first()).toBeVisible();

    // A Moon-off calculation cannot be widened: ticking Moon on marks the results outdated until searched again.
    await page.getByLabel('Include fast Moon transits').uncheck();
    await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2026-03-15');
    await expect(page.locator('#event-stale')).toBeVisible();
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-stale')).toBeHidden({ timeout: 60_000 });
    await expect(moonCards).toHaveCount(0);
    await page.getByLabel('Include fast Moon transits').check();
    await expect(page.locator('#event-stale')).toBeVisible();
    await expect(page.locator('#event-results')).toHaveAttribute('data-stale', 'true');
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-stale')).toBeHidden({ timeout: 60_000 });
    await expect(moonCards.first()).toBeVisible();
  });

  test('theme changes after a Time Machine jump update results from the cached calculation; changed dates mark results outdated', async ({ page }) => {
    await openApp(page, 'chart');
    await loadPlacidusCalgary(page);
    await goTo(page, 'events');
    await page.getByLabel('From (UTC midnight)', { exact: true }).fill('2026-01-01');
    await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2026-07-01');
    await page.getByLabel('Include fast Moon transits').uncheck();
    await page.getByRole('tab', { name: 'Life Themes' }).click();
    await page.locator('.theme-card[data-theme-id="finances"]').click();
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-status')).toContainText(/Found \d+ events/, { timeout: 60_000 });
    const before = await page.locator('#event-summary').innerText();

    await page.locator('#event-results .event-card .event-jump').first().click();
    await expect(page.locator('#view-chart')).toBeVisible();
    await goTo(page, 'events');

    await page.locator('#research-configuration > summary').click();
    await page.locator('.theme-card[data-theme-id="entrepreneurship"]').click();
    await expect(page.locator('#event-status')).toContainText('cached calculation');
    await expect(page.locator('#event-summary')).not.toHaveText(before);
    await expect(page.locator('#event-stale')).toBeHidden();

    // I2: a change that needs new astronomy marks the displayed results as outdated.
    await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2026-09-01');
    await expect(page.locator('#event-stale')).toBeVisible();
    await expect(page.locator('#event-results')).toHaveAttribute('data-stale', 'true');
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-stale')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('#event-results')).not.toHaveAttribute('data-stale', 'true');
  });
});
