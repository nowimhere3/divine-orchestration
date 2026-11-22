import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { goTo, openApp, openBirth } from './helpers';

async function openEvents(page: Page, start: string, end: string) {
  await openApp(page, 'events');
  await page.getByLabel('From (UTC midnight)', { exact: true }).fill(start);
  await page.getByLabel('To (UTC midnight)', { exact: true }).fill(end);
}

test('finds planet stations in the worker when the natal positions are unavailable', async ({ page }) => {
  await openEvents(page, '2024-03-20', '2024-05-15');
  await goTo(page, 'chart');
  await openBirth(page);
  await page.getByLabel('Birth time unknown').check();
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.locator('#wheel-caption')).toContainText('Transit only');
  await goTo(page, 'events');
  await expect(page.getByLabel('From (UTC midnight)', { exact: true })).toHaveValue('2024-03-20');
  await page.getByLabel('Transiting planet').selectOption('mercury');
  await page.getByRole('button', { name: 'Search events' }).click();
  await expect(page.locator('#event-status')).toContainText('Found 2 events in the available data');
  const results = page.locator('#event-results');
  await expect(results).toContainText('Some natal positions are unavailable');
  await expect(results.locator('.event-card')).toHaveCount(2);
  await expect(results.locator('.event-card').first()).toContainText('Mercury stations retrograde');
  await expect(results.locator('.event-card').last()).toContainText('Mercury stations direct');
  await expect(results).toContainText('2024-04-01');
  await expect(results).toContainText('2024-04-25');
});

test('reports progress and cancels an in-flight worker without publishing late results', async ({ page }) => {
  await openEvents(page, '2024-01-01', '2024-12-31');
  const canceledFromProgress = await page.evaluate(() => new Promise<number>(resolve => {
    const gauge = document.querySelector<HTMLProgressElement>('#event-progress')!;
    const cancel = document.querySelector<HTMLButtonElement>('#event-cancel')!;
    const observer = new MutationObserver(() => {
      if (!gauge.hidden && gauge.hasAttribute('value') && gauge.max > 1) {
        observer.disconnect();
        cancel.click();
        resolve(gauge.max);
      }
    });
    observer.observe(gauge, { attributes: true, attributeFilter: ['value'] });
    document.querySelector<HTMLFormElement>('#event-form')!.requestSubmit();
  }));
  expect(canceledFromProgress).toBeGreaterThanOrEqual(110);
  await expect(page.locator('#event-status')).toHaveText('Event search canceled.');
  await expect(page.locator('#event-results')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Search events' })).toBeEnabled();
  await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2024-01-03');
  await page.getByLabel('Transiting planet').selectOption('sun');
  await page.getByRole('button', { name: 'Search events' }).click();
  await expect(page.locator('#event-status')).toHaveText(/^(Found|No events found)/);
});

test('keeps the chart responsive during a full-year all-planet search', async ({ page, browserName }) => {
  await openEvents(page, '2024-01-01', '2024-12-31');
  const motion = await page.evaluate(() => new Promise<{ ms: number; stillSearching: boolean; updated: boolean }>(resolve => {
    const gauge = document.querySelector<HTMLProgressElement>('#event-progress')!;
    const status = document.querySelector('#event-status')!;
    const slider = document.querySelector<HTMLInputElement>('#timeline')!;
    const epoch = document.querySelector('#selected-epoch')!;
    const before = epoch.textContent;
    const observer = new MutationObserver(() => {
      if (gauge.hidden || !gauge.hasAttribute('value')) return;
      observer.disconnect();
      const begin = performance.now();
      slider.value = '5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      // The observatory schedules its redraw before this callback.
      requestAnimationFrame(() => resolve({
        ms: performance.now() - begin,
        stillSearching: status.textContent === 'Searching planetary events…',
        updated: before !== epoch.textContent,
      }));
    });
    observer.observe(gauge, { attributes: true, attributeFilter: ['value'] });
    document.querySelector<HTMLFormElement>('#event-form')!.requestSubmit();
  }));
  expect(motion).toMatchObject({ stillSearching: true, updated: true });
  expect(motion.ms).toBeLessThan(500);
  console.log(`${browserName} chart redraw during full-year worker search: ${motion.ms.toFixed(1)} ms`);
  await expect(page.locator('#event-status')).toContainText(/Found \d+ events/, { timeout: 15_000 });
  await expect(page.locator('#event-results .event-card')).toHaveCount(20);
  await page.getByRole('button', { name: 'Next results' }).click();
  await expect(page.locator('#event-results ol').first()).toHaveAttribute('start', '21');
  await expect(page.locator('#event-results .event-card')).not.toHaveCount(0);
  await expect(page.locator('#wheel svg')).toHaveCount(1);
});
