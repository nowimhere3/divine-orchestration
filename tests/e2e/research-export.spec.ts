import { readFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { validateResearchPackage } from '../../src/export/research-package';
import type { PersonalizedResearchManifest, PersonalizedResearchPart } from '../../src/export/research-package';
import type { SearchWorkerMessage, SearchWorkerRequest } from '../../src/search/protocol';
import type { EventRangeSearchResult } from '../../src/search/range';
import { goTo, openApp, openBirth, closeBirth } from './helpers';

declare global {
  interface Window {
    exportSearchProbe: { total: number; result?: EventRangeSearchResult };
  }
}

const prepare = (page: Page) => page.getByRole('button', { name: 'Prepare research export' });
const preview = (page: Page) => page.getByLabel('Research file preview');
const researchAction = (page: Page) => page.getByRole('button', { name: 'Export Research', exact: true });
const source = (page: Page) => page.locator('#research-export-source');
const select = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const dropdown = (page: Page, label: string) => page.getByRole('combobox', { name: label, exact: true });
const read = async (download: Download) => new Uint8Array(await readFile((await download.path())!));

async function watchSearches(page: Page, substitute124 = false) {
  await page.addInitScript(substitute => {
    window.exportSearchProbe = { total: 0 };
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      this: Worker, message: SearchWorkerRequest, options?: StructuredSerializeOptions | Transferable[],
    ) {
      if (message.kind !== 'transit-enrichment') window.exportSearchProbe.total++;
      if (message.kind === 'range-search') {
        const capture = ({ data }: MessageEvent<SearchWorkerMessage>) => {
          if (data.type !== 'range-complete') return;
          if (substitute) {
            const seed = data.result.events.find(event => event.kind === 'aspect-window');
            if (!seed || seed.kind !== 'aspect-window') throw new Error('Missing controlled fixture seed.');
            const base = data.result.range.effectiveStart.jdTt!;
            const at = (day: number) => ({ utc: null, jdUt: null, jdTt: base + day });
            const events = Array.from({ length: 124 }, (_, i) => {
              const pass = { at: at(i / 8 + 1), state: 'exact' as const, residualDeg: 0, toleranceDeg: 0.00001, retrograde: false, passNumberInSeries: 1 };
              const high = i < 16;
              const planetId = high ? (i % 2 ? 'saturn' : 'neptune') : 'moon';
              return {
                ...seed, id: `controlled-${i}`, transit: { ...seed.transit, planetId },
                target: { ...seed.target, planetId: 'sun' as const }, aspect: high ? 'square' as const : 'sextile' as const,
                startsAt: at(i / 8), endsAt: at(i / 8 + 3), clippedStart: false, clippedEnd: false,
                passes: [pass], series: { ...seed.series, id: i === 1 || i === 3 ? 'controlled-returns' : `series-${i}`,
                  windowIndex: i === 3 ? 1 : 0, windowCountInRange: i === 1 || i === 3 ? 2 : 1, exactPassCountInRange: i === 1 || i === 3 ? 2 : 1,
                  isRetrogradeSeries: i === 1 || i === 3, clippedStart: false, clippedEnd: false, complete: true },
              };
            });
            Object.assign(data.result, { events });
          }
          window.exportSearchProbe.result = data.result;
        };
        if (substitute) {
          const receive = this.onmessage;
          this.onmessage = event => { capture(event); receive?.call(this, event); };
        } else {
          this.addEventListener('message', capture);
        }
      }
      original.call(this, message, Array.isArray(options) ? { transfer: options } : options);
    };
  }, substitute124);
}

async function searchInterval(page: Page, from: string, to: string) {
  await select(page, 'From (UTC midnight)').fill(from);
  await select(page, 'To (UTC midnight)').fill(to);
  await page.getByRole('button', { name: 'Search events' }).click();
  await expect(page.locator('#event-status')).toContainText(/Found \d+ events?/, { timeout: 30_000 });
  await expect(researchAction(page)).toBeEnabled();
}

async function openResearchExport(page: Page) {
  await researchAction(page).click();
  await expect(page).toHaveURL(/#export$/);
  await expect(page.getByRole('radio', { name: 'Events research' })).toBeChecked();
  await expect(prepare(page)).toBeEnabled();
}

async function preparePreview(page: Page) {
  await prepare(page).click();
  await expect(page.locator('#research-export-status')).toHaveText('Research preview ready. Files verified.', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Preview research files' })).toBeFocused();
}

async function jsonEvidence(page: Page) {
  const manifest: PersonalizedResearchManifest = JSON.parse(await preview(page).inputValue());
  expect(manifest.schemaVersion).toBe(2);
  expect(manifest.parts).toHaveLength(1);
  await dropdown(page, 'Preview file').selectOption({ index: 1 });
  const part: PersonalizedResearchPart = JSON.parse(await preview(page).inputValue());
  return { research: manifest.research, events: part.events };
}

function unpackStoreZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const decoder = new TextDecoder();
  const end = bytes.length - 22;
  expect(u32(end)).toBe(0x06054b50);
  const count = u16(end + 10);
  let directory = u32(end + 16);
  const files = [];
  for (let index = 0; index < count; index++) {
    expect(u32(directory)).toBe(0x02014b50);
    expect(u16(directory + 10)).toBe(0);
    const offset = u32(directory + 42);
    expect(u32(offset)).toBe(0x04034b50);
    const filenameEnd = directory + 46 + u16(directory + 28);
    const name = decoder.decode(bytes.subarray(directory + 46, filenameEnd));
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    const content = bytes.slice(start, start + u32(directory + 24));
    expect(crc32(content)).toBe(u32(directory + 16));
    expect(decoder.decode(bytes.subarray(offset + 30, offset + 30 + u16(offset + 26)))).toBe(name);
    files.push({ name, bytes: content });
    directory = filenameEnd + u16(directory + 30) + u16(directory + 32);
  }
  expect(directory).toBe(end);
  return files;
}

test('hands off a year once and exports current stations, relevant findings and the complete query', async ({ page }) => {
  test.setTimeout(75_000);
  await watchSearches(page);
  await openApp(page, 'chart');
  await openBirth(page);
  await select(page, 'Birth date').fill('1987-03-14');
  await select(page, 'Local birth time').fill('07:25');
  await page.locator('#birth-alberta').click();
  await page.locator('#birth-lat').fill('51.0447');
  await page.locator('#birth-lon').fill('-114.0719');
  await page.locator('#house-system').selectOption('Placidus');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await select(page, 'Transit date').fill('2024-04-15');
  await expect(page.locator('#selected-epoch')).toContainText('2024-04-15');
  await goTo(page, 'events');
  await page.getByRole('tab', { name: 'Life Themes' }).click();
  await page.locator('.theme-card[data-theme-id="project-development"]').click();
  await page.locator('.theme-card[data-theme-id="finances"]').click();
  await page.getByLabel('Include fast Moon transits').check();
  await searchInterval(page, '2026-01-01', '2027-01-01');
  const count = async (scope: string) => {
    const label = await page.locator(`input[name="research-scope"][value="${scope}"] + span`).innerText();
    return Number(/\((\d+)\)/.exec(label)![1]);
  };
  const relevant = await count('relevant');
  const broader = await count('context');
  const total = await count('all');
  expect(relevant + broader).toBe(total);
  expect(broader).toBeGreaterThan(0);
  expect(total).toBeGreaterThan(1_000);
  // The frozen current scope follows the display controls, separately from the wider U6 scopes.
  await page.getByLabel('Show Moon events').uncheck();
  await page.getByRole('radio', { name: 'Stations only' }).check();
  await openResearchExport(page);
  await expect(source(page)).toContainText('2026-01-01 to 2027-01-01');
  await expect(source(page)).toContainText('Moon included');
  await expect(source(page)).toContainText('Focus houses');
  await expect(page.locator('#research-export-scope-hint')).toContainText('Events view: Relevant.');
  await expect(page.getByRole('radio', { name: /^Current filtered results/ })).toBeChecked();
  await expect(dropdown(page, 'Birth details to share')).toHaveValue('redacted');
  await expect(dropdown(page, 'Event dates')).toHaveValue('relative');
  await dropdown(page, 'File format').selectOption('json');
  await dropdown(page, 'Target size per event file').selectOption('unsplit');
  await preparePreview(page);
  const stations = await jsonEvidence(page);
  expect(stations.research.personalized.selection).toMatchObject({ scope: 'current', filters: { category: 'station', showMoon: false } });
  expect(stations.events.length).toBeGreaterThan(0);
  expect(stations.events.every(event => event.facts.kind === 'station')).toBe(true);
  await page.getByRole('button', { name: 'Back to research settings' }).click();
  await page.getByRole('radio', { name: /^Relevant findings/ }).check();
  await page.getByLabel('Include natal interpretation').check();
  await page.getByLabel('Include selected-moment transit interpretation').check();
  await preparePreview(page);
  const focused = await jsonEvidence(page);
  expect(focused.research.exportMode).toBe('focused');
  expect(focused.events).toHaveLength(relevant);
  expect(focused.research.scope.counts.omittedBroaderContext).toBe(broader);
  expect(focused.research.query.resolvedFocus.activeHouses.length).toBeGreaterThan(0);
  expect(focused.research.themes.definitions).toHaveLength(2);
  expect(focused.research.snapshot.charts[0]).toMatchObject({ label: null, time: null, settings: { observer: null } });
  expect(focused.research.natalSynthesis).toBe('included');
  expect(focused.research.snapshot.interpretations.length).toBeGreaterThan(0);
  expect(focused.research.selectedMomentTransit).toMatchObject({ scope: 'selected-moment', status: 'included' });
  await expect(page.locator('#research-export-details')).toContainText(`${broader.toLocaleString('en')} broader-context events omitted`);
  await expect(page.locator('#research-export-details')).toContainText('Selected-moment transit interpretation: included');

  await page.getByRole('button', { name: 'Back to research settings' }).click();
  await page.getByRole('radio', { name: /^Complete original research/ }).check();
  await dropdown(page, 'Event dates').selectOption('calendar');
  await preparePreview(page);
  const complete = await jsonEvidence(page);
  expect(complete.research.exportMode).toBe('complete');
  expect(complete.events).toHaveLength(total);
  expect(complete.research.scope.counts.omittedBroaderContext).toBe(0);
  expect(complete.research.scope.counts.exported.moon).toBeGreaterThan(0);
  expect(Object.values(complete.research.scope.counts.exported.byKind).every(value => value > 0)).toBe(true);
  expect(complete.research.selectedMomentTransit?.at).toMatchObject({ utc: expect.stringMatching(/^2024-04-15/) });
  expect(complete.research.query.range).toMatchObject({ startDate: '2026-01-01', endDate: '2027-01-01' });
  expect(complete.research.query.focus).toEqual(focused.research.query.focus);
  const probe = await page.evaluate(() => window.exportSearchProbe);
  expect(probe.total).toBe(1);
  const facts = complete.events.flatMap(event => [event.facts, ...event.axisCompanions]);
  const raw = probe.result!.events;
  expect(new Set(facts.map(item => item.id)).size).toBe(raw.length);
  expect(facts).toHaveLength(raw.length);
  for (const item of facts) {
    const original = raw[Number(item.id.slice('event-'.length)) - 1];
    expect(item.kind).toBe(original.kind);
    if ('passes' in item && 'passes' in original) expect(item.passes).toEqual(original.passes);
    if ('at' in item && 'at' in original) expect(item.at).toEqual(original.at);
  }
});

test('freezes all pages, then exports exactly the 16 of 124 matching Impact 72', async ({ page }) => {
  test.setTimeout(50_000);
  await watchSearches(page, true);
  await openApp(page, 'events');
  await searchInterval(page, '2026-01-01', '2026-01-23');
  await expect(page.locator('#event-status')).toContainText('Found 124 events');
  await page.getByRole('radio', { name: 'All windows' }).check();
  await page.getByRole('button', { name: 'Next results' }).click();
  await expect(page.locator('#event-summary')).toContainText('Showing 21–40 of 124 events');
  await openResearchExport(page);
  await expect(page.getByRole('radio', { name: 'Current filtered results · 124 events' })).toBeChecked();
  await goTo(page, 'events');
  await page.getByLabel('Use Impact cutoff').check();
  await page.locator('#research-impact-cutoff').fill('72');
  await expect(page.locator('#event-summary')).toContainText('16 of 124 events match');
  await openResearchExport(page);
  await expect(page.getByRole('radio', { name: 'Current filtered results · 16 events' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Complete original research · 124 events' })).toBeVisible();
  await expect(page.locator('#research-selection-counts')).toContainText('108 of 124 complete research events excluded');
  await dropdown(page, 'File format').selectOption('json');
  await dropdown(page, 'Target size per event file').selectOption('unsplit');
  await preparePreview(page);
  const result = await jsonEvidence(page);
  expect(result.events).toHaveLength(16);
  expect(result.events.every(event => event.personalImpact.total >= 72)).toBe(true);
  expect(result.research.personalized.selection.counts).toMatchObject({ current: 16, complete: 124, excludedFromComplete: 108 });
  await goTo(page, 'events');
  await page.locator('#research-impact-cutoff').fill('100');
  await goTo(page, 'export');
  await expect(page.locator('#research-export-summary')).toContainText('16 exported events');
  await goTo(page, 'events');
  await openResearchExport(page);
  await expect(page.getByRole('radio', { name: 'Current filtered results · 0 events' })).toBeChecked();
  await expect(page.locator('#research-selection-counts')).toContainText('empty timeline');
  await preparePreview(page);
  await expect(page.locator('#research-export-summary')).toContainText('0 exported events');
  await goTo(page, 'events');
  await page.locator('#research-impact-cutoff').fill('72');
  await dropdown(page, 'Top').selectOption('10');
  await openResearchExport(page);
  await expect(page.getByRole('radio', { name: 'Current filtered results · 10 events' })).toBeChecked();
  const linked = page.getByRole('checkbox', { name: 'Include 1 linked return window' });
  await expect(linked).not.toBeChecked();
  await linked.check();
  await expect(page.getByRole('radio', { name: 'Current filtered results · 11 events' })).toBeChecked();
  await preparePreview(page);
  await expect(page.locator('#research-export-summary')).toContainText('11 exported events');
  await expect(page.locator('#research-export-details')).toContainText('10 selected events and 1 linked return window included');
  expect(await page.evaluate(() => window.exportSearchProbe.total)).toBe(1);
});

test('downloads a validated multipart ZIP, previews individual files and uses the cached Moon scope', async ({ page, browserName }) => {
  test.setTimeout(65_000);
  await watchSearches(page);
  await openApp(page, 'events');
  await page.getByLabel('Include fast Moon transits').check();
  await searchInterval(page, '2026-01-01', '2026-05-01');
  await page.getByLabel('Include fast Moon transits').uncheck();
  await expect(page.locator('#event-status')).toContainText('cached calculation');
  await openResearchExport(page);
  await expect(source(page)).toContainText('Moon excluded');
  await page.getByRole('radio', { name: /^Complete original research/ }).check();
  await dropdown(page, 'Target size per event file').selectOption('60000');
  await dropdown(page, 'Event dates').selectOption('omit');
  await preparePreview(page);
  await expect(page.locator('#research-export-summary')).toContainText(/Manifest \+ \d+ event files/);
  await expect(page.locator('#research-file-details')).toContainText('00-manifest.md');
  await expect(page.locator('#research-ai-steps')).toContainText('supply the manifest first');
  await expect(page.locator('#research-ai-context')).toContainText('insufficient context');
  const manifest = await preview(page).inputValue();
  await dropdown(page, 'Preview file').selectOption({ index: 1 });
  await expect(page.locator('#research-file-details')).toContainText(/Events 1–\d+.*tokens/);
  const part = await preview(page).inputValue();
  expect(part).toMatch(/^# Research events · Part 1 of/);
  const partDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file' }).click();
  const firstPart = await partDownload;
  expect(new TextDecoder().decode(await read(firstPart))).toBe(part);

  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy file', exact: true }).click();
    await expect(page.locator('#research-export-status')).toHaveText('Research file copied.');
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(part);
    await page.getByRole('button', { name: 'Copy research instructions' }).click();
    await expect(page.locator('#research-export-status')).toHaveText('Research instructions copied.');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain('The selected export scope');
    expect(prompt).toContain('supply the manifest first');
    expect(prompt).not.toContain('2026-01-01');
  }

  const packet = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ZIP' }).click();
  const zip = await packet;
  expect(zip.suggestedFilename()).toBe('divine-orchestration-research.zip');
  const zipBytes = await read(zip);
  const files = unpackStoreZip(zipBytes);
  expect(files[0].name).toBe('00-manifest.md');
  expect(new TextDecoder().decode(files[0].bytes)).toBe(manifest);
  expect(files[1].name).toBe(firstPart.suggestedFilename());
  const { document, events } = await validateResearchPackage(files, zipBytes);
  expect(document.research.exportMode).toBe('complete');
  expect(document.research.scope.moon).toEqual({ requested: false, included: false, calculated: true });
  expect(document.research.scope.counts.calculated).toBeGreaterThan(events.length);
  expect(events.every(event => event.orderAt === null)).toBe(true);
  expect(decoderText(zipBytes)).not.toContain('2026-01-01');
  expect(decoderText(zipBytes)).not.toContain('2000-01-01');
  expect(await page.evaluate(() => window.exportSearchProbe.total)).toBe(1);
});

const decoderText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test('rejects outdated research settings and blocks a handed-off preview after birth details change', async ({ page }) => {
  await watchSearches(page);
  await openApp(page, 'events');
  await searchInterval(page, '2026-01-01', '2026-01-20');
  await openResearchExport(page);
  await preparePreview(page);
  await goTo(page, 'events');
  await select(page, 'To (UTC midnight)').fill('2026-02-05');
  await expect(page.locator('#event-stale')).toBeVisible();
  await expect(researchAction(page)).toBeDisabled();
  await goTo(page, 'export');
  await expect(source(page)).toContainText('Events search changed');
  await expect(preview(page)).toHaveValue('');
  await expect(prepare(page)).toBeHidden();
  await expect(await page.evaluate(() => window.exportSearchProbe.total)).toBe(1);

  await goTo(page, 'events');
  await searchInterval(page, '2026-01-01', '2026-02-05');
  await openResearchExport(page);
  await preparePreview(page);
  await goTo(page, 'chart');
  await openBirth(page);
  await select(page, 'Birth date').fill('1991-01-05');
  await closeBirth(page);
  await goTo(page, 'export');
  await expect(source(page)).toContainText('Birth details changed. Calculate the chart');
  await expect(preview(page)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Download ZIP' })).toBeHidden();
  await goTo(page, 'events');
  await researchAction(page).click();
  await expect(page).toHaveURL(/#events$/);
  await expect(page.locator('#event-status')).toContainText('Birth details changed');
  await goTo(page, 'chart');
  await openBirth(page);
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await goTo(page, 'events');
  await expect(page.locator('#event-status')).toContainText('Natal chart updated');
  await expect(researchAction(page)).toBeHidden();
  expect(await page.evaluate(() => window.exportSearchProbe.total)).toBe(2);
});

test('supports explicit full birth details, invalidates only selected-moment context on time changes, and fits a phone', async ({ page }) => {
  await openApp(page, 'chart');
  await select(page, 'Transit date').fill('2024-04-15');
  await expect(page.locator('#selected-epoch')).toContainText('2024-04-15');
  await goTo(page, 'events');
  await searchInterval(page, '2026-01-01', '2026-01-17');
  await openResearchExport(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await dropdown(page, 'Birth details to share').selectOption('full');
  await expect(dropdown(page, 'Event dates')).toHaveValue('relative');
  await dropdown(page, 'Event dates').selectOption('calendar');
  await dropdown(page, 'File format').selectOption('json');
  await dropdown(page, 'Target size per event file').selectOption('unsplit');
  await page.getByLabel('Include selected-moment transit interpretation').check();
  await preparePreview(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const before = await jsonEvidence(page);
  expect(before.research.snapshot.charts[0]).toMatchObject({
    time: { input: { date: '2000-01-01' } }, settings: { observer: { latitudeDeg: 51.4779 } },
  });
  expect(before.research.selectedMomentTransit?.at).toMatchObject({ utc: expect.stringMatching(/^2024-04-15/) });
  await goTo(page, 'chart');
  await page.getByRole('button', { name: 'Next day' }).click();
  await goTo(page, 'export');
  await expect(page.locator('#research-export-status')).toContainText('Time Machine moment changed');
  await expect(preview(page)).toHaveValue('');
  await preparePreview(page);
  const after = await jsonEvidence(page);
  expect(after.events).toEqual(before.events);
  expect(after.research.calculation.coverage.reference).toEqual(before.research.calculation.coverage.reference);
  expect(after.research.selectedMomentTransit?.at).toMatchObject({ utc: expect.stringMatching(/^2024-04-16/) });
  await page.getByRole('radio', { name: 'Chart snapshot' }).check();
  await expect(page.locator('#export-moment')).toContainText('2024-04-16');
  await expect(page.getByRole('button', { name: 'Prepare export', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: 'Events research' }).check();
  await goTo(page, 'chart');
  await page.getByRole('button', { name: 'Interpret my birth chart' }).click();
  await page.getByRole('link', { name: 'Continue in AI Export Studio' }).click();
  await expect(page).toHaveURL(/#export$/);
  await expect(page.getByRole('radio', { name: 'Chart snapshot' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Prepare export', exact: true })).toBeEnabled();
});
