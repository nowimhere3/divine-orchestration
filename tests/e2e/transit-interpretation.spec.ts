import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { goTo, openApp, openBirth } from './helpers';

const readingPanel = (page: Page) => page.locator('#personal-reading');
const readingBody = (page: Page) => page.locator('#personal-reading-body');
const transitTrigger = (page: Page) => page.getByRole('button', { name: 'Interpret my transits' });
const natalTrigger = (page: Page) => page.getByRole('button', { name: 'Interpret my birth chart' });
const inspection = (page: Page) => page.locator('#inspection');

test.describe('U5B Personalized Transit Interpretation & Time Machine Integration', () => {
  test('opens Personal Transit Reading, links wheel/Inspector with "In these transits", enriches exact passes and supports "Jump to exact pass"', async ({ page }) => {
    await openApp(page);
    await expect(transitTrigger(page)).toBeVisible();
    await expect(transitTrigger(page)).toHaveAttribute('aria-expanded', 'false');

    await transitTrigger(page).click();
    await expect(readingBody(page)).toBeVisible();
    await expect(page.locator('#reading-heading')).toHaveText('Personal transit reading');
    await expect(page.locator('#reading-heading')).toBeFocused();

    // Demo honesty banner, epistemic separation, Lunar tie-in & Learn links
    await expect(readingBody(page)).toContainText('Greenwich demonstration chart');
    await expect(readingBody(page)).toContainText('not scientific measurement or guaranteed prediction');
    await expect(readingBody(page)).toContainText('Lunar Observatory ·');
    await expect(readingBody(page)).toContainText('Learn concepts:');

    // Wait for Tier-2 async worker enrichment to complete
    await expect(readingBody(page)).toContainText('Exact passes ready', { timeout: 15_000 });

    // Select a transiting planet via a citation -> Inspector shows "In these transits" (.inspect-transit-personal)
    // and keeps natal .inspect-personal absent
    await page.getByRole('button', { name: 'Transit Sun', exact: true }).click();
    await expect(inspection(page).locator('.inspect-title')).toHaveText('Transit Sun');
    await expect(inspection(page).locator('.inspect-transit-personal')).toBeVisible();
    await expect(inspection(page).locator('.inspect-transit-personal')).toContainText('In these transits');
    await expect(inspection(page).locator('.inspect-personal')).toHaveCount(0);

    // Jump to an exact pass and verify WCAG 2.5.3 accessible-name compliance,
    // Time Machine #selected-epoch movement, and keyboard focus preservation across re-renders
    const jumpButtons = readingBody(page).locator('.transit-jump-btn');
    const jumpCount = await jumpButtons.count();
    expect(jumpCount).toBeGreaterThan(0);

    // WCAG 2.5.3: every "Jump to exact pass" button's accessible name must begin with its visible text
    for (let i = 0; i < Math.min(jumpCount, 12); i++) {
      const btn = jumpButtons.nth(i);
      const visible = (await btn.textContent())?.trim();
      const aria = await btn.getAttribute('aria-label');
      expect(visible).toBe('Jump to exact pass');
      expect(aria).toBeTruthy();
      expect(aria!.startsWith('Jump to exact pass')).toBe(true);
    }

    const beforeEpoch = await page.locator('#selected-epoch').textContent();
    const firstJump = jumpButtons.first();
    const targetEpochMs = Number(await firstJump.getAttribute('data-jump-epoch-ms'));
    expect(Number.isFinite(targetEpochMs)).toBe(true);

    // Activate via keyboard and verify focus does NOT drop to document.body after Tier-1 or Tier-2 re-renders
    await firstJump.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#selected-epoch')).not.toHaveText(beforeEpoch ?? '', { timeout: 10_000 });
    const focusAfterTier1 = await page.evaluate(() => {
      const el = document.activeElement;
      const panel = document.getElementById('personal-reading');
      return Boolean(el && el !== document.body && panel?.contains(el));
    });
    expect(focusAfterTier1).toBe(true);

    await expect(readingBody(page)).toContainText('Exact passes ready', { timeout: 15_000 });
    const focusAfterTier2 = await page.evaluate(() => {
      const el = document.activeElement;
      const panel = document.getElementById('personal-reading');
      return Boolean(el && el !== document.body && panel?.contains(el));
    });
    expect(focusAfterTier2).toBe(true);

    // Switch seamlessly between Transit Reading and Natal Reading, then hide and confirm focus returns
    await natalTrigger(page).click();
    await expect(page.locator('#reading-heading')).toHaveText('Personal birth-chart reading');
    await transitTrigger(page).click();
    await expect(page.locator('#reading-heading')).toHaveText('Personal transit reading');

    await page.getByRole('button', { name: 'Hide reading' }).click();
    await expect(readingBody(page)).toBeHidden();
    await expect(transitTrigger(page)).toBeFocused();
  });

  test('updates transit interpretation live with Time Machine changes, handles rapid scrubbing without stale results, and respects Alberta Time / UTC / IANA zones', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await openApp(page);
    await transitTrigger(page).click();
    await expect(readingBody(page)).toBeVisible();

    // Rapidly jump through several Time Machine dates -> must settle cleanly on the final date (2026-11-20)
    const dateInput = page.locator('#transit-date');
    for (const day of ['2025-02-10', '2025-08-15', '2026-04-01', '2026-11-20']) {
      await dateInput.fill(day);
      await dateInput.dispatchEvent('change');
    }

    // Immediate Tier-1 sync update reflects 2026-11-20
    await expect(page.locator('#reading-subtitle')).toContainText('2026-11-20');
    // Wait for Tier-2 enrichment to settle cleanly on the final date
    await expect(readingBody(page)).toContainText('Exact passes ready', { timeout: 15_000 });
    await expect(page.locator('#reading-subtitle')).toContainText('2026-11-20');

    // Step forward with Time Machine Next day button -> updates reading moment immediately
    const subtitleBeforeStep = await page.locator('#reading-subtitle').textContent();
    await page.locator('#next-day').click();
    await expect(page.locator('#reading-subtitle')).not.toHaveText(subtitleBeforeStep ?? '');

    // Switch back to 2026-11-20 and test display timezone formatting: Alberta Time (ABT) vs UTC vs Asia/Tokyo
    await dateInput.fill('2026-11-20');
    await dateInput.dispatchEvent('change');
    await expect(readingBody(page)).toContainText('Exact passes ready', { timeout: 15_000 });

    const zoneSelect = page.locator('#display-zone');
    await zoneSelect.selectOption('alberta');
    await expect(page.locator('#reading-subtitle')).toContainText('ABT');

    await zoneSelect.selectOption('utc');
    await expect(page.locator('#reading-subtitle')).toContainText('UTC');

    await zoneSelect.selectOption('named');
    const namedInput = page.locator('#named-zone');
    await namedInput.fill('Asia/Tokyo');
    await namedInput.dispatchEvent('change');
    await expect(page.locator('#reading-subtitle')).toContainText('Asia/Tokyo (UTC+09:00)');
    await expect(page.locator('#reading-subtitle')).not.toContainText('ABT');

    expect(errors).toEqual([]);
  });

  test('handles missing coordinates and unknown birth time honestly in Transit Reading', async ({ page }) => {
    await openApp(page);
    await transitTrigger(page).click();
    await expect(readingBody(page)).toBeVisible();

    // Missing coordinates -> omits houses and angles honestly
    await openBirth(page);
    await page.getByLabel('Birth date').fill('1990-07-15');
    await page.getByLabel('Local birth time').fill('18:30');
    await page.getByLabel('Latitude').fill('');
    await page.getByLabel('Longitude').fill('');
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(readingPanel(page)).toContainText('Birthplace coordinates are not set');
    await expect(readingBody(page)).not.toContainText('Transiting planets through your');

    // Unknown birth time -> date-only mode, omits houses/angles/Moon targets/exact passes
    await openBirth(page);
    await page.getByLabel('Birth date').fill('1990-07-15');
    await page.getByLabel('Birth time unknown').check();
    await page.locator('#birth-zone').fill('UTC');
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(readingPanel(page)).toContainText('Date-only transit scope (birth time unknown)');
    await expect(readingBody(page)).toContainText('Birth time is unknown');
    await expect(readingBody(page).locator('.transit-jump-btn')).toHaveCount(0);
  });

  test('integrates opt-in local transit symbolic synthesis in AI Export Studio with strict redaction and prompt preset', async ({ page }) => {
    await openApp(page);
    await openBirth(page);
    await page.getByLabel('Birth date').fill('1988-11-04');
    await page.getByLabel('Local birth time').fill('06:45');
    await page.getByRole('button', { name: 'Use Calgary / Edmonton (Alberta)' }).click();
    await page.getByRole('button', { name: 'Calculate natal chart' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Save with an identifying name
    await page.getByRole('button', { name: 'Save as profile' }).click();
    await page.getByLabel('Name for this chart').fill('Private U5B Tester');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.locator('#birth-profile-status')).toContainText('Saved');
    await page.getByRole('button', { name: 'Close birth details' }).click();

    await goTo(page, 'export');
    const includeTransits = page.getByLabel('Include local transit symbolic synthesis');
    await expect(includeTransits).not.toBeChecked();
    await includeTransits.check();
    await expect(page.getByRole('radio', { name: 'Redacted', exact: true })).toBeChecked();

    await page.getByRole('button', { name: 'Prepare export' }).click();
    await expect(page.locator('#export-step-two')).toBeVisible();
    await expect(page.locator('#export-summary')).toContainText('symbolic notes');

    await page.getByRole('radio', { name: 'JSON', exact: true }).check();
    const jsonText = await page.getByLabel('Export preview').inputValue();
    for (const secret of ['Private U5B Tester', '1988-11-04', '06:45', '51.0447', '-114.0719', 'America/Edmonton', 'ABT']) {
      expect(jsonText).not.toContain(secret);
    }
    const parsed = JSON.parse(jsonText);
    expect(parsed.interpretations.length).toBeGreaterThan(0);
    expect(parsed.interpretations.some((item: { factId: string }) => item.factId === 'chart-2/transit-overview')).toBe(true);

    // Markdown export has matching privacy protection
    await page.getByRole('radio', { name: 'Markdown', exact: true }).check();
    const mdText = await page.getByLabel('Export preview').inputValue();
    for (const secret of ['Private U5B Tester', '1988-11-04', '06:45', '51.0447', '-114.0719', 'America/Edmonton', 'ABT']) {
      expect(mdText).not.toContain(secret);
    }
    expect(mdText).toContain('chart-2/transit-overview');

    // Deeper transit reading prompt preset
    await page.getByRole('radio', { name: 'Deeper transit reading', exact: true }).check();
    await expect(page.locator('#interpretation-prompt')).toContainText('personalized transit reflection');
  });

  test('renders cleanly on mobile (390px and 320px) with zero horizontal overflow and accessible tap targets', async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await openApp(page);

      const triggerBox = await transitTrigger(page).boundingBox();
      expect(triggerBox!.height).toBeGreaterThanOrEqual(43);

      await transitTrigger(page).click();
      await expect(readingBody(page)).toBeVisible();
      await expect(readingBody(page)).toContainText('Exact passes ready', { timeout: 15_000 });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `Horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

      const jumpBtn = readingBody(page).locator('.transit-jump-btn').first();
      if (await jumpBtn.count()) {
        const jumpBox = await jumpBtn.boundingBox();
        expect(jumpBox!.height).toBeGreaterThanOrEqual(43);
      }
    }
  });
});
