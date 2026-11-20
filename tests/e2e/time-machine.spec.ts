import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

const epoch = (page: Parameters<typeof openApp>[0]) => page.locator('#selected-epoch');

test('shows one UTC-consistent instant in every control', async ({ page }) => {
  await openApp(page);
  await expect(epoch(page)).toHaveText(/^\d{4}-\d\d-\d\d · \d\d:\d\d UTC$/);
  const time = page.getByLabel('Transit time (UTC)');
  await expect(time).toHaveValue(/^([01]\d|2[0-3]):[0-5]\d$/);
  await expect(page.locator('.time-clock abbr')).toHaveText('UTC');
  const [date, clock] = await Promise.all([
    page.getByLabel('Transit date', { exact: true }).inputValue(), time.inputValue(),
  ]);
  await expect(epoch(page)).toHaveText(`${date} · ${clock} UTC`);
  // "Now" is the current UTC minute, not local time.
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  const utc = await page.evaluate(() => new Date().toISOString());
  const shown = await time.inputValue();
  const apart = Math.abs(Date.parse(`1970-01-01T${shown}:00Z`) - Date.parse(`1970-01-01T${utc.slice(11, 16)}:00Z`));
  expect(Math.min(apart, 86_400_000 - apart)).toBeLessThanOrEqual(120_000);
  await expect(page.getByLabel('Transit date', { exact: true })).toHaveValue(utc.slice(0, 10));
  await expect(page.locator('#time-relative')).toHaveText('Right now');
});

test('steps by hour, day and week and relabels the step buttons', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Transit date', { exact: true }).fill('2024-04-15');
  await page.getByLabel('Transit time (UTC)').fill('23:30');
  await expect(epoch(page)).toHaveText('2024-04-15 · 23:30 UTC');
  const steps = page.getByRole('group', { name: 'Step size' });
  await expect(steps.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(epoch(page)).toHaveText('2024-04-16 · 23:30 UTC');
  await steps.getByRole('button', { name: 'Hour' }).click();
  await expect(steps.getByRole('button', { name: 'Hour' })).toHaveAttribute('aria-pressed', 'true');
  await expect(steps.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'false');
  // An hour step crosses midnight and carries the date with it.
  await page.getByRole('button', { name: 'Next hour' }).click();
  await expect(epoch(page)).toHaveText('2024-04-17 · 00:30 UTC');
  await page.getByRole('button', { name: 'Previous hour' }).click();
  await page.getByRole('button', { name: 'Previous hour' }).click();
  await expect(epoch(page)).toHaveText('2024-04-16 · 22:30 UTC');
  await steps.getByRole('button', { name: 'Week' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(epoch(page)).toHaveText('2024-04-23 · 22:30 UTC');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(epoch(page)).toHaveText('2024-04-09 · 22:30 UTC');
  // The chart follows every kind of step.
  await expect(page.getByRole('slider', { name: /Scrub by day/ })).toHaveAttribute('aria-valuetext', '2024-04-09 22:30 UTC');
});

test('hour stepping updates positions and keeps the date at the supported limits', async ({ page }) => {
  await openApp(page);
  await page.getByRole('group', { name: 'Step size' }).getByRole('button', { name: 'Hour' }).click();
  await page.getByRole('button', { name: 'Transit', exact: true }).click();
  await page.getByLabel('Transit date', { exact: true }).fill('2024-04-15');
  await page.getByLabel('Transit time (UTC)').fill('12:00');
  const moon = page.getByRole('table', { name: 'Transit planetary positions' }).getByRole('row', { name: /Moon/ });
  const noon = await moon.innerText();
  await page.getByRole('button', { name: 'Next hour' }).click();
  await expect(epoch(page)).toHaveText('2024-04-15 · 13:00 UTC');
  await expect(moon).not.toHaveText(noon);

  await page.getByLabel('Transit date', { exact: true }).fill('1550-01-01');
  await page.getByLabel('Transit time (UTC)').fill('00:00');
  await expect(page.getByRole('button', { name: 'Previous hour' })).toBeDisabled();
  await page.getByLabel('Transit date', { exact: true }).fill('2650-01-03');
  await page.getByLabel('Transit time (UTC)').fill('23:59');
  await expect(page.getByRole('button', { name: 'Next hour' })).toBeDisabled();
  await expect(epoch(page)).toContainText('2650-01-03 · 23:59 UTC');
});

test('rejects a malformed UTC time and restores the last valid instant', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Transit date', { exact: true }).fill('2024-04-15');
  const time = page.getByLabel('Transit time (UTC)');
  await time.fill('09:15');
  await expect(epoch(page)).toHaveText('2024-04-15 · 09:15 UTC');
  await time.fill('25:61');
  await time.blur();
  await expect(page.locator('#transit-status')).toContainText('24-hour clock');
  await expect(time).toHaveValue('09:15');
  await expect(epoch(page)).toHaveText('2024-04-15 · 09:15 UTC');
});

test('the scrub track marks today, describes the selection in words and is keyboard operable', async ({ page }) => {
  await openApp(page);
  const marker = page.locator('#now-marker');
  await expect(marker).toBeVisible();
  const position = await marker.evaluate(node => Number(getComputedStyle(node).getPropertyValue('--pos')));
  expect(position).toBeGreaterThan(0.45);
  expect(position).toBeLessThan(0.55);
  await expect(page.locator('#time-relative')).toHaveText('Right now');

  const slider = page.getByRole('slider', { name: /Scrub by day/ });
  const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  await slider.focus();
  for (let i = 0; i < 3; i++) await slider.press('ArrowRight');
  await expect(page.locator('#time-relative')).toHaveText(/^in [23] days$/);
  await expect(page.getByLabel('Transit date', { exact: true })).not.toHaveValue(today);
  await slider.press('Home');
  await expect(page.locator('#time-relative')).toHaveText(/ago$/);
  // Moving far away drops the marker because today is outside the 180-day window.
  await page.getByLabel('Transit date', { exact: true }).fill('2031-06-01');
  await expect(marker).toBeHidden();
  await expect(page.locator('#time-relative')).toHaveText(/years?$/);
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(marker).toBeVisible();
});

test('a phone keeps stepping and Now on the first screen, above the tab bar, with or without a selection', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Phone emulation is exercised in Chromium.');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await openApp(page);
    const wheel = await page.locator('#wheel svg').boundingBox();
    expect(wheel!.y).toBeLessThan(260);
    expect(wheel!.width).toBeGreaterThan(330);
    // The zoom controls sit on the wheel's corners, so the dock needs no scrolling to reach.
    const tools = await page.getByRole('group', { name: 'Wheel zoom' }).boundingBox();
    expect(tools!.y).toBeGreaterThanOrEqual(wheel!.y - 1);
    expect(tools!.y + tools!.height).toBeLessThanOrEqual(wheel!.y + wheel!.height + 1);
    const tabs = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
    for (const control of [
      page.getByRole('button', { name: 'Previous day' }), page.getByRole('button', { name: 'Next day' }),
      page.getByRole('group', { name: 'Step size' }), page.getByRole('button', { name: 'Now', exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box!.y + box!.height).toBeLessThan(tabs!.y);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    for (const name of ['Previous day', 'Next day']) {
      expect((await page.getByRole('button', { name }).boundingBox())!.width).toBeGreaterThanOrEqual(44);
    }
    // A selected planet adds an in-flow summary row; the dock must still be on the first screen and uncovered.
    // Tap by coordinates: Playwright's own tap would scroll the page first and hide the very thing being tested.
    const pick = (await page.getByRole('button', { name: 'Select Natal Sun' }).boundingBox())!;
    await page.touchscreen.tap(pick.x + pick.width / 2, pick.y + pick.height / 2);
    await expect(page.locator('#selection-bar')).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBeLessThan(5);
    const bar = (await page.locator('#selection-bar').boundingBox())!;
    expect(await page.locator('#selection-bar').evaluate(node => getComputedStyle(node).position)).not.toBe('fixed');
    for (const control of [page.getByRole('button', { name: 'Previous day' }), page.getByRole('button', { name: 'Next day' }), page.getByRole('button', { name: 'Now', exact: true })]) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
      expect(box.y + box.height).toBeLessThan(tabs!.y);
    }
    await page.getByRole('group', { name: 'Step size' }).getByRole('button', { name: 'Hour' }).tap();
    const before = await epoch(page).innerText();
    await page.getByRole('button', { name: 'Next hour' }).tap();
    await expect(epoch(page)).not.toHaveText(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  } finally {
    await context.close();
  }
});
