import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { goTo, openApp, openBirth } from './helpers';

const cards = (page: Page) => page.locator('#event-results .event-card:not(.event-return-window)');
const summary = (page: Page) => page.locator('#event-summary');
const impact = (page: Page) => page.locator('#research-impact-cutoff');

async function openCalgary(page: Page) {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: { kind: string }, options?: StructuredSerializeOptions | Transferable[]) {
      if (message.kind === 'range-search') {
        const data = document.documentElement.dataset;
        data.testRangeSearches = String(Number(data.testRangeSearches ?? 0) + 1);
      }
      original.call(this, message, Array.isArray(options) ? { transfer: options } : options);
    };
  });
  await openApp(page);
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('1987-03-14');
  await page.getByLabel('Local birth time', { exact: true }).fill('07:25');
  await page.locator('#birth-alberta').click();
  await page.locator('#birth-lat').fill('51.0447');
  await page.locator('#birth-lon').fill('-114.0719');
  await page.locator('#house-system').selectOption('Placidus');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await goTo(page, 'events');
}

async function search(page: Page, to = '2027-01-01') {
  await page.locator('#event-from').fill('2026-01-01');
  await page.locator('#event-to').fill(to);
  await page.getByRole('button', { name: 'Search events', exact: true }).click();
  await expect(page.locator('#event-status')).toContainText(/Found \d+ events?/, { timeout: 25_000 });
}

test('filters by supported Impact and ranks before pagination with no additional search', async ({ page }) => {
  await openCalgary(page);
  await search(page);
  await expect(page.locator('#research-configuration')).not.toHaveAttribute('open', '');
  await expect(page.locator('#research-impact-value')).toHaveText('Off');
  await expect(impact(page)).toBeDisabled();
  const first = await cards(page).first().locator('.chip-impact').innerText();
  await expect(cards(page).first().locator('.chip-score')).toContainText('Theme Relevance Score');
  await cards(page).first().getByText('Why this score?', { exact: true }).click();
  for (const term of ['Natal connection', 'Planetary cycle', 'Contact precision', 'Contact type']) {
    await expect(cards(page).first().locator('.event-impact-detail')).toContainText(term);
  }
  await expect(cards(page).first().locator('.event-impact-detail')).toContainText('no probability of a life outcome');
  await page.getByRole('button', { name: 'Next results' }).click();
  await expect(summary(page)).toContainText('Showing 21–40');
  await page.getByRole('button', { name: 'Previous results' }).click();
  await expect(cards(page).first().locator('.chip-impact')).toHaveText(first);
  await page.getByLabel('Use Impact cutoff').check();
  await expect(page.locator('#research-impact-value')).toHaveText('0+');
  await impact(page).fill('80');
  await expect(page.locator('#research-impact-value')).toHaveText('80+');
  const scores = await cards(page).locator('[data-impact-score]').evaluateAll(elements => elements.map(el => Number((el as HTMLElement).dataset.impactScore)));
  expect(scores.length).toBeGreaterThan(0);
  expect(scores.every(score => score >= 80)).toBe(true);
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('impact');
  await page.getByRole('combobox', { name: 'Top', exact: true }).selectOption('10');
  await expect(cards(page)).toHaveCount(10);
  await expect(summary(page)).toContainText('Showing 1–10 of 10 contacts or series');
  const group = cards(page).locator('.event-linked-returns').first();
  await group.locator('summary').click();
  await expect(group.locator('.event-return-window').first()).toBeVisible();
  await impact(page).fill('100');
  await expect(summary(page)).toContainText('No events match this filter');
  await page.getByRole('radio', { name: 'Stations only' }).check();
  await impact(page).fill('70');
  await expect(cards(page).first()).toHaveClass(/event-station/);
  expect(await cards(page).locator('[data-impact-score]').evaluateAll(elements =>
    elements.every(el => Number((el as HTMLElement).dataset.impactScore) >= 70))).toBe(true);
  await page.getByLabel('Use Impact cutoff').uncheck();
  await expect(page.locator('#research-impact-value')).toHaveText('Off');
  await page.getByRole('radio', { name: 'All windows' }).check();
  await page.getByRole('combobox', { name: 'Top', exact: true }).selectOption('all');
  const strongest = cards(page).first();
  const strongestTitle = await strongest.locator('.event-name').innerText();
  const strongestScore = await strongest.locator('.chip-impact').innerText();
  await page.getByRole('tab', { name: 'Life Themes' }).click();
  await page.locator('.theme-card[data-theme-id="finances"]').click();
  await page.locator('input[name="research-scope"][value="all"]').check();
  await expect(strongest.locator('.event-name')).toHaveText(strongestTitle);
  await expect(strongest.locator('.chip-impact')).toHaveText(strongestScore);
  await expect(page.locator('html')).toHaveAttribute('data-test-range-searches', '1');
});

test('summarizes a year of overlaps and exposes paged evidence on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalgary(page);
  await search(page);
  const explorer = page.locator('#event-convergence');
  await explorer.locator(':scope > summary').click();
  await expect(explorer).toContainText('1 overlap period at Impact 65+');
  await expect(explorer).toContainText('Peak 9 distinct bodies');
  await expect(explorer).toContainText('Clipped at start · Clipped at end');
  await expect(explorer.getByRole('list', { name: 'Observed time by concurrent body count' })).toBeVisible();
  await expect(explorer).toContainText('peak sub-windows');
  await expect(explorer.locator('details.overlap-evidence > .overlap-evidence-list')).toHaveCount(0);
  await explorer.getByText('Membership segments (579)', { exact: true }).click();
  await expect(explorer.getByText('1–20 of 579 segments')).toBeVisible();
  await explorer.getByRole('button', { name: 'Next segments' }).click();
  await expect(explorer.getByText('21–40 of 579 segments')).toBeVisible();
  await explorer.getByLabel('Include Moon timing markers').check();
  await expect(explorer).toContainText('Calculated Moon markers are shown');
  await explorer.getByRole('button', { name: '90+', exact: true }).click();
  await expect(explorer).toContainText('2 overlap periods at Impact 90+');
  await page.getByLabel('Include fast Moon transits').uncheck();
  await expect(explorer.getByLabel('Include Moon timing markers')).toBeDisabled();
  await expect(explorer).toContainText('Moon markers are unavailable in this query');
  await expect(page.locator('html')).toHaveAttribute('data-test-range-searches', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('clears focus selections and routes both accessible export actions to the guarded U6 handoff', async ({ page }) => {
  await openCalgary(page);
  await page.getByRole('tab', { name: 'Life Themes' }).click();
  const theme = page.locator('.theme-card[data-theme-id="finances"]');
  await theme.click();
  await page.getByRole('tab', { name: 'Custom Search' }).click();
  await page.getByLabel('House 5 rule').selectOption('exclude');
  await search(page, '2026-04-01');
  await page.getByRole('tab', { name: 'Custom Search' }).click();
  await expect(page.getByLabel('House 5 rule')).toHaveValue('exclude');
  await page.getByRole('button', { name: 'Clear selections' }).click();
  await expect(page.getByLabel('House 5 rule')).toHaveValue('neutral');
  await page.getByRole('tab', { name: 'Life Themes' }).click();
  await expect(theme).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#event-from')).toHaveValue('2026-01-01');
  await expect(page.locator('#event-to')).toHaveValue('2026-04-01');
  await expect(page.locator('#research-chart-status')).toContainText('Placidus');
  await theme.click();
  await expect(summary(page)).toBeVisible();
  await page.getByLabel('Match selected themes').check();
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('priority');
  await page.getByRole('combobox', { name: 'Top', exact: true }).selectOption('10');
  const shortcut = page.getByRole('button', { name: 'Export research shortcut' });
  const primary = page.getByRole('button', { name: 'Export Research', exact: true });
  expect(await primary.evaluate(el => Boolean(document.querySelector('#event-results')!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(primary).toHaveAccessibleDescription(/across all pages/);
  await shortcut.focus();
  await shortcut.press('Enter');
  await expect(page).toHaveURL(/#export$/);
  await expect(page.locator('#research-export-scope-hint')).toContainText('Impact Off · Top 10');
  await goTo(page, 'events');
  await primary.click();
  await expect(page).toHaveURL(/#export$/);
  await goTo(page, 'events');
  await page.locator('#event-to').fill('2026-05-01');
  await expect(page.locator('#event-stale')).toBeVisible();
  await expect(primary).toBeDisabled();
  await expect(shortcut).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute('data-test-range-searches', '1');
});

test('explains limited station Impact when the birth time is unknown', async ({ page }) => {
  await openApp(page);
  await openBirth(page);
  await page.getByLabel('Birth time unknown').check();
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await goTo(page, 'events');
  await search(page, '2026-06-01');
  await page.getByRole('radio', { name: 'Stations only' }).check();
  const card = cards(page).first();
  await expect(card.locator('.chip-impact')).toContainText('limited evidence');
  await card.getByText('Why this score?', { exact: true }).click();
  await expect(card.locator('.event-impact-detail')).toContainText('possible upper bound');
  await expect(card.locator('.event-impact-detail')).toContainText('No natal house could be assigned');
});
