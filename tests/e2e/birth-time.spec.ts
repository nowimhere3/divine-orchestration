import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeBirth, goTo, openApp, openBirth } from './helpers';

const time = (page: Page) => page.getByLabel('Local birth time');
const error = (page: Page) => page.locator('#birth-time-error');
const notice = (page: Page) => page.locator('#chart-notice');

async function enter(page: Page, value: string, date = '1990-05-15') {
  await page.getByLabel('Birth date').fill(date);
  await time(page).fill(value);
  await page.getByLabel('Time zone', { exact: true }).fill('America/Edmonton');
  await page.getByLabel('Latitude').fill('53.5461');
  await page.getByLabel('Longitude').fill('-113.4938');
}

async function calculate(page: Page) {
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
}

for (const typed of ['2:00', '02:00', '14:00', '9:30', '02:00:30']) {
  test(`accepts the local birth time ${typed}`, async ({ page }) => {
    await openApp(page);
    await openBirth(page);
    await enter(page, typed);
    await calculate(page);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(error(page)).toBeHidden();
    await expect(notice(page)).toHaveAttribute('data-state', 'custom');
    const [hour, rest] = typed.split(/:(.*)/);
    await expect(notice(page)).toContainText(`1990-05-15 ${hour.padStart(2, '0')}:${rest}`);
    await expect(notice(page)).toContainText('America/Edmonton');
    await expect(notice(page)).toContainText('53.55°N 113.49°W');
  });
}

for (const bad of ['25:00', '2:60', '2:00 PM', '2pm', 'noon', '2', '12:5']) {
  test(`rejects "${bad}" beside the field, focuses it and keeps the dialog open`, async ({ page }) => {
    await openApp(page);
    await openBirth(page);
    await enter(page, bad);
    await calculate(page);
    await expect(page.getByRole('dialog', { name: 'Birth details' })).toBeVisible();
    await expect(error(page)).toBeVisible();
    await expect(error(page)).toContainText('24-hour');
    await expect(error(page)).toContainText(bad);
    await expect(time(page)).toBeFocused();
    await expect(time(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(time(page)).toHaveAccessibleDescription(/24-hour/);
    // The Greenwich demonstration chart is still the active chart, and says so.
    await expect(notice(page)).toHaveAttribute('data-state', 'pending');
    await expect(notice(page)).toContainText('not been calculated');
    await expect(notice(page)).toContainText('Greenwich');
    // The error is the field's own and sits directly under it, not just below the button.
    const field = (await time(page).boundingBox())!;
    const message = (await error(page).boundingBox())!;
    const button = (await page.getByRole('button', { name: 'Calculate natal chart' }).boundingBox())!;
    expect(message.y).toBeGreaterThan(field.y);
    expect(message.y).toBeLessThan(button.y);
  });
}

test('the error clears as soon as the time is corrected, and the corrected time calculates', async ({ page }) => {
  await openApp(page);
  await openBirth(page);
  await enter(page, '2:00 PM');
  await calculate(page);
  await expect(error(page)).toBeVisible();
  await time(page).fill('14:00');
  await expect(error(page)).toBeHidden();
  await expect(time(page)).not.toHaveAttribute('aria-invalid', 'true');
  await calculate(page);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(notice(page)).toHaveAttribute('data-state', 'custom');
  await expect(notice(page)).toContainText('1990-05-15 14:00');
});

test('a failed calculation leaves the demonstration chart marked, and closing the dialog keeps the warning', async ({ page }) => {
  await openApp(page);
  await expect(notice(page)).toHaveAttribute('data-state', 'demo');
  await expect(notice(page)).toContainText('Greenwich demo');
  await openBirth(page);
  await enter(page, '99:99');
  await calculate(page);
  await closeBirth(page);
  await expect(notice(page)).toHaveAttribute('data-state', 'pending');
  await expect(notice(page)).toContainText('Not applied');
  await expect(page.locator('#wheel-caption')).toContainText('2000-01-01');
});

test('export is blocked while new birth details are uncalculated, and exports the new chart after correction', async ({ page }) => {
  await openApp(page);
  await openBirth(page);
  await enter(page, '2:00 PM');
  await calculate(page);
  await closeBirth(page);

  await goTo(page, 'export');
  const source = page.locator('#export-source');
  await expect(source).toHaveAttribute('data-state', 'pending');
  await expect(source).toContainText('Export is blocked');
  await expect(source).toContainText('Greenwich');
  await page.getByRole('radio', { name: 'Full', exact: true }).check();
  await page.getByRole('button', { name: 'Prepare export' }).click();
  await expect(page.locator('#export-status')).toContainText('blocked');
  await expect(page.locator('#export-form')).toBeVisible();
  await expect(page.locator('#export-step-two')).toBeHidden();

  // Correct it, calculate, and export the chart that was actually entered.
  await goTo(page, 'chart');
  await openBirth(page);
  await time(page).fill('2:00');
  await calculate(page);
  await expect(page.getByRole('dialog')).toBeHidden();
  await goTo(page, 'export');
  await expect(source).toHaveAttribute('data-state', 'custom');
  await expect(source).toContainText('1990-05-15 02:00');
  await page.getByRole('radio', { name: 'Full', exact: true }).check();
  await page.getByRole('button', { name: 'Prepare export' }).click();
  await expect(page.locator('#export-status')).toContainText('Preview ready');
  await page.getByRole('radio', { name: 'JSON', exact: true }).check();
  const snapshot = JSON.parse(await page.locator('#export-preview').inputValue());
  // 02:00 in Edmonton on 1990-05-15 is daylight time (UTC−6), so 08:00 UTC.
  const natal = JSON.stringify(snapshot.charts[0]);
  expect(natal).toContain('1990-05-15T08:00:00.000Z');
  expect(natal).not.toContain('2000-01-01');
});

test('a profile or unknown-time chart is not blocked by an old time error', async ({ page }) => {
  await openApp(page);
  await openBirth(page);
  await enter(page, 'abc');
  await calculate(page);
  await expect(error(page)).toBeVisible();
  await page.getByLabel('Birth time unknown').check();
  await expect(error(page)).toBeHidden();
  await calculate(page);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(notice(page)).toHaveAttribute('data-state', 'custom');
  await expect(notice(page)).toContainText('birth time unknown');
});
