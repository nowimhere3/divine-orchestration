import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
import { beforeAll, expect, test } from 'vitest';
import { createAspectRuleSet } from '../../src/domain/aspects';
import type { Chart, ChartWarning, TimedChart } from '../../src/domain/chart';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import type { EphemeraEngine } from '../../src/engine/ephemera';
import { buildResearchPackage, toResearchDownloadFile, validateResearchPackage } from '../../src/export/research-package';
import type { ResearchExportEventV1 } from '../../src/export/research-package';
import { createSnapshotV0, serializeSnapshot, toSnapshotV0Events } from '../../src/export/snapshot';
import { createThemeRegistry } from '../../src/knowledge/research-themes';
import {
  buildRangeSearchRequest, createEverythingQuery, createLifeThemesQuery, createResearchSession,
  reEvaluateResearchSession, resolveChartFactors, resolveResearchFocus,
} from '../../src/research';
import type { ResearchQuery, ResearchSession } from '../../src/research';
import { searchEventRange } from '../../src/search/range';
import type { RangeEvent, RangeSearchWarning } from '../../src/search/range';
import { resolveBirthTime } from '../../src/time/resolve';
import { calculateNatal } from '../../src/view/chart-data';

const START = '2026-01-01';
const END = '2027-01-01';
const BIRTH = '1987-03-14';
const SECRET = 'private-sentinel-314159';
const THEME_ID = `theme-${SECRET}`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bodyOf = (event: RangeEvent) => 'transit' in event ? event.transit.planetId : event.planet.planetId;
const registry = createThemeRegistry().upsert({
    id: THEME_ID, label: SECRET, description: `${SECRET} description`, conventionNote: `${SECRET} note`,
    houses: [4, 8, 12], naturalSignificators: ['moon', 'venus'], angles: ['ic'],
});

let engine: EphemeraEngine;
let chart: Chart;
let year: ResearchSession;
let selectedTransitChart: TimedChart;

function utc(date: string) {
  const instant = resolveBirthTime({ date, time: '00:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  if (instant.kind !== 'resolved') throw new Error('Expected resolved UTC test instant.');
  return instant;
}

function run(query: ResearchQuery, natal: Chart = chart) {
  const chartFactors = resolveChartFactors(natal, { rulershipPolicy: query.focus.rulershipPolicy });
  const focus = resolveResearchFocus(query, chartFactors, registry);
  const rangeRequest = buildRangeSearchRequest(query, natal, focus, {
    startTt: utc(query.range.startDate).jdTt, endTt: utc(query.range.endDate).jdTt, referenceTt: utc(START).jdTt,
    transitChartId: `transit-${SECRET}`,
  });
  return createResearchSession({ chart: natal, query, rangeRequest, rawResult: searchEventRange(engine, rangeRequest), registry });
}

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  engine = await createEphemeraEngine(await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm')));
  const born = resolveBirthTime({ date: BIRTH, time: '07:25', timeZone: 'America/Edmonton' }, engine.modelDeltaTSeconds);
  if (born.kind !== 'resolved') throw new Error('Expected resolved birth time.');
  chart = {
    ...calculateNatal(engine, born, { latitudeDeg: 51.0447, longitudeDeg: -114.0719 }, 'Placidus'),
    id: `natal-${SECRET}-${BIRTH}`, label: SECRET,
  };
  const rendered = calculateNatal(engine, utc('2026-06-15'), null, 'WholeSign');
  if (rendered.time.kind !== 'resolved') throw new Error('Expected resolved transit chart.');
  selectedTransitChart = { ...rendered, kind: 'transit', time: rendered.time, id: `transit-${SECRET}`, label: SECRET };
  year = run(createLifeThemesQuery({
    startDate: START, endDate: END, preset: '12m', includeMoon: true,
    activeThemeIds: ['projects-craft', 'relationships', THEME_ID], rulershipPolicy: 'traditional-plus-modern',
  }));
}, 30_000);

function checkCalendarFacts(facts: ResearchExportEventV1['facts'], original: RangeEvent) {
  expect(facts).toMatchObject({ kind: original.kind, timing: original.timing });
  if ('passes' in facts && 'passes' in original) {
    const { id: _originalSeriesId, ...series } = original.series;
    expect(facts).toMatchObject({
      aspect: original.aspect, allowedOrbDeg: original.allowedOrbDeg, startsAt: original.startsAt, endsAt: original.endsAt,
      clippedStart: original.clippedStart, clippedEnd: original.clippedEnd, passes: original.passes, series,
    });
  } else if ('at' in facts && 'at' in original) {
    expect(facts.at).toEqual(original.at);
  }
}

test('complete calendar export preserves every event in a real all-body, 12-month session', async () => {
  const built = await buildResearchPackage(year, chart, { mode: 'complete', privacy: { eventDates: 'calendar' } });
  const { document, events } = await validateResearchPackage(built.files, built.zip.bytes);
  expect(document.schema).toBe('divine-orchestration/research-manifest');
  expect(events.length).toBeGreaterThan(1_000);
  expect(events).toHaveLength(year.evaluated.all.length);
  const { scope, calculation, query } = document.research;
  expect(scope.counts.exported.byKind).toEqual(year.evaluated.counts.byKind);
  expect(Object.values(scope.counts.exported.byKind).every(count => count > 0)).toBe(true);
  expect(scope.counts.exported.axisCompanions).toBe(year.evaluated.counts.axisDuplicatesMerged);
  expect(scope.counts.calculated).toBe(year.rawResult.events.length);
  expect(scope.moon).toEqual({ requested: true, included: true, calculated: true });
  expect(query.range).toEqual({ preset: '12m', startDate: START, endDate: END });
  expect(calculation.coverage).toMatchObject({
    requestedStart: year.rawResult.range.requestedStart, requestedEnd: year.rawResult.range.requestedEnd,
    effectiveStart: year.rawResult.range.effectiveStart, effectiveEnd: year.rawResult.range.effectiveEnd,
    clippedToCoverage: false, coversRequestedInterval: true,
  });
  const byId = new Map(year.evaluated.all.map(item => [item.event.id, item]));
  const rawById = new Map(year.rawResult.events.map(event => [event.id, event]));
  const timestamps: number[] = [];
  const identities = new Set<string>();
  for (const event of events) {
    const original = year.rawResult.events[Number(event.id.slice(6)) - 1];
    const evaluated = byId.get(original.id)!;
    expect(evaluated).toBeDefined();
    expect(identities.has(event.id)).toBe(false);
    identities.add(event.id);
    checkCalendarFacts(event.facts, original);
    if (event.facts.kind === 'station' && original.kind === 'station') {
      expect(event.facts).toMatchObject({
        planetId: original.planet.planetId, turns: original.turns, inNatalHouse: original.inNatalHouse,
        residualDegPerDay: year.rawResult.stationResidualsDegPerDay[original.id],
      });
    }
    if (event.facts.kind === 'house-ingress' && original.kind === 'house-ingress') {
      expect(event.facts).toMatchObject({
        planetId: original.planet.planetId, fromHouse: original.fromHouse, toHouse: original.toHouse,
        cuspHouseId: original.cuspHouseId, retrograde: original.retrograde, houseSystem: original.houseSystem,
      });
    }
    expect(event.relevance.rawScore).toBe(evaluated.relevance.rawScore);
    expect(event.relevance.matchedHouses).toEqual(evaluated.relevance.matchedHouses);
    expect(event.relevance.matchedThemeIds).toHaveLength(evaluated.relevance.matchedThemeIds.length);
    expect(event.relevance.reasons.map(r => [r.code, r.points])).toEqual(evaluated.relevance.reasons.map(r => [r.code, r.points]));
    const calculatedCompanions = year.evaluated.calculatedAxisCompanionIds.get(original.id) ?? [];
    expect(event.axisCompanions).toHaveLength(calculatedCompanions.length);
    for (const [index, companion] of event.axisCompanions.entries()) {
      const rawCompanion = rawById.get(calculatedCompanions[index]);
      if (rawCompanion?.kind !== 'angle-aspect-window') throw new Error('Expected a calculated angle companion.');
      checkCalendarFacts(companion, rawCompanion);
      expect(companion.targetAngle).toBe(rawCompanion.targetAngle);
      expect(companion.allowedOrbDeg).toBe(rawCompanion.allowedOrbDeg);
    }
    timestamps.push(('at' in original ? original.at : original.startsAt ?? year.rawResult.range.effectiveStart).jdTt!);
  }
  expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  expect(events.some(({ facts }) => 'series' in facts && facts.series.isRetrogradeSeries)).toBe(true);
  expect(events.some(({ facts }) => 'series' in facts && !facts.series.complete)).toBe(true);
  expect(events.some(({ facts, axisCompanions }) => 'allowedOrbDeg' in facts &&
    axisCompanions.some(companion => companion.allowedOrbDeg !== facts.allowedOrbDeg))).toBe(true);
  expect(events.some(event => event.axisCompanions.length >
    byId.get(year.rawResult.events[Number(event.id.slice(6)) - 1].id)!.axisCompanions.length)).toBe(true);
}, 25_000);

test('focus and broader-context policy preserve stable IDs and explicit Moon exclusions on reused results', async () => {
  const focused = await buildResearchPackage(year, chart, { mode: 'focused', partByteBudget: null });
  const focusedEvents = (await validateResearchPackage(focused.files)).events;
  const relevantIds = new Set(year.evaluated.relevant.map(item => item.event.id));
  expect(focusedEvents.map(event => year.rawResult.events[Number(event.id.slice(6)) - 1].id).every(id => relevantIds.has(id))).toBe(true);
  expect(focusedEvents).toHaveLength(relevantIds.size);
  expect(focused.document.research.scope.counts.omittedBroaderContext).toBe(year.evaluated.counts.broaderContext);
  expect(focused.document.research.chartFactors.houses?.length).toBeLessThan(12);

  const query: ResearchQuery = {
    ...year.query, contextPolicy: { ...year.query.contextPolicy, retainBroaderContext: false },
    computation: { ...year.query.computation, transitingBodies: year.query.computation.transitingBodies.filter(body => body !== 'moon') },
  };
  const noMoon = reEvaluateResearchSession(year, query, chart, registry);
  const complete = await buildResearchPackage(noMoon, chart, { mode: 'complete', partByteBudget: null });
  const { document, events } = await validateResearchPackage(complete.files);
  expect(document.research.scope.moon).toEqual({ requested: false, included: false, calculated: true });
  expect(document.research.scope.counts.outsideCalculatedBodyScope).toBe(year.rawResult.events.filter(event => bodyOf(event) === 'moon').length);
  expect(document.research.scope.counts.exported.moon).toBe(0);
  expect(events).toHaveLength(noMoon.evaluated.relevant.length);
  const focusedById = new Map(focusedEvents.map(event => [event.id, event.facts]));
  expect(events.every(event => focusedById.has(event.id))).toBe(true);

  const customExclusion = reEvaluateResearchSession(year, {
    ...year.query,
    focus: { ...year.query.focus, excludeTransitingBodies: ['moon'] },
    computation: { ...year.query.computation, includeStations: false },
  }, chart, registry);
  const excluded = await buildResearchPackage(customExclusion, chart, { mode: 'complete', partByteBudget: null });
  expect(excluded.document.research.scope.moon).toEqual({ requested: true, included: false, calculated: true });
  expect(excluded.document.research.scope.counts.exported.byKind.station).toBe(0);
});

test('numbered Markdown and JSON parts reconcile and ZIP entries carry exact independent checksums', async () => {
  const options = { mode: 'research-package', partByteBudget: 72_000 } as const;
  const md = await buildResearchPackage(year, chart, { ...options, format: 'markdown' });
  const json = await buildResearchPackage(year, chart, options);
  const verified = await validateResearchPackage([...md.files].reverse(), md.zip.bytes);
  expect(verified.document.schema).toBe('divine-orchestration/research-manifest');
  if (verified.document.schema !== 'divine-orchestration/research-manifest') throw new Error('Expected a multipart manifest.');
  expect(verified.events).toEqual((await validateResearchPackage(json.files, json.zip.bytes)).events);
  expect(md.document.packageId).toBe(json.document.packageId);
  expect(verified.document.parts.length).toBeGreaterThan(2);
  expect(md.estimatedTokens).toBe(md.files.reduce((sum, file) => sum + file.estimatedTokens!, 0));
  let nextIndex = 1;
  for (const [i, entry] of verified.document.parts.entries()) {
    const file = md.files[i + 1];
    expect(entry.eventIndexRange).toEqual([nextIndex, nextIndex + entry.eventCount - 1]);
    nextIndex += entry.eventCount;
    expect(entry.filename).toBe(file.name);
    expect(entry.bytes).toBeLessThanOrEqual(options.partByteBudget);
    expect(entry.exceedsPartBudget).toBe(false);
    expect(entry.sha256).toBe(createHash('sha256').update(file.bytes).digest('hex'));
  }
  expect(nextIndex).toBe(verified.events.length + 1);
  expect(decoder.decode(md.files[0].bytes)).toContain('If the entire package exceeds the model');
  expect(toResearchDownloadFile(md.zip)).toMatchObject({ name: md.zip.name, type: 'application/zip', size: md.zip.bytes.length });

  const { bytes } = md.zip;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const end = bytes.length - 22;
  expect(u32(end)).toBe(0x06054b50);
  expect(u16(end + 10)).toBe(md.files.length);
  let directory = u32(end + 16);
  let local = 0;
  for (const file of md.files) {
    const nameLength = u16(local + 26);
    const start = local + 30 + nameLength;
    expect(u32(local)).toBe(0x04034b50);
    expect(u16(local + 6)).toBe(0x800);
    expect(u16(local + 8)).toBe(0);
    expect(u32(local + 18)).toBe(file.bytes.length);
    expect(decoder.decode(bytes.subarray(local + 30, start))).toBe(file.name);
    const payload = bytes.subarray(start, start + file.bytes.length);
    expect(Buffer.compare(payload, file.bytes)).toBe(0);
    expect(crc32(payload)).toBe(u32(local + 14));
    expect(u32(directory)).toBe(0x02014b50);
    expect(u32(directory + 16)).toBe(crc32(payload));
    expect(u32(directory + 42)).toBe(local);
    expect(decoder.decode(bytes.subarray(directory + 46, directory + 46 + nameLength))).toBe(file.name);
    directory += 46 + nameLength;
    local = start + file.bytes.length;
  }
  expect(local).toBe(u32(end + 16));
  expect(directory).toBe(end);

  const corruptedPart = { ...md.files[1], bytes: md.files[1].bytes.slice() };
  corruptedPart.bytes[0] ^= 1;
  await expect(validateResearchPackage([md.files[0], corruptedPart, ...md.files.slice(2)])).rejects.toThrow(/checksum/i);
  await expect(validateResearchPackage(md.files.slice(0, -1))).rejects.toThrow(/file count/i);
  const changedManifest = decoder.decode(json.files[0].bytes).replace('"completeForSelectedScope":true', '"completeForSelectedScope":false');
  await expect(validateResearchPackage([{ name: json.files[0].name, bytes: encoder.encode(changedManifest) }, ...json.files.slice(1)]))
    .rejects.toThrow(/accounting/i);
  const corruptedZip = md.zip.bytes.slice();
  corruptedZip[0] ^= 1;
  await expect(validateResearchPackage(md.files, corruptedZip)).rejects.toThrow(/ZIP contents/i);
}, 25_000);

test('privacy projects each timing policy, regenerates prose and suppresses arbitrary private strings', async () => {
  const small = run(createLifeThemesQuery({
    startDate: START, endDate: '2026-01-05', activeThemeIds: [THEME_ID, `unknown-${SECRET}`], includeMoon: true,
  }));
  const tampered: ResearchSession = {
    ...small, sessionId: SECRET, computeCacheKey: SECRET,
    rawResult: {
      ...small.rawResult,
      warnings: [...small.rawResult.warnings, SECRET as RangeSearchWarning],
      provenance: {
        ...small.rawResult.provenance,
        engine: { ...small.rawResult.provenance.engine!, name: SECRET as 'Ephemera' },
      },
    },
    chartFactors: { ...small.chartFactors, sensitivityNotes: [SECRET] },
    evaluated: {
      ...small.evaluated,
      all: small.evaluated.all.map(item => ({
        ...item, relevance: {
          ...item.relevance, whyRelevant: SECRET,
          reasons: item.relevance.reasons.map(reason => ({ ...reason, summary: SECRET, params: { ...reason.params, private: SECRET } })),
        },
      })),
    },
  };

  for (const birthDetails of ['redacted', 'full'] as const) {
    for (const eventDates of ['relative', 'calendar', 'omit'] as const) {
      const built = await buildResearchPackage(tampered, { ...chart, warnings: [SECRET as ChartWarning] }, {
        mode: 'research-package', format: eventDates === 'calendar' ? 'json' : 'markdown',
        privacy: { birthDetails, eventDates }, partByteBudget: null,
        interpretations: { includeNatal: true, selectedTransitChart },
      });
      const { document, events } = await validateResearchPackage(built.files, built.zip.bytes);
      const texts = built.files.map(file => decoder.decode(file.bytes)).join('\n');
      expect(texts).not.toContain(SECRET);
      expect(texts.includes(BIRTH)).toBe(birthDetails === 'full');
      expect(texts.includes('America/Edmonton')).toBe(birthDetails === 'full');
      expect(texts.includes('-114.0719')).toBe(birthDetails === 'full');
      expect(texts.includes(START)).toBe(eventDates === 'calendar');
      expect(texts.includes('2026-06-15')).toBe(eventDates === 'calendar');
      expect(document.research.snapshot).toMatchObject({ schemaVersion: 0, engine: null, context: { eventSearch: null, selectedAt: null } });
      expect(document.research.natalSynthesis).toBe('included');
      expect(document.research.selectedMomentTransit?.status).toBe('included');
      const offset = selectedTransitChart.time.jdTt - small.rawResult.settings.startTt;
      if (eventDates === 'relative') {
        expect(document.research.calculation.coverage.requestedStart).toEqual({ offsetTtDays: 0 });
        expect(document.research.selectedMomentTransit?.at).toEqual({ offsetTtDays: offset });
        for (const event of events) {
          const raw = small.rawResult.events[Number(event.id.slice(6)) - 1];
          const timestamp = ('at' in raw ? raw.at : raw.startsAt ?? small.rawResult.range.effectiveStart).jdTt!;
          expect(event.orderAt).toEqual({ offsetTtDays: timestamp - small.rawResult.settings.startTt });
        }
      } else if (eventDates === 'omit') {
        expect(events.every(event => event.orderAt === null)).toBe(true);
        expect(document.research.selectedMomentTransit?.at).toBeNull();
      }
    }
  }
  await expect(buildResearchPackage(small, { ...chart, id: 'another-chart' }, { mode: 'complete' })).rejects.toThrow(/no longer matches/i);
});

test('clipped and unavailable calculations, tiny budgets and SnapshotV0 preserve their explicit boundaries', async () => {
  const clipped = run(createEverythingQuery({
    startDate: '1549-12-21', endDate: '1550-01-08', transitingBodies: ['saturn'],
  }));
  const tiny = await buildResearchPackage(clipped, chart, { mode: 'research-package', partByteBudget: 1 });
  const { document } = await validateResearchPackage(tiny.files, tiny.zip.bytes);
  expect(document.research.calculation.coverage).toMatchObject({
    requestedStart: { offsetTtDays: 0 }, clippedToCoverage: true, coversRequestedInterval: false,
  });
  expect(document.research.calculation.status).toBe('partial');
  if (document.schema !== 'divine-orchestration/research-manifest') throw new Error('Expected a multipart manifest.');
  expect(document.parts.every(part => part.exceedsPartBudget && part.eventCount <= 1)).toBe(true);
  const absent = run(createEverythingQuery({ startDate: '1500-01-01', endDate: '1500-01-04', transitingBodies: ['saturn'] }));
  const empty = await buildResearchPackage(absent, chart, { mode: 'research-package' });
  expect((await validateResearchPackage(empty.files, empty.zip.bytes)).events).toEqual([]);
  expect(empty.document.research.calculation).toMatchObject({ status: 'unavailable', reason: 'outside-coverage' });

  const projected = toSnapshotV0Events(year.rawResult.events);
  expect(projected).toHaveLength(year.rawResult.events.filter(event => event.kind === 'station' || event.kind === 'aspect-window').length);
  expect(projected.every(event => !('series' in event) && !('inNatalHouse' in event))).toBe(true);
  const snapshotInput = {
    charts: [chart, selectedTransitChart], aspects: [], aspectRules: createAspectRuleSet(),
    engine: { name: SECRET, dataMode: SECRET, version: SECRET, frame: SECRET },
    context: { selectedAt: null, referenceAt: null, eventSearch: null },
  };
  expect(serializeSnapshot(createSnapshotV0(snapshotInput))).toContain(SECRET);
  const redacted = createSnapshotV0({
    ...snapshotInput, charts: [{ ...chart, warnings: ['modeled-delta-t', SECRET as ChartWarning] }],
  }, { redactBirthDetails: true });
  expect(redacted.charts[0].warnings).toContain('modeled-delta-t');
  expect(serializeSnapshot(redacted)).not.toContain(SECRET);
});

test('date-only natal synthesis uses the existing local path and produces deterministic safe files', async () => {
  const born = resolveBirthTime({ date: BIRTH, time: null, timeZone: 'America/Edmonton' }, engine.modelDeltaTSeconds);
  if (born.kind !== 'unknown-time') throw new Error('Expected a date-only natal chart.');
  const natal = calculateNatal(engine, born, null, 'Placidus');
  const session = run(createEverythingQuery({ startDate: START, endDate: '2026-01-07', includeMoon: false }), natal);
  const options = {
    mode: 'research-package', format: 'markdown', interpretations: { includeNatal: true, dateOnlyEngine: engine },
  } as const;
  const packageA = await buildResearchPackage(session, natal, options);
  const packageB = await buildResearchPackage(session, natal, options);
  const { document, events } = await validateResearchPackage(packageA.files, packageA.zip.bytes);
  expect(packageA.zip.sha256).toBe(packageB.zip.sha256);
  expect(Buffer.compare(packageA.zip.bytes, packageB.zip.bytes)).toBe(0);
  expect(document.research.natalSynthesis).toBe('included');
  expect(document.research.snapshot.interpretations.some(item => item.description.includes('Date-only natal reading'))).toBe(true);
  expect(document.research.chartFactors.availability).toMatchObject({
    timeStatus: 'unknown-time', natalPositionsAvailable: false, housesAvailable: false,
  });
  expect(document.research.chartFactors.houses).toBeNull();
  expect(events.every(event => event.facts.kind === 'station')).toBe(true);
  expect(decoder.decode(packageA.zip.bytes)).not.toContain(BIRTH);
});
