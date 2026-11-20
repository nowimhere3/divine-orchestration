import { expect, test } from '@playwright/test';
import { goTo, openApp, openBirth } from './helpers';

const views = ['chart', 'events', 'library', 'export', 'learn'] as const;

test('shows one view at a time and marks the current navigation link', async ({ page }) => {
  await openApp(page);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link')).toHaveText(['Chart', 'Events', 'Library', 'Export', 'Learn']);
  for (const view of views) {
    await goTo(page, view);
    for (const other of views) {
      await expect(page.locator(`#view-${other}`)).toBeVisible({ visible: other === view });
    }
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.locator(`[data-nav="${view}"]`)).toHaveAttribute('aria-current', 'page');
  }
  await expect(page).toHaveTitle('Learn · Divine Orchestration');
  await goTo(page, 'chart');
  await expect(page).toHaveTitle('Divine Orchestration');
});

test('moves keyboard focus to the new view heading and supports back and forward', async ({ page }) => {
  await openApp(page);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Events' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Planetary events', level: 2 })).toBeFocused();
  await goTo(page, 'library');
  await page.goBack();
  await expect(page.locator('#view-events')).toBeVisible();
  await expect(page.locator('#view-library')).toBeHidden();
  await page.goForward();
  await expect(page.locator('#view-library')).toBeVisible();
});

test('skip link focuses the content without changing the current view', async ({ page }) => {
  await page.goto('/#library');
  await expect(page.getByRole('button', { name: 'Save current chart' })).toBeEnabled();
  // WebKit does not Tab to links by default, so focus the link directly.
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.locator('#view-library')).toBeVisible();
  await expect(page).toHaveURL(/#library$/);
});

test('opens the requested view from a hash link and falls back to the chart for unknown hashes', async ({ page }) => {
  await page.goto('/#library');
  await expect(page.locator('#view-library')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save current chart' })).toBeEnabled();
  await page.goto('/#nonsense');
  await expect(page.locator('#view-chart')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Natal Sun', exact: true })).toBeVisible();
  await page.goto('/#export');
  await page.reload();
  await expect(page.locator('#view-export')).toBeVisible();
  // The engine finishes loading while a non-chart view is open.
  await expect(page.getByRole('button', { name: 'Prepare export' })).toBeEnabled();
  await goTo(page, 'chart');
  await expect(page.locator('#wheel [data-layer="natal"]')).toHaveCount(10);
});

test('preserves chart, Time Machine, events, export and form state across views', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Transit date', { exact: true }).fill('2024-04-15');
  await expect(page.locator('#selected-epoch')).toContainText('2024-04-15');
  const sun = page.getByRole('button', { name: 'Natal Sun', exact: true });
  await sun.click();
  await expect(page.locator('#inspection')).toContainText('Natal Sun');
  await page.getByRole('button', { name: 'Houses & angles' }).click();
  const wheelHtml = await page.locator('#wheel').innerHTML();

  await goTo(page, 'events');
  await page.getByLabel('From (UTC midnight)', { exact: true }).fill('2024-03-20');
  await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2024-04-30');
  await page.getByLabel('Transiting planet').selectOption('mercury');
  await page.getByRole('button', { name: 'Search events' }).click();
  await expect(page.locator('#event-status')).toContainText(/Found \d+ events/);
  const results = await page.locator('#event-results').textContent();

  await goTo(page, 'library');
  await page.getByLabel('Profile name').fill('Kept name');
  await goTo(page, 'export');
  await page.getByRole('radio', { name: 'Full', exact: true }).check();
  await page.getByRole('button', { name: 'Prepare export' }).click();
  await expect(page.locator('#export-status')).toContainText('Preview ready');
  const preview = await page.getByLabel('Export preview').inputValue();
  expect(preview).toContain('2024-04-15');

  await goTo(page, 'chart');
  await expect(page.locator('#selected-epoch')).toContainText('2024-04-15');
  await expect(page.getByLabel('Transit date', { exact: true })).toHaveValue('2024-04-15');
  await expect(sun).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#inspection')).toContainText('Natal Sun');
  await expect(page.getByRole('button', { name: 'Houses & angles' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#wheel').innerHTML()).toBe(wheelHtml);

  await goTo(page, 'events');
  expect(await page.locator('#event-results').textContent()).toBe(results);
  await expect(page.getByLabel('Transiting planet')).toHaveValue('mercury');
  await goTo(page, 'library');
  await expect(page.getByLabel('Profile name')).toHaveValue('Kept name');
  await goTo(page, 'export');
  await expect(page.getByLabel('Export preview')).toHaveValue(preview);
  await expect(page.locator('#export-privacy-full')).toBeChecked();
  await expect(page.locator('#export-step-two')).toBeVisible();
});

test('keeps birth details in a dialog that edits the active chart', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByLabel('Birth date', { exact: true })).toBeHidden();
  const edit = page.getByRole('button', { name: 'Edit birth details' });
  await openBirth(page);
  await expect(page.getByLabel('Birth date', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(edit).toBeFocused();

  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1985-07-20');
  await page.getByLabel('Birth time unknown').check();
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#wheel-caption')).toContainText('Transit only');
  await expect(page.locator('#chart-notice')).not.toBeEmpty();
  await goTo(page, 'events');
  await goTo(page, 'chart');
  await expect(page.locator('#wheel-caption')).toContainText('Transit only');
  await openBirth(page);
  await expect(page.getByLabel('Birth date', { exact: true })).toHaveValue('1985-07-20');
  await expect(page.getByLabel('Birth time unknown')).toBeChecked();
});

test('lays out the shell without overflow and with a bottom tab bar on a phone', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Phone emulation is exercised in Chromium.');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await openApp(page);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const box = await nav.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(844 - 2);
    expect(box!.height).toBeLessThan(110);
    for (const view of views) {
      await nav.locator(`[data-nav="${view}"]`).tap();
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      const target = await nav.locator(`[data-nav="${view}"]`).boundingBox();
      expect(target!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    }
    await nav.locator('[data-nav="chart"]').tap();
    // The wheel is the first substantial content and fits the phone width.
    await expect(page.locator('#wheel svg')).toBeVisible();
    const wheel = await page.locator('#wheel svg').boundingBox();
    expect(wheel!.width).toBeGreaterThan(300);
    expect(wheel!.y).toBeLessThan(400);
  } finally {
    await context.close();
  }
});
