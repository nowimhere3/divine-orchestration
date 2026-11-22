import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, expect, test } from 'vitest';
import type { Chart } from '../../src/domain/chart';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import type { EphemeraEngine } from '../../src/engine/ephemera';
import { buildResearchPackage } from '../../src/export/research-package';
import {
  buildRangeSearchRequest, createCustomSearchQuery, createEverythingQuery, createLifeThemesQuery,
  createResearchSession, reEvaluateResearchSession, resolveChartFactors, resolveResearchFocus, scoreResearchImpact,
} from '../../src/research';
import type { PersonalImpactScore, ResearchQuery } from '../../src/research';
import { searchEventRange } from '../../src/search/range';
import type { AngleAspectWindowEvent, RangeAspectPass, RangeAspectWindowEvent, RangeEvent, RangeStationEvent } from '../../src/search/range';
import { resolveBirthTime } from '../../src/time/resolve';
import { calculateNatal } from '../../src/view/chart-data';
import { matchesRangeFilter } from '../../src/view/event-model';

const dates = { startDate: '2026-01-01', endDate: '2027-01-01' };
const query = createEverythingQuery(dates);
const observer = { latitudeDeg: 51.0447, longitudeDeg: -114.0719 };
let engine: EphemeraEngine;
let chart: Chart;
let session: ReturnType<typeof search>;

function time(date: string) {
  const resolved = resolveBirthTime({ date, time: '00:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  if (resolved.kind !== 'resolved') throw new Error('Expected resolved time.');
  return resolved.jdTt;
}

function search(targetChart: Chart, researchQuery: ResearchQuery) {
  const startTt = time(researchQuery.range.startDate);
  const endTt = time(researchQuery.range.endDate);
  const focus = resolveResearchFocus(researchQuery, resolveChartFactors(targetChart));
  const rangeRequest = buildRangeSearchRequest(researchQuery, targetChart, focus, { startTt, endTt, referenceTt: startTt });
  return createResearchSession({ chart: targetChart, query: researchQuery, rangeRequest, rawResult: searchEventRange(engine, rangeRequest) });
}

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  engine = await createEphemeraEngine(await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm')));
  const born = resolveBirthTime({ date: '1987-03-14', time: '07:25', timeZone: 'America/Edmonton' }, engine.modelDeltaTSeconds);
  if (born.kind !== 'resolved') throw new Error('Expected resolved birth time.');
  chart = calculateNatal(engine, born, observer, 'Placidus');
  session = search(chart, query);
});

const eventIs = <K extends RangeEvent['kind']>(kind: K) =>
  (event: RangeEvent): event is Extract<RangeEvent, { kind: K }> => event.kind === kind;

function fixture(kind: 'aspect-window'): RangeAspectWindowEvent;
function fixture(kind: 'angle-aspect-window'): AngleAspectWindowEvent;
function fixture(kind: 'station'): RangeStationEvent;
function fixture(kind: RangeEvent['kind']): RangeEvent {
  const event = session.rawResult.events.find(eventIs(kind));
  if (!event) throw new Error('Fixture event unavailable.');
  return event;
}

function fromEvents(events: readonly RangeEvent[], researchQuery = query, targetChart = chart) {
  return createResearchSession({
    chart: targetChart,
    query: researchQuery,
    rangeRequest: session.rangeRequest,
    rawResult: { ...session.rawResult, events },
  });
}

function score(event: RangeEvent, targetChart = chart): PersonalImpactScore {
  const [result] = scoreResearchImpact(fromEvents([event], query, targetChart)).scores;
  expect(result.modelVersion).toBe('impact-v1');
  return result;
}

function exactPass(state: 'exact' | 'refined' = 'exact'): RangeAspectPass {
  return {
    at: session.rawResult.range.effectiveStart,
    residualDeg: state === 'exact' ? 0 : 1e-7,
    state, toleranceDeg: 1e-6, passNumberInSeries: 1, retrograde: false,
  };
}

test('reproduces the design examples and the two ceilings for Moon and stations', () => {
  const aspect = fixture('aspect-window');
  const angle = fixture('angle-aspect-window');
  const station = fixture('station');
  if (chart.time.kind !== 'resolved') throw new Error('Expected timed fixture chart.');
  const noHouses = calculateNatal(engine, chart.time, null, 'Placidus');

  const saturn = score({
    ...aspect, transit: { ...aspect.transit, planetId: 'saturn' }, target: { ...aspect.target, planetId: 'sun' },
    aspect: 'square', passes: [exactPass()],
  }, noHouses);
  expect(saturn.total).toBe(88);
  expect(saturn.band).toBe('high');
  expect(saturn.components.natalConnection.points).toBe(35);
  expect(saturn.possibleUpperBound).toBe(91);

  const moon = score({
    ...angle, transit: { ...angle.transit, planetId: 'moon' }, targetAngle: 'asc', aspect: 'conjunction',
    allowedOrbDeg: 0, passes: [exactPass('refined')],
  });
  expect(moon.total).toBe(75);
  expect(moon.components.precision).toMatchObject({ points: 20, reason: 'refined' });
  expect(moon.components.planetaryCycle).toMatchObject({ points: 0, missing: [] });

  const neptune = score({
    ...aspect, transit: { ...aspect.transit, planetId: 'neptune' }, target: { ...aspect.target, planetId: 'uranus' },
    aspect: 'sextile', allowedOrbDeg: 2, clippedStart: false, clippedEnd: false,
    passes: [{ ...exactPass(), state: 'near-miss', residualDeg: -1, passNumberInSeries: null }],
  }, noHouses);
  expect(neptune.total).toBe(64);
  expect(neptune.components.precision).toMatchObject({ reason: 'near-miss' });
  expect(neptune.components.precision.points).toBeCloseTo(11.877476, 5);
  expect(neptune.natalPlanetEvidence).toMatchObject({ houseId: null, traditionalAngularHousesRuled: null });

  const outerStation = { ...station, planet: { ...station.planet, planetId: 'pluto' as const } };
  expect(score({ ...outerStation, inNatalHouse: 10 }).total).toBe(79);
  expect(score({ ...outerStation, inNatalHouse: 8 }).total).toBe(71);
  const missing = score({ ...outerStation, inNatalHouse: null }, noHouses);
  expect(missing).toMatchObject({ total: 57, possibleUpperBound: 79, missingData: ['station-natal-house-unavailable'] });
});

test('uses the strongest traditional natal connection and scores an ingress by the crossed cusp', () => {
  const { houses, chartRuler } = session.chartFactors;
  expect(houses).not.toBeNull();
  expect(chartRuler).not.toBeNull();
  const aspect = fixture('aspect-window');
  const ruler = score({ ...aspect, target: { ...aspect.target, planetId: chartRuler!.traditional } });
  expect(ruler.components.natalConnection).toMatchObject({ points: 38, possiblePoints: 38, reason: 'traditional-chart-ruler' });
  const angular = [1, 4, 7, 10];
  const modernFixture = ['03:25', '06:25', '09:25', '12:25', '15:25', '18:25', '21:25'].map(birthTime => {
    const born = resolveBirthTime({ date: '1987-03-14', time: birthTime, timeZone: 'America/Edmonton' }, engine.modelDeltaTSeconds);
    if (born.kind !== 'resolved') throw new Error('Expected resolved birth time.');
    const alternative = calculateNatal(engine, born, observer, 'Placidus');
    const factors = resolveChartFactors(alternative);
    const planet = factors.natalPlanets.find(p => p.rulesHousesModern.some(id => angular.includes(id)) &&
      !p.rulesHousesTraditional.some(id => angular.includes(id)) && p.planetId !== factors.chartRuler?.traditional);
    return { alternative, planet };
  }).find(candidate => candidate.planet);
  if (!modernFixture?.planet) throw new Error('Expected a modern co-ruler of an angular house.');
  const { alternative: modernChart, planet: modernOnly } = modernFixture;
  const modernOnlyAspect = { ...aspect, target: { ...aspect.target, planetId: modernOnly.planetId } };
  const modernQuery = createLifeThemesQuery({ ...dates, activeThemeIds: ['finances'], rulershipPolicy: 'traditional-plus-modern' });
  const [modernImpact] = scoreResearchImpact(fromEvents([modernOnlyAspect], modernQuery, modernChart)).scores;
  expect(modernImpact).toEqual(score(modernOnlyAspect, modernChart));
  expect(modernImpact.natalPlanetEvidence?.traditionalAngularHousesRuled).toEqual([]);

  const ingress = session.rawResult.events.find(eventIs('house-ingress'))!;
  expect(score({ ...ingress, cuspHouseId: 10 }).components.natalConnection.points).toBe(32);
  const other = score({ ...ingress, cuspHouseId: 9, fromHouse: 10, toHouse: 9 });
  expect(other.components.natalConnection.points).toBe(24);
  expect(other.components.contactType.points).toBe(9);
  expect(other.components.precision.points).toBe(20);
});

test('uses no assumed orb or geometry for unobserved peaks and explains clipped durations', () => {
  const aspect = fixture('aspect-window');
  const pass = { ...exactPass(), state: 'near-miss' as const, residualDeg: 0.5, passNumberInSeries: null };
  const clipped = score({
    ...aspect, allowedOrbDeg: 0, startsAt: null, endsAt: session.rawResult.range.effectiveEnd,
    clippedStart: true, clippedEnd: false, passes: [pass],
  });
  expect(clipped.components.precision).toMatchObject({ points: 0, possiblePoints: 20, reason: 'unobserved' });
  expect(clipped.missingData).toContain('closest-approach-unobserved');
  expect(clipped.missingData).toContain('closest-approach-may-be-clipped');
  expect(clipped.evidence).toMatchObject({
    windows: [{ observedDays: session.rawResult.range.effectiveDays, durationIsMinimum: true }],
  });
  const measured = score({ ...aspect, allowedOrbDeg: 1, clippedStart: false, clippedEnd: false, passes: [pass, { ...pass, residualDeg: null }] });
  expect(measured.components.precision.possiblePoints).toBe(measured.components.precision.points);
  expect(measured.missingData).not.toContain('closest-approach-unobserved');
  const atOrbEdge = score({ ...aspect, allowedOrbDeg: 0.5, clippedStart: false, clippedEnd: false, passes: [pass] });
  expect(atOrbEdge.components.precision).toEqual({ points: 0, possiblePoints: 0, reason: 'near-miss', missing: [] });
  const clippedMeasurement = score({ ...aspect, allowedOrbDeg: 1, clippedStart: true, passes: [pass] });
  expect(clippedMeasurement.components.precision.possiblePoints).toBe(20);
  expect(clippedMeasurement.missingData).toContain('closest-approach-may-be-clipped');
});

test('scores an asymmetric folded contact once using each calculated end’s own precision', () => {
  const seed = fixture('angle-aspect-window');
  const nearMiss = { ...exactPass(), state: 'near-miss' as const, residualDeg: 1, passNumberInSeries: null };
  const asc: AngleAspectWindowEvent = {
    ...seed, id: 'narrow', targetAngle: 'asc', aspect: 'sextile', allowedOrbDeg: 2,
    clippedStart: false, clippedEnd: false, startsAt: session.rawResult.range.effectiveStart,
    endsAt: session.rawResult.range.effectiveEnd, passes: [nearMiss],
  };
  const dsc: AngleAspectWindowEvent = {
    ...asc, id: 'wide', targetAngle: 'dsc', aspect: 'trine', allowedOrbDeg: 4,
    passes: [{ ...nearMiss, residualDeg: 1.5 }],
  };
  const first = fromEvents([asc, dsc], query);
  const swapped = reEvaluateResearchSession(first, createCustomSearchQuery({ ...dates, excludeFocusAngles: ['dsc'] }), chart);
  expect(first.evaluated.all.map(item => item.event.id)).toEqual(['wide']);
  expect(swapped.evaluated.all.map(item => item.event.id)).toEqual(['narrow']);
  expect(swapped.evaluated.all[0].axisCompanions).toHaveLength(0);
  const result = scoreResearchImpact(first);
  expect(result).toEqual(scoreResearchImpact(swapped));
  expect(result.scores).toHaveLength(1);
  expect(result.byEventId.get('narrow')).toBe(result.byEventId.get('wide'));
  expect(result.scores[0].evidence).toMatchObject({ bestPass: { eventId: 'wide', passIndex: 0 }, windows: [
    { facts: { allowedOrbDeg: 2 } }, { facts: { allowedOrbDeg: 4 } },
  ] });
  expect(result.scores[0].components.precision.points).toBeCloseTo(20 * (1 - 0.375 ** 1.3));
  expect(score(asc).calculatedEventIds).toEqual(['narrow']);
});

test('retains observed passes and retrograde series without adding points or bridging windows', () => {
  const aspect = fixture('aspect-window');
  const series = { ...aspect.series, complete: false, clippedEnd: true, isRetrogradeSeries: true,
    exactPassCountInRange: 3, windowCountInRange: 2, windowIndex: 1 };
  const first = { ...aspect, passes: [exactPass()], series };
  const repeated = { ...first, passes: [exactPass(), { ...exactPass('refined'), retrograde: true, passNumberInSeries: 2 }] };
  const second = { ...first, id: 'reentry', series: { ...series, windowIndex: 2 } };
  const { scores } = scoreResearchImpact(fromEvents([repeated, second]));
  expect(scores.map(item => item.total)).toEqual([score(first).total, score(first).total]);
  expect(scores[0].evidence).toMatchObject({ windows: [{
    exactPassCountInWindow: 2, facts: { series, passes: repeated.passes },
  }] });
  expect(scores[1].evidence).toMatchObject({ windows: [{ facts: { series: { id: series.id, windowIndex: 2 } } }] });
});

test('reports real unknown-time stations and real planet contacts without coordinates separately', () => {
  const knownTime = chart.time;
  if (knownTime.kind !== 'resolved') throw new Error('Expected known fixture time.');
  const noTime = resolveBirthTime({ date: '1987-03-14', time: null }, engine.modelDeltaTSeconds);
  if (noTime.kind !== 'unknown-time') throw new Error('Expected date-only result.');
  const shortQuery = createEverythingQuery({ ...dates, endDate: '2026-06-01', includeMoon: false });
  const unknown = scoreResearchImpact(search(calculateNatal(engine, noTime, observer, 'Placidus'), shortQuery));
  expect(unknown.chartAvailability).toMatchObject({ timeStatus: 'unknown-time', housesUnavailableReason: 'unknown-birth-time' });
  expect(unknown.scores.length).toBeGreaterThan(0);
  expect(unknown.scores.every(item => item.evidence.kind === 'station' && item.missingData.includes('station-natal-house-unavailable'))).toBe(true);
  const unplacedOuter = unknown.scores.find(item => item.components.planetaryCycle.points === 25)!;
  expect(unplacedOuter).toMatchObject({ total: 57, possibleUpperBound: 79 });
  const noCoordinates = scoreResearchImpact(search(calculateNatal(engine, knownTime, null, 'Placidus'), shortQuery));
  expect(noCoordinates.chartAvailability.housesUnavailableReason).toBe('missing-location');
  expect(noCoordinates.scores.some(item => item.evidence.kind === 'aspect-window' && item.possibleUpperBound > item.total)).toBe(true);
  expect(noCoordinates.scores.some(item => item.evidence.kind === 'angle-aspect-window' || item.evidence.kind === 'house-ingress')).toBe(false);
});

test('scores a real year deterministically across theme changes, view pages and retiming', () => {
  const original = scoreResearchImpact(session);
  expect(new Set(original.scores.map(item => item.evidence.kind))).toEqual(new Set(['aspect-window', 'angle-aspect-window', 'station', 'house-ingress']));
  expect(original.scores).toHaveLength(session.evaluated.counts.total);
  expect(original.byEventId.size).toBe(session.rawResult.events.length);
  expect(original.scores.every(item => item.total >= 0 && item.possibleUpperBound >= item.total && item.possibleUpperBound <= 100)).toBe(true);
  const theme = createLifeThemesQuery({ ...dates, activeThemeIds: ['finances'], rulershipPolicy: 'traditional-plus-modern' });
  const themed = reEvaluateResearchSession(session, theme, chart);
  expect(themed.rawResult).toBe(session.rawResult);
  expect(themed.evaluated.relevant.length).toBeLessThan(session.evaluated.all.length);
  expect(scoreResearchImpact(themed)).toEqual(original);
  const page = themed.evaluated.all.filter(item => matchesRangeFilter(item.event, 'station')).slice(2, 4);
  expect(page).toHaveLength(2);
  const themedImpact = scoreResearchImpact(themed);
  expect(page.map(item => themedImpact.byEventId.get(item.event.id)?.total))
    .toEqual(page.map(item => original.byEventId.get(item.event.id)?.total));
  const retimed = reEvaluateResearchSession(themed, theme, chart, undefined, time('2026-07-01'));
  expect(retimed.rawResult.events.some((event, i) => event.timing !== themed.rawResult.events[i].timing)).toBe(true);
  expect(scoreResearchImpact(retimed)).toEqual(original);
  const moonOff = reEvaluateResearchSession(session, createEverythingQuery({ ...dates, includeMoon: false }), chart);
  expect(moonOff.rawResult).toBe(session.rawResult);
  expect(scoreResearchImpact(moonOff).scores).toEqual(original.scores.filter(item => item.transitingBody !== 'moon'));
});

test('records representative contacts from the calculated 2026 chart fixture', () => {
  const result = scoreResearchImpact(session);
  const lookup = (predicate: (event: RangeEvent) => boolean) => {
    const event = session.rawResult.events.find(predicate);
    expect(event).toBeDefined();
    return result.byEventId.get(event!.id);
  };
  const moon = lookup(event => event.kind === 'angle-aspect-window' && event.transit.planetId === 'moon' &&
    event.targetAngle === 'asc' && event.aspect === 'conjunction' && event.passes.some(pass => pass.at.utc?.startsWith('2026-01-24')));
  expect(moon).toMatchObject({ total: 75, calculatedEventIds: expect.arrayContaining([expect.stringContaining('"dsc","opposition"')]) });
  const neptune = lookup(event => event.kind === 'angle-aspect-window' && event.transit.planetId === 'neptune' &&
    event.targetAngle === 'mc' && event.aspect === 'square' && event.series.exactPassCountInRange === 2);
  expect(neptune).toMatchObject({ total: 98, evidence: { windows: [
    { exactPassCountInWindow: 2, durationIsMinimum: true },
    { exactPassCountInWindow: 2, durationIsMinimum: true },
  ] } });
  const saturn = lookup(event => event.kind === 'house-ingress' && event.planet.planetId === 'saturn' && event.at.utc?.startsWith('2026-04-29') === true);
  expect(saturn).toMatchObject({ total: 81, components: { natalConnection: { points: 32 } } });
  const jupiter = lookup(event => event.kind === 'station' && event.planet.planetId === 'jupiter' && event.at.utc?.startsWith('2026-03-11') === true);
  expect(jupiter).toMatchObject({ total: 74, evidence: { facts: { turns: 'direct' }, stationResidualDegPerDay: expect.any(Number) } });
});

test('retains partial coverage and leaves the bound U6 export byte-for-byte unchanged', async () => {
  const cached = fromEvents(session.rawResult.events.slice(0, 12));
  const partial = createResearchSession({
    chart, query, rangeRequest: cached.rangeRequest,
    rawResult: {
      ...cached.rawResult, status: 'partial',
      range: { ...cached.rawResult.range, clippedToCoverage: true },
      warnings: [...cached.rawResult.warnings, 'interval-clipped'],
    },
  });
  const options = { mode: 'complete', partByteBudget: 2000 } as const;
  const before = await buildResearchPackage(partial, chart, options);
  const impact = scoreResearchImpact(partial);
  expect(impact.coverage).toMatchObject({ status: 'partial', range: { clippedToCoverage: true }, warnings: expect.arrayContaining(['interval-clipped']) });
  expect(impact.scores).toEqual(scoreResearchImpact(cached).scores);
  const after = await buildResearchPackage(partial, chart, options);
  expect(after.files.map(file => [file.name, file.sha256])).toEqual(before.files.map(file => [file.name, file.sha256]));
  expect(after.zip.bytes).toEqual(before.zip.bytes);
});
