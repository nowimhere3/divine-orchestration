import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, expect, test } from 'vitest';
import { createAspectRuleSet, MAJOR_ASPECT_ANGLES } from '../../src/domain/aspects';
import { createEphemeraEngine, EPHEMERA_COVERAGE_TT } from '../../src/engine/ephemera';
import type { EphemeraEngine } from '../../src/engine/ephemera';
import { createSnapshotV0, serializeSnapshot } from '../../src/export/snapshot';
import { MAX_SEARCH_DAYS, searchEvents } from '../../src/search/events';
import type { EventSearchRequest } from '../../src/search/events';
import { instantFromTt, SECONDS_PER_DAY } from '../../src/time/ephemeris-time';
import { resolveBirthTime } from '../../src/time/resolve';
import { utcFromTt } from '../../src/time/atomic-offsets';
import mercury from '../fixtures/horizons-mercury-triple.json';
import horizons from '../fixtures/horizons.json';

let engine: EphemeraEngine;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  engine = await createEphemeraEngine(await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm')));
});

const request: EventSearchRequest = {
  startTt: 2460389.5, endTt: 2460445.5, referenceTt: 2460420,
  bodies: ['mercury'], targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 20 }],
  transitChartId: 'transit', rules: createAspectRuleSet(),
};
const secondsBetween = (first: number, second: number) => Math.abs(first - second) * SECONDS_PER_DAY;

test('finds the Mercury triple pass and both stations against independent Horizons brackets', () => {
  const updates: number[] = [];
  const result = searchEvents(engine, request, progress => updates.push(progress.completed));
  expect(updates).toEqual([0, 1, 2]);
  expect(result.status).toBe('complete');
  expect(result.provenance.engine).toMatchObject({ name: 'Ephemera', version: '0.4.1', dataMode: '1as' });
  expect(result.warnings).toContain('crossing-uses-modeled-delta-t');
  const windows = result.context!.events.filter(event => event.kind === 'aspect-window')
    .filter(event => event.aspect === 'conjunction');
  const passes = windows.flatMap(window => window.passes.filter(pass => pass.state !== 'near-miss'));
  expect(windows).toHaveLength(1);
  expect(windows[0].timing).toBe('present');
  expect(passes).toHaveLength(3);
  for (const [i, pass] of passes.entries()) {
    const [[a, lonA], [b, lonB]] = mercury.contacts[i];
    const reference = a + (20 - lonA) / (lonB - lonA) * (b - a);
    expect(pass.at.jdTt).toBeGreaterThan(a);
    expect(pass.at.jdTt).toBeLessThan(b);
    expect(secondsBetween(pass.at.jdTt!, reference)).toBeLessThan(35);
    expect(pass.residualDeg).toBeLessThanOrEqual(result.provenance.contactToleranceDeg);
    expect(pass.at.utc).toMatch(/^2024-/);
    expect(pass.at.jdUt).toBeLessThan(pass.at.jdTt!);
  }
  const stations = result.context!.events.filter(event => event.kind === 'station');
  expect(stations.map(station => station.turns)).toEqual(['retrograde', 'direct']);
  expect(stations.map(station => station.timing)).toEqual(['past', 'future']);
  for (const [i, station] of stations.entries()) {
    const [[a, lonA], [b, lonB], [c, lonC]] = mercury.stations[i];
    const reference = b + 0.5 * (b - a) * (lonA - lonC) / (lonA + lonC - 2 * lonB);
    expect(station.at.jdTt).toBeGreaterThan(a);
    expect(station.at.jdTt).toBeLessThan(c);
    expect(secondsBetween(station.at.jdTt!, reference)).toBeLessThan(40);
    expect(result.stationResidualsDegPerDay[station.id]).toBeLessThan(result.provenance.stationToleranceDegPerDay);
  }
  expect(result).toEqual(searchEvents(engine, request));
  const ids = result.context!.events.map(event => event.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('finds all five major aspect angles, mirror branches and the exact wraparound equinox', () => {
  const result = searchEvents(engine, {
    ...request, startTt: 2460388, endTt: 2460754, bodies: ['sun'],
    targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 0 }],
    rules: createAspectRuleSet({ conjunction: 0, opposition: 0, square: 0, sextile: 0, trine: 0 }),
  });
  const windows = result.context!.events.filter(event => event.kind === 'aspect-window');
  for (const [aspect, count] of Object.entries({ conjunction: 1, opposition: 1, square: 2, sextile: 2, trine: 2 })) {
    expect(windows.filter(window => window.aspect === aspect)).toHaveLength(count);
  }
  expect(windows.every(window => window.startsAt?.jdTt === window.endsAt?.jdTt)).toBe(true);
  const conjunction = windows.find(window => window.aspect === 'conjunction')!;
  const center = horizons.crossingSampleCenterTt;
  const [, east] = horizons.bodies.Sun.rows.find(([tt]) => tt === center)!;
  const [, west] = horizons.bodies.Sun.rows.find(([tt]) => Math.abs(tt - (center + 1 / 48)) < 1e-8)!;
  const reference = center + (360 - east) / (west - east + 360) / 48;
  expect(secondsBetween(conjunction.passes[0].at.jdTt!, reference)).toBeLessThan(2);
  expect(windows.map(window => window.startsAt!.jdTt!)).toEqual(
    windows.map(window => window.startsAt!.jdTt!).sort((a, b) => a - b),
  );
  expect(windows.every(window => window.passes[0].residualDeg! <= 0.00001 &&
    Object.hasOwn(MAJOR_ASPECT_ANGLES, window.aspect))).toBe(true);
});

test('distinguishes a real near-miss from a clipped interval with no observed minimum', () => {
  const scoped = {
    ...request, startTt: 2460402, endTt: 2460403,
    targets: [{ chartId: 'natal', planetId: 'sun' as const, longitudeDeg: 28 }],
    rules: createAspectRuleSet({ conjunction: 1 }),
  };
  const result = searchEvents(engine, scoped);
  const window = result.context!.events.find(event => event.kind === 'aspect-window' && event.aspect === 'conjunction');
  expect(window).toMatchObject({
    clippedStart: true, clippedEnd: true, startsAt: null, endsAt: null,
    passes: [{ state: 'near-miss', residualDeg: expect.closeTo(0.781, 2) }],
  });
  const short = searchEvents(engine, { ...scoped, endTt: 2460402.1 });
  expect(short.context!.events.find(event => event.kind === 'aspect-window')).toMatchObject({
    clippedStart: true, clippedEnd: true, passes: [],
  });
});

test('includes a contact at a closed search boundary once, with its other orb boundary clipped', () => {
  const instant = instantFromTt(2460391, engine.modelDeltaTSeconds);
  const position = engine.position('Mercury', instant);
  if (position.status !== 'ok') throw new Error(position.reason);
  const result = searchEvents(engine, {
    ...request, startTt: instant.jdTt, endTt: instant.jdTt + 0.5,
    targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: position.value.longitude }],
  });
  expect(result.context!.events.find(event => event.kind === 'aspect-window')).toMatchObject({
    startsAt: null, endsAt: null, clippedStart: true, clippedEnd: true,
    passes: [{ state: 'exact', at: { jdTt: instant.jdTt } }],
  });
});

test('includes a station once at either closed interval endpoint', () => {
  const station = engine.station('Mercury', 2460402, { direction: 1, maxDays: 1 });
  if (station.status !== 'ok') throw new Error(station.reason);
  const tt = station.value.jdTt;
  for (const [startTt, endTt] of [[tt - 1, tt], [tt, tt + 1]]) {
    const { context } = searchEvents(engine, { ...request, targets: [], startTt, endTt });
    expect(context?.events).toMatchObject([{ kind: 'station', at: { jdTt: tt }, turns: 'retrograde' }]);
  }
});

test('reports unavailable bodies, missing natal data, clipped coverage and invalid bounds', () => {
  const missing = searchEvents(engine, { ...request, targets: [{ ...request.targets[0], longitudeDeg: null }] });
  expect(missing.status).toBe('partial');
  expect(missing.unavailable).toEqual([{ kind: 'natal-position', point: { chartId: 'natal', planetId: 'sun' }, reason: 'position-unavailable' }]);
  expect(missing.context!.events.every(event => event.kind === 'station')).toBe(true);

  const broken: EphemeraEngine = {
    ...engine,
    position(body, instant) {
      const valid = engine.position(body, instant);
      return { ...valid, status: 'unavailable', reason: 'calculation-unavailable' };
    },
  };
  expect(searchEvents(broken, request)).toMatchObject({
    status: 'unavailable', reason: 'no-calculable-bodies', context: null,
    unavailable: [{ kind: 'transit-body', reason: 'calculation-unavailable' }],
  });
  const start = EPHEMERA_COVERAGE_TT.start;
  const clipped = searchEvents(engine, { ...request, bodies: ['sun'], startTt: start - 1, endTt: start + 1 });
  expect(clipped).toMatchObject({ status: 'partial', context: { start: { jdTt: start, utc: null } } });
  expect(clipped.warnings).toContain('interval-clipped');
  expect(searchEvents(engine, { ...request, startTt: start - 2, endTt: start - 1 })).toMatchObject({
    status: 'unavailable', reason: 'outside-coverage', context: null,
  });
  expect(() => searchEvents(engine, { ...request, endTt: request.startTt + MAX_SEARCH_DAYS + 1 })).toThrow(RangeError);
  expect(() => searchEvents(engine, { ...request, targets: [{ ...request.targets[0], chartId: 'transit' }] })).toThrow(RangeError);
});

test('round-trips TT across a real leap second and the early UTC drift era', () => {
  for (const [date, time] of [
    ['2016-12-31', '23:59:59.500'], ['2016-12-31', '23:59:60.500'], ['2017-01-01', '00:00:00.500'],
    ['1965-01-01', '12:00:00.123'], ['1900-01-01', '12:00:00'],
  ]) {
    const instant = resolveBirthTime({ date, time, offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
    if (instant.kind !== 'resolved') throw new Error(instant.kind);
    expect(utcFromTt(instant.jdTt)).toBe(instant.utc);
  }
  expect(utcFromTt(2441317.5 + (42.184 - 0.05) / 86400)).toBeNull();
});

test('feeds the existing B2 export model without changing event shape', () => {
  const { context, provenance } = searchEvents(engine, request);
  const time = resolveBirthTime({ date: '2000-01-01', time: '12:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  if (time.kind !== 'resolved') throw new Error(time.kind);
  const snapshot = createSnapshotV0({
    engine: provenance.engine, aspectRules: request.rules, aspects: [],
    charts: (['natal', 'transit'] as const).map(id => ({
      id, kind: id, time, label: null, warnings: [],
      planets: { status: 'available', value: [] }, houses: { status: 'unavailable', reason: 'missing-location' },
      settings: { zodiac: 'tropical', requestedHouseSystem: null, observer: null },
    })),
    context: { selectedAt: null, referenceAt: null, eventSearch: context },
  });
  expect(JSON.parse(serializeSnapshot(snapshot)).context.eventSearch).toEqual(context);
});
