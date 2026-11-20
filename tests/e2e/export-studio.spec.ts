import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { renderSnapshotMarkdown } from '../../src/export/snapshot';
import { goTo, openApp } from './helpers';

const fileText = async (download: Download) => readFile((await download.path())!, 'utf8');
const stepOne = (page: Page) => page.locator('#export-form');
const stepTwo = (page: Page) => page.locator('#export-step-two');
const prepare = (page: Page) => page.getByRole('button', { name: 'Prepare export' });
const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });

async function openExport(page: Page, date = '2024-04-15') {
  await openApp(page, 'chart');
  await page.getByLabel('Transit date', { exact: true }).fill(date);
  await expect(page.locator('#selected-epoch')).toContainText(date);
  await goTo(page, 'export');
  await expect(prepare(page)).toBeEnabled();
}

test('guides from configuration to a preview and back, naming the selected moment and privacy choices', async ({ page }) => {
  await openExport(page);
  await expect(page.locator('#step-configure')).toHaveAttribute('aria-current', 'step');
  await expect(stepOne(page)).toBeVisible();
  await expect(stepTwo(page)).toBeHidden();
  // The moment is the Time Machine's own text, UTC and relative.
  await expect(page.locator('#export-moment')).toContainText('2024-04-15');
  await expect(page.locator('#export-moment')).toContainText('UTC');
  await expect(radio(page, 'Redacted')).toBeChecked();
  await expect(page.locator('#privacy-full-hint')).toContainText('birth details');
  await expect(page.locator('#privacy-redacted-hint')).toContainText('Removes names');
  await expect(page.locator('#export-event-options')).toBeHidden();
  await radio(page, 'Include planetary events').check();
  await expect(page.locator('#export-event-options')).toBeVisible();
  await expect(page.locator('#export-event-options')).toContainText('measured from the selected moment');
  await radio(page, 'Selected moment').check();
  await expect(page.locator('#export-event-options')).toBeHidden();

  await prepare(page).click();
  await expect(page.locator('#export-status')).toContainText('Preview ready');
  await expect(stepTwo(page)).toBeVisible();
  await expect(stepOne(page)).toBeHidden();
  await expect(page.locator('#step-preview')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#export-preview-heading')).toBeFocused();
  await expect(page.locator('#export-summary')).toContainText('Redacted');
  await expect(page.locator('#export-summary')).toContainText('Selected moment only');
  // The prompt is a first-class part of step two, not a hidden disclosure.
  await expect(page.locator('#interpretation-prompt')).toBeVisible();
  await expect(page.locator('#interpretation-prompt')).toContainText('Do not invent planetary positions');

  await page.getByRole('button', { name: 'Back to settings' }).click();
  await expect(stepOne(page)).toBeVisible();
  await expect(radio(page, 'Redacted')).toBeFocused();
  await expect(page.locator('#export-moment')).toContainText('2024-04-15');
});

test('exports the selected facts in consistent full and redacted formats and disables a stale preview', async ({ page, browserName }) => {
  await openApp(page, 'library');
  await expect(page.getByRole('button', { name: 'Save current chart' })).toBeEnabled();
  await page.getByLabel('Profile name').fill('Private Person');
  await page.getByRole('button', { name: 'Save current chart' }).click();
  await expect(page.locator('#profile-status')).toContainText('saved locally');
  await goTo(page, 'chart');
  await page.getByLabel('Transit date', { exact: true }).fill('2024-04-15');
  await expect(page.locator('#selected-epoch')).toContainText('2024-04-15');
  await goTo(page, 'export');
  const preview = page.getByLabel('Export preview');
  await radio(page, 'Full').check();
  await prepare(page).click();
  await expect(page.locator('#export-status')).toContainText('Preview ready');
  await radio(page, 'JSON').check();
  const json = await preview.inputValue();
  const parsed = JSON.parse(json);
  expect(parsed.charts[0].label).toBe('Private Person');
  expect(parsed.charts[0].settings.observer.latitudeDeg).toBe(51.4779);
  expect(parsed.charts[0].planets.value.find((p: { planetId: string }) => p.planetId === 'sun').position.value.longitudeDeg)
    .toBeCloseTo(280.369, 2);
  expect(parsed.charts[1].planets.value).toHaveLength(10);
  expect(parsed.context.selectedAt.utc).toMatch(/^2024-04-15/);
  expect(parsed.context.eventSearch).toBeNull();
  expect(parsed.interpretations).toEqual([]);
  // Preparing again is deterministic.
  await page.getByRole('button', { name: 'Back to settings' }).click();
  await prepare(page).click();
  await expect(stepTwo(page)).toBeVisible();
  await expect(preview).toHaveValue(json);
  await radio(page, 'Markdown').check();
  await expect(preview).toHaveValue(renderSnapshotMarkdown(parsed));
  const markdownReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  expect(await fileText(await markdownReady)).toBe(renderSnapshotMarkdown(parsed));

  await page.getByRole('button', { name: 'Back to settings' }).click();
  await radio(page, 'Redacted').check();
  await expect(page.locator('#export-json')).toBeDisabled();
  await prepare(page).click();
  const jsonReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const redacted = await fileText(await jsonReady);
  for (const value of ['Private Person', '2000-01-01', '2024-04-15', 'Europe/London', '51.4779']) expect(redacted).not.toContain(value);
  const safe = JSON.parse(redacted);
  expect(safe.charts[0].planets).toEqual(parsed.charts[0].planets);
  await expect(preview).toHaveValue(renderSnapshotMarkdown(safe));
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy preview' }).click();
    await expect(page.locator('#export-status')).toHaveText('Preview copied.');
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(renderSnapshotMarkdown(safe));
    await page.getByRole('button', { name: 'Copy interpretation prompt' }).click();
    await expect(page.locator('#export-status')).toHaveText('Interpretation prompt copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Do not invent planetary positions');
  }
  await goTo(page, 'chart');
  await page.getByRole('button', { name: 'Next day' }).click();
  await goTo(page, 'export');
  // A changed moment discards the preview and returns to configuration.
  await expect(preview).toHaveValue('');
  await expect(page.locator('#export-copy')).toBeDisabled();
  await expect(stepOne(page)).toBeVisible();
  await expect(page.locator('#export-status')).toContainText('Selection changed');
  await expect(page.locator('#export-moment')).toContainText('2024-04-16');
});

test('captures a filtered B4 event context around the selected Time Machine instant', async ({ page }) => {
  await openExport(page);
  await radio(page, 'Full').check();
  await radio(page, 'Include planetary events').check();
  await page.getByLabel('Days before').fill('30');
  await page.getByLabel('Days after').fill('30');
  await page.getByLabel('Event timing').selectOption('past');
  await page.getByLabel('Event type').selectOption('station');
  await prepare(page).click();
  await expect(page.locator('#export-status')).toContainText('Preview ready', { timeout: 15_000 });
  await radio(page, 'JSON').check();
  const result = JSON.parse(await page.getByLabel('Export preview').inputValue());
  const { eventSearch, eventSummary } = result.context;
  expect(eventSummary).toMatchObject({ timing: 'past', filter: 'station', status: 'complete' });
  expect(eventSummary.includedEvents).toBe(eventSearch.events.length);
  expect(eventSummary.totalEvents).toBeGreaterThan(eventSummary.includedEvents);
  expect(eventSearch.events.every((event: { kind: string; timing: string }) => event.kind === 'station' && event.timing === 'past')).toBe(true);
  expect(eventSearch.events).toEqual(expect.arrayContaining([expect.objectContaining({
    kind: 'station', planet: { chartId: 'transit', planetId: 'mercury' }, turns: 'retrograde',
    at: expect.objectContaining({ utc: expect.stringMatching(/^2024-04-01T22:14:/) }),
  })]));
  await expect(page.locator('#export-summary')).toContainText(`${eventSummary.includedEvents} of ${eventSummary.totalEvents} events`);
  await page.getByRole('button', { name: 'Back to settings' }).click();
  await expect(page.getByLabel('Days before')).toHaveValue('30');
  await radio(page, 'Redacted').check();
  await prepare(page).click();
  await expect(page.locator('#export-status')).toContainText('Preview ready', { timeout: 15_000 });
  const redacted = JSON.parse(await page.getByLabel('Export preview').inputValue());
  expect(redacted.context.eventSummary).toEqual(eventSummary);
  expect(redacted.context.eventSearch.events.every((event: { at: object; planet: { chartId: string } }) =>
    Object.values(event.at).every(value => value === null) && event.planet.chartId === 'chart-2')).toBe(true);
});

test('rejects an empty context window and stays on the configuration step', async ({ page }) => {
  await openExport(page);
  await radio(page, 'Include planetary events').check();
  await page.getByLabel('Days before').fill('0');
  await page.getByLabel('Days after').fill('0');
  await prepare(page).click();
  await expect(page.locator('#export-status')).toContainText('Choose 1 to 180 days');
  await expect(stepOne(page)).toBeVisible();
  await expect(stepTwo(page)).toBeHidden();
});

test('the studio is keyboard operable and fits a phone without overflow', async ({ page }) => {
  await openExport(page);
  await radio(page, 'Redacted').focus();
  await page.keyboard.press('ArrowDown');
  await expect(radio(page, 'Full')).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await prepare(page).click();
  await expect(stepTwo(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  for (const name of ['Copy preview', 'Download Markdown', 'Download JSON']) {
    expect((await page.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
