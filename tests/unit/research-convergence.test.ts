import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, expect, test } from 'vitest';
import type { Chart, PlanetId } from '../../src/domain/chart';
import type { EventMoment } from '../../src/domain/event';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import { buildResearchPackage } from '../../src/export/research-package';
import {
  buildRangeSearchRequest, createCustomSearchQuery, createEverythingQuery, createLifeThemesQuery, createResearchSession,
  findResearchConvergences, reEvaluateResearchSession, resolveChartFactors, resolveResearchFocus, scoreResearchImpact,
} from '../../src/research';
import type { ResearchSession } from '../../src/research';
import { searchEventRange } from '../../src/search/range';
import type { AngleAspectWindowEvent, EventSeriesMeta, RangeAspectPass, RangeAspectWindowEvent, RangeEvent } from '../../src/search/range';
import { resolveBirthTime } from '../../src/time/resolve';
import { calculateNatal } from '../../src/view/chart-data';
import { matchesRangeFilter } from '../../src/view/event-model';

const dates = { startDate: '2026-01-01', endDate: '2027-01-01' };
const query = createEverythingQuery(dates);
let chart: Chart;
let realSession: ResearchSession;
let origin: number;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const engine = await createEphemeraEngine(await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm')));
  const born = resolveBirthTime({ date: '1987-03-14', time: '07:25', timeZone: 'America/Edmonton' }, engine.modelDeltaTSeconds);
  const end = resolveBirthTime({ date: dates.endDate, time: '00:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  const start = resolveBirthTime({ date: dates.startDate, time: '00:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  if (born.kind !== 'resolved' || start.kind !== 'resolved' || end.kind !== 'resolved') throw new Error('Expected resolved fixture times.');
  chart = calculateNatal(engine, born, { latitudeDeg: 51.0447, longitudeDeg: -114.0719 }, 'Placidus');
  const focus = resolveResearchFocus(query, resolveChartFactors(chart));
  const rangeRequest = buildRangeSearchRequest(query, chart, focus, { startTt: start.jdTt, endTt: end.jdTt, referenceTt: start.jdTt });
  realSession = createResearchSession({ chart, query, rangeRequest, rawResult: searchEventRange(engine, rangeRequest) });
  origin = start.jdTt;
});

function at(day: number): EventMoment {
  return { jdTt: origin + day, jdUt: null, utc: null };
}

function pass(day: number, passNumberInSeries = 1): RangeAspectPass {
  return { at: at(day), residualDeg: 0, state: 'refined', toleranceDeg: 0.00001, retrograde: false, passNumberInSeries };
}

function series(id: string): EventSeriesMeta {
  return {
    id, branchLongitudeDeg: 0, windowIndex: 0, windowCountInRange: 1, exactPassCountInRange: 1,
    isRetrogradeSeries: false, clippedStart: false, clippedEnd: false, complete: true,
  };
}

function aspect(id: string, body: PlanetId, start: number, end: number, passes = [pass((start + end) / 2)]): RangeAspectWindowEvent {
  return {
    id, kind: 'aspect-window', timing: 'future', transit: { chartId: 'transit', planetId: body },
    target: { chartId: 'natal', planetId: 'sun' }, aspect: 'conjunction',
    startsAt: at(start), endsAt: at(end), clippedStart: false, clippedEnd: false, allowedOrbDeg: 2,
    passes, series: series(id),
  };
}

function axis(id: string, body: PlanetId, start: number, end: number, targetAngle: AngleAspectWindowEvent['targetAngle'],
  type: AngleAspectWindowEvent['aspect'], allowedOrbDeg: number, exactDay: number): AngleAspectWindowEvent {
  return {
    id, kind: 'angle-aspect-window', timing: 'future', transit: { chartId: 'transit', planetId: body },
    targetChartId: 'natal', targetAngle, aspect: type, startsAt: at(start), endsAt: at(end),
    clippedStart: false, clippedEnd: false, allowedOrbDeg, passes: [pass(exactDay)], series: series(id),
  };
}

function station(day: number): RangeEvent {
  return { id: 'station', kind: 'station', timing: 'future', planet: { chartId: 'transit', planetId: 'saturn' },
    at: at(day), turns: 'retrograde', inNatalHouse: 4 };
}

function ingress(day: number): RangeEvent {
  return { id: 'ingress', kind: 'house-ingress', timing: 'future', planet: { chartId: 'transit', planetId: 'mars' },
    at: at(day), targetChartId: 'natal', cuspHouseId: 4, fromHouse: 3, toHouse: 4, retrograde: false, houseSystem: 'Placidus' };
}

function bind(events: readonly RangeEvent[], activeQuery = query, partial = false) {
  return createResearchSession({
    chart, query: activeQuery, rangeRequest: realSession.rangeRequest,
    rawResult: { ...realSession.rawResult, events, status: partial ? 'partial' : 'complete' },
  });
}

const bounds = (period: { start: EventMoment; end: EventMoment }) => [period.start.jdTt! - origin, period.end.jdTt! - origin];

test('keeps exact contributing membership while counting a body only once', () => {
  const session = bind([
    aspect('saturn', 'saturn', 1, 8),
    aspect('second-saturn', 'saturn', 6, 7),
    aspect('neptune', 'neptune', 5, 10),
    aspect('pluto', 'pluto', 7, 9),
  ]);
  const result = findResearchConvergences(session);
  expect(result.minimumImpact).toBe(65);
  expect(result.periods).toHaveLength(1);
  const [period] = result.periods;
  expect(bounds(period)).toEqual([5, 9]);
  expect(period).toMatchObject({ peakConcurrentBodies: 3, observedDays: 4, complete: true, bodies: ['saturn', 'neptune', 'pluto'] });
  expect(period.contacts.map(c => c.calculatedEventIds[0])).toEqual(['saturn', 'second-saturn', 'neptune', 'pluto']);
  expect(period.segments.map(s => [bounds(s), s.bodies, s.contactKeys])).toEqual([
    [[5, 6], ['saturn', 'neptune'], ['0', '2']],
    [[6, 7], ['saturn', 'neptune'], ['0', '1', '2']],
    [[7, 8], ['saturn', 'neptune', 'pluto'], ['0', '2', '3']],
    [[8, 9], ['neptune', 'pluto'], ['2', '3']],
  ]);
  expect(findResearchConvergences(session, { minimumImpact: 100 }).periods).toEqual([]);
  expect(() => findResearchConvergences(session, { minimumImpact: NaN })).toThrow(RangeError);
  expect(findResearchConvergences(bind([aspect('a', 'saturn', 1, 8), aspect('b', 'saturn', 2, 7)])).periods).toEqual([]);
});

test('uses the union of folded ASC/DSC and MC/IC windows and deduplicates their passes', () => {
  const asc = axis('asc', 'saturn', 1, 8, 'asc', 'sextile', 4, 6);
  const dsc = axis('dsc', 'saturn', 0, 9, 'dsc', 'trine', 5, 6);
  const mc = axis('mc', 'neptune', 5, 11, 'mc', 'square', 3, 6);
  const ic = axis('ic', 'neptune', 5, 11, 'ic', 'square', 3, 6);
  const session = bind([asc, dsc, mc, ic]);
  const result = findResearchConvergences(session);
  const [period] = result.periods;
  expect(bounds(period)).toEqual([5, 9]);
  expect(period.segments).toHaveLength(1);
  expect(period.peakConcurrentBodies).toBe(2);
  expect(period.contacts.map(c => c.calculatedEventIds)).toEqual([['asc', 'dsc'], ['mc', 'ic']]);
  expect(period.markers).toHaveLength(2);
  expect(period.markers).toMatchObject([
    { kind: 'exact-pass', passes: [{ eventId: 'asc' }, { eventId: 'dsc' }] },
    { kind: 'exact-pass', passes: [{ eventId: 'mc' }, { eventId: 'ic' }] },
  ]);
  const changed = reEvaluateResearchSession(session, createCustomSearchQuery({ ...dates, excludeFocusAngles: ['dsc', 'mc'] }), chart);
  expect(changed.evaluated.all.map(row => row.event.id)).toEqual(['asc', 'ic']);
  expect(findResearchConvergences(changed)).toEqual(result);
});

test('leaves retrograde gaps open and keeps returning windows tied to the original series', () => {
  const chain = { ...series('return'), isRetrogradeSeries: true, windowCountInRange: 2, exactPassCountInRange: 2 };
  const session = bind([
    { ...aspect('saturn-direct', 'saturn', 1, 5, [pass(3)]), series: chain },
    { ...aspect('saturn-return', 'saturn', 7, 9, [{ ...pass(8, 2), retrograde: true }]), series: { ...chain, windowIndex: 1 } },
    aspect('neptune', 'neptune', 2, 10),
  ]);
  const { periods } = findResearchConvergences(session);
  expect(periods.map(bounds)).toEqual([[2, 5], [7, 9]]);
  expect(periods.map(p => p.contacts[0].evidence)).toMatchObject([
    { windows: [{ facts: { series: { id: 'return', windowIndex: 0 }, passes: [{ retrograde: false }] } }] },
    { windows: [{ facts: { series: { id: 'return', windowIndex: 1 }, passes: [{ retrograde: true }] } }] },
  ]);
});

test('uses effective coverage only and discloses unusable boundaries', () => {
  const coverageEnd = realSession.rawResult.range.effectiveEnd.jdTt! - origin;
  const result = findResearchConvergences(bind([
    { ...aspect('saturn', 'saturn', 0, 5), startsAt: null, clippedStart: true },
    aspect('neptune', 'neptune', -2, 2, [pass(1)]),
    { ...aspect('unknown-start', 'pluto', 1, 3), startsAt: null },
    aspect('reversed', 'jupiter', 7, 6),
    aspect('outside', 'mars', coverageEnd + 1, coverageEnd + 2),
    { ...aspect('late-uranus', 'uranus', coverageEnd - 2, coverageEnd - 1), endsAt: null, clippedEnd: true },
    aspect('late-pluto', 'pluto', coverageEnd - 1, coverageEnd + 2),
  ], query, true));
  expect(result.periods.map(p => [p.clippedStart, p.clippedEnd, p.complete])).toEqual([[true, false, false], [false, true, false]]);
  expect(result.periods.map(bounds)).toEqual([[0, 2], [coverageEnd - 1, coverageEnd]]);
  expect(result.periods[0].start).toBe(realSession.rawResult.range.effectiveStart);
  expect(result.periods[1].end).toBe(realSession.rawResult.range.effectiveEnd);
  expect(result.coverage.status).toBe('partial');
  expect(result.omittedWindows.map(w => [w.eventId, w.reason])).toEqual([
    ['unknown-start', 'missing-boundary'], ['reversed', 'reversed-boundaries'], ['outside', 'outside-effective-coverage'],
  ]);
});

test('reports touching endpoints as distinct-body coincidences and splits adjoining periods with no shared pair', () => {
  const saturn = aspect('saturn', 'saturn', 1, 4);
  const second = aspect('saturn-2', 'saturn', 2, 4);
  const neptune = aspect('neptune', 'neptune', 4, 7);
  const events = [saturn, second, neptune];
  const touching = findResearchConvergences(bind(events));
  expect(touching.periods).toEqual([]);
  expect(touching.coincidences).toMatchObject([{
    at: at(4), endingBody: 'saturn', startingBody: 'neptune',
    endingContacts: [{ calculatedEventIds: ['saturn'] }, { calculatedEventIds: ['saturn-2'] }],
  }]);
  const handoff = findResearchConvergences(bind([...events, aspect('pluto', 'pluto', 2, 6), station(4)]));
  expect(handoff.periods.map(bounds)).toEqual([[2, 4], [4, 6]]);
  expect(handoff.periods.every(period => period.markers.some(m => m.kind === 'station' && m.at.jdTt === origin + 4))).toBe(true);
  const close = findResearchConvergences(bind([saturn, aspect('not-touching', 'neptune', 4 + 1e-8, 7)]));
  expect(close.periods).toEqual([]);
  expect(close.coincidences).toEqual([]);
});

test('adds only in-scope timing markers and gives the Moon no vote at any threshold', () => {
  const sun = aspect('saturn-sun', 'saturn', 1, 8, [pass(5)]);
  const moon = aspect('moon', 'moon', 5, 9, [pass(7)]);
  const neptune = aspect('neptune', 'neptune', 5, 10, [pass(8)]);
  const nearMiss = { ...pass(6), state: 'near-miss' as const, residualDeg: 1, passNumberInSeries: null };
  const mercury = { ...aspect('mercury', 'mercury', 6, 7, [nearMiss]), aspect: 'sextile' as const };
  const events = [sun, moon, neptune, mercury, station(6), ingress(7)];
  const session = bind(events);
  const without = findResearchConvergences(session);
  const withMoon = findResearchConvergences(session, { includeMoonMarkers: true });
  const [period] = withMoon.periods;
  expect(bounds(period)).toEqual([5, 8]);
  expect(period.peakConcurrentBodies).toBe(2);
  expect(period.markers.map(m => [m.kind, m.transitingBody, m.at.jdTt - origin])).toEqual([
    ['exact-pass', 'saturn', 5], ['station', 'saturn', 6], ['exact-pass', 'moon', 7],
    ['house-ingress', 'mars', 7], ['exact-pass', 'neptune', 8],
  ]);
  expect(without.periods[0]).toEqual({ ...period, markers: period.markers.filter(m => m.transitingBody !== 'moon') });
  expect(findResearchConvergences(bind([sun, moon]), { minimumImpact: 0, includeMoonMarkers: true }).periods).toEqual([]);
  const scoped = reEvaluateResearchSession(session, createEverythingQuery({ ...dates, includeMoon: false, includeStations: false, includeHouseIngresses: false }), chart);
  expect(scoped.rawResult).toBe(session.rawResult);
  expect(findResearchConvergences(scoped, { includeMoonMarkers: true }).periods[0].markers.map(m => m.transitingBody)).toEqual(['saturn', 'neptune']);
});

test('uses the active computation scope even when bound to a cached superset', () => {
  const saturn = aspect('saturn', 'saturn', 1, 8);
  const neptune = axis('neptune', 'neptune', 5, 10, 'asc', 'conjunction', 3, 6);
  const disabledAngles = bind([saturn, neptune], createEverythingQuery({ ...dates, includeAngles: false }));
  expect(findResearchConvergences(disabledAngles).periods).toEqual([]);
  const excluded = bind([saturn, neptune], createCustomSearchQuery({ ...dates, excludeTransitingBodies: ['neptune'] }));
  expect(findResearchConvergences(excluded).periods).toEqual([]);
  const strict = bind([saturn, neptune], createCustomSearchQuery({
    ...dates, fetchScope: 'strict', includeNatalPlanets: ['mercury'], includeFocusAngles: ['asc'],
  }));
  expect(findResearchConvergences(strict).periods).toEqual([]);

  const narrow = axis('narrow', 'neptune', 6, 7, 'asc', 'sextile', 3, 6.5);
  const wide = axis('wide', 'neptune', 5, 10, 'dsc', 'trine', 4, 6.5);
  const ascOnly = bind([saturn, narrow, wide], createCustomSearchQuery({
    ...dates, fetchScope: 'strict', includeNatalPlanets: ['sun'], includeFocusAngles: ['asc'],
  }));
  expect(findResearchConvergences(ascOnly).periods.map(bounds)).toEqual([[6, 7]]);
});

test('uses the observed score to qualify incomplete evidence', () => {
  const unobserved = aspect('unobserved', 'mercury', 3, 6, []);
  const session = bind([aspect('saturn', 'saturn', 1, 8), unobserved]);
  const contact = scoreResearchImpact(session).byEventId.get('unobserved')!;
  expect(contact.total).toBeLessThan(65);
  expect(contact.possibleUpperBound).toBeGreaterThanOrEqual(65);
  expect(findResearchConvergences(session).periods).toEqual([]);
  const accepted = findResearchConvergences(session, { minimumImpact: contact.total });
  expect(accepted.periods.map(bounds)).toEqual([[3, 6]]);
  expect(accepted.periods[0].contacts[1].missingData).toContain('closest-approach-unobserved');
});

test('orders a 2,400-window synthetic timeline chronologically and deterministically', () => {
  const events: RangeEvent[] = [];
  for (let i = 1199; i >= 0; i--) {
    const start = i / 4;
    events.push(aspect(`neptune-${i}`, 'neptune', start + 0.0625, start + 0.1875));
    events.push(aspect(`saturn-${i}`, 'saturn', start, start + 0.125));
  }
  const session = bind(events);
  const result = findResearchConvergences(session);
  expect(result.periods).toHaveLength(1200);
  expect(result.periods.slice(0, 2).map(bounds)).toEqual([[0.0625, 0.125], [0.3125, 0.375]]);
  expect(bounds(result.periods[1199])).toEqual([299.8125, 299.875]);
  expect(result.periods.every(period => period.peakConcurrentBodies === 2 && period.segments.length === 1)).toBe(true);
  expect(findResearchConvergences(session)).toEqual(result);
});

test('uses real calculated contacts, independent of theme, page and Time Machine', () => {
  const result = findResearchConvergences(realSession);
  expect(result.periods).toHaveLength(1);
  expect(result.periods[0]).toMatchObject({
    start: { utc: '2026-01-01T00:00:00.000Z' }, end: { utc: '2027-01-01T00:00:00.000Z' },
    peakConcurrentBodies: 9, complete: false,
  });
  const themedQuery = createLifeThemesQuery({ ...dates, activeThemeIds: ['finances'], rulershipPolicy: 'traditional-plus-modern' });
  const themed = reEvaluateResearchSession(realSession, themedQuery, chart);
  const page = themed.evaluated.all.filter(row => matchesRangeFilter(row.event, 'station')).slice(2, 4);
  expect(page).toHaveLength(2);
  expect(themed.rawResult).toBe(realSession.rawResult);
  expect(findResearchConvergences(themed)).toEqual(result);
  const retimed = reEvaluateResearchSession(themed, themedQuery, chart, undefined, origin + 100);
  expect(retimed.rawResult.events.some((event, i) => event.timing !== themed.rawResult.events[i].timing)).toBe(true);
  expect(findResearchConvergences(retimed)).toEqual(result);
  const examples = findResearchConvergences(realSession, { minimumImpact: 90 });
  expect(examples.periods.map(p => [p.start.utc?.slice(0, 10), p.end.utc?.slice(0, 10), p.peakConcurrentBodies])).toEqual([
    ['2026-02-14', '2026-06-04', 2],
    ['2026-08-22', '2027-01-01', 3],
  ]);
  expect(examples.periods.map(p => p.contacts.map(c => [c.transitingBody, c.total]))).toEqual([
    [['neptune', 98], ['saturn', 93], ['saturn', 95]],
    [['neptune', 98], ['jupiter', 91], ['saturn', 95]],
  ]);
});

test('preserves A1 scores and U6 export bytes when run on the same session', async () => {
  const session = bind([aspect('saturn', 'saturn', 1, 8), aspect('neptune', 'neptune', 5, 10), station(6)]);
  const options = { mode: 'complete', partByteBudget: 2000 } as const;
  const before = await buildResearchPackage(session, chart, options);
  const impact = scoreResearchImpact(session);
  expect(findResearchConvergences(session).periods).toHaveLength(1);
  expect(scoreResearchImpact(session)).toEqual(impact);
  const after = await buildResearchPackage(session, chart, options);
  expect(after.files.map(f => [f.name, f.sha256])).toEqual(before.files.map(f => [f.name, f.sha256]));
  expect(after.zip.bytes).toEqual(before.zip.bytes);
});
