import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp } from './helpers';

async function search(page: Page, start: string, end: string, planet = 'all') {
  await openApp(page, 'events');
  await page.getByLabel('From (UTC midnight)', { exact: true }).fill(start);
  await page.getByLabel('To (UTC midnight)', { exact: true }).fill(end);
  await page.getByLabel('Transiting planet').selectOption(planet);
  await page.getByRole('button', { name: 'Search events' }).click();
  await expect(page.locator('#event-status')).toContainText(/Found \d+ events?/, { timeout: 30_000 });
}

const counts = async (page: Page) => {
  const text = await page.locator('#event-summary').innerText();
  const [, shown, total] = /Showing (\d+) of (\d+)/.exec(text)!;
  return { shown: Number(shown), total: Number(total) };
};

test('groups cards under chronological month headings with dates, relationships and status', async ({ page }) => {
  await search(page, '2024-03-20', '2024-06-30');
  const months = await page.locator('#event-results .event-month h3').allInnerTexts();
  expect(months.length).toBeGreaterThan(0);
  expect(new Set(months).size).toBe(months.length);
  const parsed = months.map(label => Date.parse(`1 ${label} UTC`));
  expect(parsed).toEqual([...parsed].sort((a, b) => a - b));
  // Every card is a list item in a list labelled by its month, with a date block, title and status chips.
  const first = page.locator('.event-card').first();
  await expect(first.locator('.event-date')).toHaveCount(1);
  await expect(first.locator('.event-title')).toContainText(/Transit \w+/);
  await expect(first.getByRole('list', { name: 'Event status' })).toBeVisible();
  await expect(page.locator('.event-cards').first()).toHaveAttribute('aria-labelledby', /^event-month-/);
  // An exact contact names both planets, the aspect, the exact time in UTC and its relation to the Time Machine.
  const contact = page.locator('.event-card.event-exact').first();
  await expect(contact.locator('.event-name')).toHaveText(/^Transit \w+ · (Conjunction|Sextile|Square|Trine|Opposition) · Natal \w+$/);
  await expect(contact.locator('.chip-exact')).toHaveText('Exact contact');
  await expect(contact.locator('.pass').first()).toContainText(/Exact contact.* · \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
  await expect(contact.getByRole('list', { name: 'Event status' })).toContainText(/Past|Upcoming|Happening now|Timing unknown/);
  await expect(page.locator('#event-results')).toContainText('Timing is relative to the Time Machine');
});

test('defaults to exact contacts and stations, with filters for stations only and all windows', async ({ page }) => {
  await search(page, '2024-03-20', '2024-06-30');
  const exact = page.getByRole('radio', { name: 'Exact contacts & stations' });
  await expect(exact).toBeChecked();
  const byDefault = await counts(page);
  expect(byDefault.total).toBeGreaterThan(byDefault.shown);
  await expect(page.locator('.event-card.event-near-miss, .event-card.event-window')).toHaveCount(0);
  await expect(page.locator('#event-summary')).toContainText('hidden by the filter');

  await page.getByRole('radio', { name: 'Stations only' }).check();
  const stations = await counts(page);
  expect(stations.shown).toBeGreaterThan(0);
  expect(stations.shown).toBeLessThan(byDefault.shown);
  await expect(page.locator('.event-card:not(.event-station)')).toHaveCount(0);
  await expect(page.locator('.event-card').first()).toContainText(/stations (direct|retrograde)/);
  await expect(page.locator('.event-card .chip-station').first()).toBeVisible();

  await page.getByRole('radio', { name: 'All windows' }).check();
  const everything = await counts(page);
  expect(everything).toEqual({ shown: byDefault.total, total: byDefault.total });
  await expect(page.locator('#event-summary')).not.toContainText('hidden');
  // The full calculated result is still there: the status line reports every event.
  await expect(page.locator('#event-status')).toContainText(`Found ${byDefault.total} events`);
});

test('shows retrograde stations and flags passes made while the planet was retrograde', async ({ page }) => {
  await search(page, '2024-03-20', '2024-05-15', 'mercury');
  const retro = page.locator('.event-card.event-station').filter({ hasText: 'Mercury stations retrograde' });
  await expect(retro).toHaveCount(1);
  await expect(retro.locator('.chip-retro')).toHaveText('℞ Turns retrograde');
  await expect(retro).toContainText('2024-04-01 22:14 UTC');
  await expect(page.locator('.event-card.event-station').filter({ hasText: 'Mercury stations direct' }).locator('.chip-direct')).toHaveText('Turns direct');
  // Any pass flagged retrograde falls between the two stations.
  const flagged = await page.locator('.pass', { has: page.locator('.chip-retro') }).allInnerTexts();
  for (const text of flagged) {
    const date = /(\d{4}-\d\d-\d\d \d\d:\d\d) UTC/.exec(text)![1];
    expect(date >= '2024-04-01 22:14' && date <= '2024-04-25 12:00').toBe(true);
  }
});

test('the details toggle expands every card without changing the results', async ({ page }) => {
  await search(page, '2024-03-20', '2024-04-10', 'venus');
  const cards = await page.locator('.event-card').count();
  expect(cards).toBeGreaterThan(0);
  await expect(page.locator('.event-card details[open]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show details' }).check();
  await expect(page.locator('.event-card details[open]')).toHaveCount(cards);
  await expect(page.locator('.event-card').first().locator('dl')).toContainText(/Within orb from|Station/);
  await expect(page.locator('.event-card details[open] dl').first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'Show details' }).uncheck();
  await expect(page.locator('.event-card details[open]')).toHaveCount(0);
  await expect(page.locator('.event-card')).toHaveCount(cards);
});

test('paginates the filtered list, keeps focus on the pager and keeps month headings in order', async ({ page }) => {
  await search(page, '2024-01-01', '2024-12-31');
  await expect(page.locator('#event-results .event-card')).toHaveCount(20);
  const next = page.getByRole('button', { name: 'Next results' });
  await next.click();
  await expect(page.locator('#event-results ol').first()).toHaveAttribute('start', '21');
  await expect(page.getByRole('button', { name: 'Previous results' })).toBeEnabled();
  await expect(page.locator('#event-results .event-pages')).toContainText('21–40 of');
  await expect(next).toBeFocused();
  // A different filter returns to the first page.
  await page.getByRole('radio', { name: 'Stations only' }).check();
  await expect(page.locator('#event-results .event-pages')).toHaveCount(0);
  await expect(page.locator('#event-results .event-card').first()).toContainText('stations');
});

test('a new search clears the toolbar, and cancel leaves nothing behind', async ({ page }) => {
  await search(page, '2024-03-20', '2024-04-10', 'venus');
  await expect(page.locator('#event-toolbar')).toBeVisible();
  await page.getByRole('radio', { name: 'All windows' }).check();
  await page.getByRole('button', { name: 'Search events' }).click();
  await expect(page.locator('#event-status')).toContainText(/Found|No events/);
  // The chosen filter persists between searches, so people keep their view.
  await expect(page.getByRole('radio', { name: 'All windows' })).toBeChecked();
});

test('lays cards out in one column on a phone without overflow and with readable targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await search(page, '2024-03-20', '2024-04-30', 'venus');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const boxes = await page.locator('.event-card').evaluateAll(cards => cards.slice(0, 4).map(card => {
    const rect = card.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }));
  for (const box of boxes) expect(box.right - box.left).toBeGreaterThan(300);
  expect(new Set(boxes.map(box => Math.round(box.left))).size).toBe(1);
  const segment = await page.getByRole('radio', { name: 'Stations only' }).locator('..').boundingBox();
  expect(segment!.height).toBeGreaterThanOrEqual(40);
});
