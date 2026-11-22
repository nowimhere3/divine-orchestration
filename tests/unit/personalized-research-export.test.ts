import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, expect, test } from 'vitest';
import type { Chart } from '../../src/domain/chart';
import type { EventMoment } from '../../src/domain/event';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import { buildPersonalizedResearchPackage, buildResearchPackage, validateResearchPackage } from '../../src/export/research-package';
import type { ResearchExportEventV2 } from '../../src/export/research-package';
import {
  buildRangeSearchRequest, createCustomSearchQuery, createEverythingQuery, createLifeThemesQuery, createResearchSession, resolveChartFactors, resolveResearchFocus,
} from '../../src/research';
import { freezeResearchSelection, rankResearchSelection } from '../../src/research/export-selection';
import type { ResearchDisplayFilters, ResearchSelection } from '../../src/research/export-selection';
import { searchEventRange } from '../../src/search/range';
import type { RangeEvent } from '../../src/search/range';
import { resolveBirthTime } from '../../src/time/resolve';
import { calculateNatal } from '../../src/view/chart-data';

const dates = { startDate: '2026-01-01', endDate: '2026-01-23' };
const query = createEverythingQuery(dates);
const sentinel = 'private-HC-synthetic-124';
const display: ResearchDisplayFilters = {
  scope: 'all', category: 'all', sort: 'impact', minimumImpact: 72, top: null, showMoon: true, matchTheme: false, multiThemeOnly: false,
};
let chart: Chart;
let session: ReturnType<typeof createResearchSession>;
let realSession: ReturnType<typeof createResearchSession>;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const engine = await createEphemeraEngine(await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm')));
  const resolve = (date: string, time = '00:00') => {
    const result = resolveBirthTime({ date, time, offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
    if (result.kind !== 'resolved') throw new Error('Expected resolved fixture time.');
    return result;
  };
  chart = { ...calculateNatal(engine, resolve('1987-03-14', '07:25'), { latitudeDeg: 51.0447, longitudeDeg: -114.0719 }, 'Placidus'), label: sentinel };
  const startTt = resolve(dates.startDate).jdTt;
  const endTt = resolve(dates.endDate).jdTt;
  const focus = resolveResearchFocus(query, resolveChartFactors(chart));
  const request = buildRangeSearchRequest(query, chart, focus, { startTt, endTt, referenceTt: startTt });
  const result = searchEventRange(engine, request);
  realSession = createResearchSession({ chart, query, rangeRequest: request, rawResult: result });
  const at = (day: number): EventMoment => ({
    utc: new Date(Date.UTC(2026, 0, 1) + 86_400_000 * day).toISOString(), jdTt: startTt + day,
    jdUt: result.range.effectiveStart.jdUt! + day,
  });
  const events: RangeEvent[] = Array.from({ length: 124 }, (_, i) => {
    const high = i < 16;
    const planetId = high ? (i % 2 === 0 ? 'saturn' : 'neptune') : 'moon';
    const id = `${sentinel}-${i}`;
    if (i === 15) return { id, kind: 'station', timing: 'future', at: at(6), inNatalHouse: 1,
      turns: 'direct', planet: { chartId: 'transit', planetId: 'saturn' } };
    return {
      id, kind: 'aspect-window', timing: 'future', transit: { chartId: 'transit', planetId }, target: { chartId: 'natal', planetId: 'sun' },
      aspect: high ? 'square' : 'sextile',
      startsAt: at(i / 10), endsAt: at(i / 10 + 7), allowedOrbDeg: 3, clippedStart: false, clippedEnd: false,
      passes: [{
        at: at(2 + i / 10), state: !high && i % 2 === 0 ? 'near-miss' : 'refined', residualDeg: !high && i % 2 === 0 ? 1 : 0,
        toleranceDeg: 0.00001, retrograde: false, passNumberInSeries: !high && i % 2 === 0 ? null : 1,
      }],
      series: {
        id: i === 0 || i === 2 ? `${sentinel}-return` : `${id}-series`, branchLongitudeDeg: 0,
        windowIndex: i === 2 ? 1 : 0, windowCountInRange: i === 0 || i === 2 ? 2 : 1,
        exactPassCountInRange: i === 0 || i === 2 ? 2 : 1, isRetrogradeSeries: i === 0 || i === 2,
        complete: true, clippedStart: false, clippedEnd: false,
      },
    };
  });
  session = createResearchSession({ chart, query, rangeRequest: request, rawResult: { ...result, events } });
});

function freeze(filters: Partial<ResearchDisplayFilters> = {}, bound = session): ResearchSelection {
  const { selection } = rankResearchSelection(bound, { ...display, ...filters });
  return freezeResearchSelection({ ...selection, overlap: { minimumImpact: 65, includeMoonMarkers: true } });
}

test('124 original events → Impact 72 → exactly 16 exported with reconciled references', async () => {
  const frozen = freeze();
  expect(frozen.stages).toEqual({ inViewScope: 124, afterDisplayFilters: 124, afterImpact: 16 });
  expect(frozen.groups).toHaveLength(16);
  expect(Object.isFrozen(frozen.groups[0].linkedIds)).toBe(true);
  const pkg = await buildPersonalizedResearchPackage(frozen, chart, { scope: 'current', partByteBudget: 10500 });
  const verified = await validateResearchPackage([...pkg.files].reverse(), pkg.zip.bytes);
  expect(pkg.document.research.personalized.selection).toMatchObject({
    scope: 'current', filters: { minimumImpact: 72 },
    counts: { current: 16, complete: 124, exported: 16, excludedFromComplete: 108, distinctCycles: 15 },
    currentExclusions: { outsideViewScope: 0, displayFilters: 0, impactCutoff: 108, topLimit: 0, linkedEvidence: 0 },
  });
  expect(pkg.document.schemaVersion).toBe(2);
  expect(pkg.files.length).toBeGreaterThan(2);
  expect(verified.events.map(event => Number(event.id.slice(6))).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  expect(verified.events.every(event => (event as ResearchExportEventV2).personalImpact.total >= 72)).toBe(true);
  const { overlaps, strongest } = pkg.document.research.personalized.overview;
  expect(overlaps.totalPeriods).toBeGreaterThan(0);
  const allowed = new Set(verified.events.map(event => event.id));
  expect(overlaps.highlights.flatMap(period => [...period.eventIds, ...period.markers.map(marker => marker.eventId)])
    .every(id => allowed.has(id))).toBe(true);
  expect(strongest.every(event => allowed.has(event.eventId))).toBe(true);
  const serialized = pkg.files.map(file => new TextDecoder().decode(file.bytes)).join('');
  expect(serialized).not.toContain(sentinel);
  expect(serialized).not.toContain(dates.startDate);
  expect(serialized).not.toContain('1987-03-14');
  expect(serialized).toContain('offsetTtDays');
  const [root, ...parts] = pkg.files;
  const forged = JSON.parse(new TextDecoder().decode(root.bytes));
  forged.research.personalized.overview.overlaps.highlights[0].eventIds[0] = 'event-124';
  await expect(validateResearchPackage([{ name: root.name, bytes: new TextEncoder().encode(JSON.stringify(forged)) }, ...parts]))
    .rejects.toThrow(/overlap evidence/i);
});

test('reconciles cached Moon exclusion, custom factors, computation switches and display exclusions separately', async () => {
  const custom = createCustomSearchQuery({ ...dates, includeMoon: false, includeStations: false, includeNatalPlanets: ['sun'], excludeHouses: [5] });
  const bound = createResearchSession({ chart, query: custom, rangeRequest: session.rangeRequest, rawResult: session.rawResult });
  const pkg = await buildPersonalizedResearchPackage(freeze({ category: 'station' }, bound), chart, { scope: 'current' });
  const { document, events } = await validateResearchPackage(pkg.files, pkg.zip.bytes);
  expect(events).toEqual([]);
  expect(document.research.scope.counts).toMatchObject({ calculated: 124, outsideCalculatedBodyScope: 108, outsideExportComputationScope: 1 });
  expect(document.research.scope.moon).toEqual({ requested: false, included: false, calculated: true });
  expect(document.research.query.focus).toMatchObject({ includeNatalPlanets: ['sun'], excludeHouses: [5] });
  expect(pkg.document.research.personalized.selection).toMatchObject({
    counts: { complete: 15, exported: 0 },
    currentExclusions: { displayFilters: 15 },
  });
});

test('distinguishes current, relevant, complete, Off, 0, 100 and category/Moon scope', async () => {
  const off = freeze({ minimumImpact: null });
  expect(off.groups).toEqual(freeze({ minimumImpact: 0 }).groups);
  expect(off.groups).toHaveLength(124);
  expect(freeze({ category: 'station' }).groups).toHaveLength(1);
  expect(freeze({ category: 'exact', minimumImpact: 0 }).groups).toHaveLength(70);
  expect(freeze({ showMoon: false, minimumImpact: 0 }).groups).toHaveLength(16);
  const empty = await buildPersonalizedResearchPackage(freeze({ minimumImpact: 100 }), chart, { scope: 'current' });
  expect((await validateResearchPackage(empty.files, empty.zip.bytes)).events).toEqual([]);
  expect(empty.document.research.personalized.selection.counts).toMatchObject({ exported: 0, complete: 124 });
  const focusedQuery = createLifeThemesQuery({ ...dates, activeThemeIds: ['finances'], includeHouses: [2] });
  const themed = createResearchSession({ chart, query: focusedQuery, rangeRequest: session.rangeRequest, rawResult: session.rawResult });
  const frozen = freeze({ scope: 'relevant', category: 'station', showMoon: false }, themed);
  const relevant = await buildPersonalizedResearchPackage(frozen, chart, { scope: 'relevant' });
  const complete = await buildPersonalizedResearchPackage(frozen, chart, { scope: 'complete' });
  expect(relevant.document.research.personalized.selection.counts.exported).toBe(themed.evaluated.relevant.length);
  expect(complete.document.research.personalized.selection.counts.exported).toBe(124);
  expect(complete.document.research.query.focus).toMatchObject({ includeHouses: [2], activeThemeIds: ['theme-1'] });
  for (const pkg of [relevant, complete]) await validateResearchPackage(pkg.files, pkg.zip.bytes);
});

test('keeps linked returns optional and uses stable event and cycle IDs across scopes', async () => {
  const frozen = freeze({ top: 10 });
  expect(frozen.groups).toHaveLength(10);
  expect(frozen.groups.flatMap(group => group.linkedIds)).toHaveLength(1);
  const base = await buildPersonalizedResearchPackage(frozen, chart, { scope: 'current' });
  const linked = await buildPersonalizedResearchPackage(frozen, chart, { scope: 'current', includeLinked: true });
  const before = (await validateResearchPackage(base.files)).events as readonly ResearchExportEventV2[];
  const after = (await validateResearchPackage(linked.files)).events as readonly ResearchExportEventV2[];
  expect(before).toHaveLength(10);
  expect(after).toHaveLength(11);
  const returned = after.find(event => event.selection.role === 'linked')!;
  expect(before.find(event => event.id === returned.selection.representativeId)?.cycleId).toBe(returned.cycleId);
  expect(after.filter(event => event.selection.role === 'primary')).toEqual(before);
  expect(base.document.research.personalized.selection.currentExclusions).toMatchObject({ topLimit: 5, linkedEvidence: 1 });
  expect(linked.document.research.personalized.selection.currentExclusions).toMatchObject({ topLimit: 5, linkedEvidence: 0 });
  await expect(buildPersonalizedResearchPackage({ ...frozen, groups: frozen.groups.slice(1) }, chart, { scope: 'current' }))
    .rejects.toThrow(/differs from the ranked Events results/);
  await expect(buildPersonalizedResearchPackage(frozen, { ...chart, id: 'another-chart' }, { scope: 'current' }))
    .rejects.toThrow(/no longer matches/);
});

test('projects real folded-axis evidence across privacy choices and preserves legacy V1', async () => {
  const frozen = freeze({ minimumImpact: null }, realSession);
  const v1 = await buildResearchPackage(realSession, chart, { mode: 'complete', partByteBudget: null, privacy: { eventDates: 'omit' } });
  const legacy = await validateResearchPackage(v1.files, v1.zip.bytes);
  const omitted = await buildPersonalizedResearchPackage(frozen, chart, { scope: 'complete', format: 'markdown', privacy: { eventDates: 'omit' } });
  const modern = await validateResearchPackage(omitted.files, omitted.zip.bytes);
  expect(legacy.document.schemaVersion).toBe(1);
  expect(modern.events.map(event => ({ id: event.id, facts: event.facts, axisCompanions: event.axisCompanions })))
    .toEqual(legacy.events.map(event => ({ id: event.id, facts: event.facts, axisCompanions: event.axisCompanions })));
  expect(modern.events.some(event => event.axisCompanions.length > 0)).toBe(true);
  expect(modern.events.every(event => event.orderAt === null)).toBe(true);
  const omittedText = new TextDecoder().decode(omitted.zip.bytes);
  expect(omittedText).not.toContain(dates.startDate);
  expect(omittedText).not.toContain('offsetTtDays');
  const relativeFull = await buildPersonalizedResearchPackage(freeze(), chart, { scope: 'current', privacy: { birthDetails: 'full' } });
  expect(relativeFull.document.research.privacy).toEqual({ birthDetails: 'full', eventDates: 'relative' });
  expect(new TextDecoder().decode(relativeFull.zip.bytes)).toContain('1987-03-14');
  const calendar = await buildPersonalizedResearchPackage(freeze(), chart, { scope: 'current', privacy: { eventDates: 'calendar' } });
  expect(new TextDecoder().decode(calendar.zip.bytes)).toContain(dates.startDate);
  expect(new TextDecoder().decode(calendar.zip.bytes)).not.toContain('1987-03-14');
  await validateResearchPackage(calendar.files, calendar.zip.bytes);
});
