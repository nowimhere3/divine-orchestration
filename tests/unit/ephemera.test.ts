import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fromWasm } from '@astrologer/ephemera/ephemeris.mjs';
import { beforeAll, describe, expect, test } from 'vitest';
import { createEphemeraEngine, EPHEMERA_COVERAGE_TT } from '../../src/engine/ephemera';
import type { EngineInstant, EphemeraEngine, HouseSystemName } from '../../src/engine/ephemera';
import horizons from '../fixtures/horizons.json';
import edgeHorizons from '../fixtures/horizons-edge-iau2006.json';
import houses from '../fixtures/houses.json';

const secondsPerDay = 86400;
const eclipseJdTt = 2460409.25;
const j2000: EngineInstant = { jdUt: 2451545 - 63.8285 / secondsPerDay, jdTt: 2451545, deltaTYear: 2000 };
let engine: EphemeraEngine;
let wasmBytes: Buffer;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  wasmBytes = await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm'));
  engine = await createEphemeraEngine(wasmBytes);
});

function angleError(actual: number, reference: number) {
  return ((actual - reference + 540) % 360) - 180;
}

function sample(rows: number[][], jdTt: number) {
  const row = rows.find(([jd]) => Math.abs(jd - jdTt) < 1e-8);
  if (!row) throw new Error(`Missing Horizons sample for JD TT ${jdTt}`);
  return row;
}

// Accuracy fixtures start from exact TT. Use the model only to supply the companion UT.
function instantAtTt(jdTt: number, deltaTYear: number): EngineInstant {
  return { jdTt, jdUt: jdTt - engine.modelDeltaTSeconds(deltaTYear) / secondsPerDay, deltaTYear };
}

describe('planetary positions', () => {
  test.each(Object.entries(horizons.bodies))('%s agrees with modern Horizons positions and speed', (body, { rows }) => {
    for (const jdTt of horizons.positionEpochsTt) {
      const [, longitude, latitude] = sample(rows, jdTt);
      const result = engine.position(body, instantAtTt(jdTt, jdTt === 2451545 ? 2000 : 2024.27));
      expect(result.engine).toEqual({
        name: 'Ephemera', version: '0.4.1', dataMode: '1as',
        frame: 'apparent geocentric tropical ecliptic of date',
      });
      expect(result.settings).toMatchObject({ body, jdTt });
      expect(result.warnings).toEqual([]);
      if (result.status !== 'ok') throw new Error(`${body}: ${result.reason}`);
      expect(Math.abs(angleError(result.value.longitude, longitude)) * 3600).toBeLessThan(1);
      expect(Math.abs(result.value.latitude - latitude) * 3600).toBeLessThan(1);
    }

    const h = horizons.rateStepDays;
    const [, beforeLon, beforeLat] = sample(rows, eclipseJdTt - h);
    const [, afterLon, afterLat] = sample(rows, eclipseJdTt + h);
    const rate = angleError(afterLon, beforeLon) / (2 * h);
    const eclipse = engine.position(body, instantAtTt(eclipseJdTt, 2024.27));
    if (eclipse.status !== 'ok') throw new Error(eclipse.reason);
    expect(Math.abs(eclipse.value.longitudeSpeed - rate)).toBeLessThan(0.001); // deg/day
    expect(Math.abs(eclipse.value.latitudeSpeed - (afterLat - beforeLat) / (2 * h))).toBeLessThan(0.001);
    expect(eclipse.value.retrograde).toBe(rate < 0);
    expect(eclipse.value.distance).toBeGreaterThan(0);
    expect(Number.isFinite(eclipse.value.distanceSpeed)).toBe(true);
  });

  test.each(['Sun', 'Moon', 'Mercury'] as const)('%s meets the accuracy target at the sampled coverage edges', body => {
    for (const [index, jdTt] of horizons.edgeEpochsTt.entries()) {
      const [, longitude, latitude] = sample(horizons.bodies[body].rows, jdTt);
      const result = engine.position(body, instantAtTt(jdTt, index === 0 ? 1550 : 2649.99));
      expect(result.warnings).toContain('near-coverage-edge');
      if (result.status !== 'ok') throw new Error(result.reason);
      // Older Horizons ecliptic frame differs systematically by up to ~2.3 arcsec in these cases.
      expect(Math.abs(angleError(result.value.longitude, longitude)) * 3600).toBeLessThan(3);
      expect(Math.abs(result.value.latitude - latitude) * 3600).toBeLessThan(1);
      const [, , , alignedLongitude, alignedLatitude] = sample(edgeHorizons.bodies[body].rows, jdTt);
      expect(Math.abs(angleError(result.value.longitude, alignedLongitude)) * 3600).toBeLessThan(1);
      expect(Math.abs(result.value.latitude - alignedLatitude) * 3600).toBeLessThan(1);
    }
  });

  test('uses the bundled Pluto bounds and returns unavailable for missing or invalid requests', () => {
    const { start, end } = EPHEMERA_COVERAGE_TT;
    for (const [jdTt, deltaTYear] of [[start, 1550], [end, 2650]] as const) {
      expect(engine.position('Pluto', instantAtTt(jdTt, deltaTYear))).toMatchObject({
        status: 'ok', warnings: ['near-coverage-edge'],
      });
    }
    expect(engine.position('Pluto', instantAtTt(start - 0.01, 1550))).toMatchObject({ reason: 'outside-coverage' });
    expect(engine.position('Sun', instantAtTt(end + 0.01, 2650))).toMatchObject({ reason: 'outside-coverage' });
    expect(engine.position('Chiron', j2000)).toMatchObject({ reason: 'unsupported-body' });
    expect(engine.position('constructor', j2000)).toMatchObject({ reason: 'unsupported-body' });
    expect(engine.position('Sun', { ...j2000, jdUt: NaN })).toMatchObject({ reason: 'invalid-input' });
  });
});

describe('houses and time scales', () => {
  test.each(houses.cases)('$label agrees with Swiss Ephemeris at the same UT', fixture => {
    const { jdUt, longitudeDeg, latitudeDeg, requested, effective } = fixture;
    const year = jdUt === 2451545 ? 2000 : 2024.27;
    const instant = { jdUt, jdTt: jdUt + engine.modelDeltaTSeconds(year) / secondsPerDay, deltaTYear: year };
    const result = engine.houses(instant, { longitudeDeg, latitudeDeg }, requested as HouseSystemName);
    if (result.status !== 'ok') throw new Error(result.reason);
    expect(result.settings).toMatchObject({ requestedSystem: requested, longitudeDeg, latitudeDeg, jdUt });
    expect(result.value.effectiveSystem).toBe(effective);
    expect(result.value.fallback).toBe(effective !== requested);
    expect(result.warnings.includes('polar-house-fallback')).toBe(effective !== requested);
    expect(result.value.cuspsDeg).toHaveLength(12);
    for (const [index, cusp] of result.value.cuspsDeg.entries()) {
      expect(Math.abs(angleError(cusp, fixture.cuspsDeg[index])) * 3600).toBeLessThan(0.1);
    }
    expect(Math.abs(angleError(result.value.ascendantDeg, fixture.ascendantDeg)) * 3600).toBeLessThan(0.1);
    expect(Math.abs(angleError(result.value.midheavenDeg, fixture.midheavenDeg)) * 3600).toBeLessThan(0.1);
  });

  test('rejects a geographic pole and out-of-range longitude', () => {
    expect(engine.houses(j2000, { longitudeDeg: 0, latitudeDeg: 90 }, 'Placidus')).toMatchObject({ reason: 'invalid-input' });
    expect(engine.houses(j2000, { longitudeDeg: 190, latitudeDeg: 30 }, 'Placidus')).toMatchObject({ reason: 'invalid-input' });
  });

  test.each([[2000, 63.8285], [2017, 68.5927], [2024, 69.1752]])(
    'explicit model year %s agrees with the USNO January 1 Delta-T',
    (year, observed) => expect(Math.abs(engine.modelDeltaTSeconds(year) - observed)).toBeLessThan(0.02),
  );

  test('keeps J2000 on TT and houses on UT', async () => {
    const native = await fromWasm(wasmBytes);
    // USNO gives this exact UTC instant as J2000.0 TT.
    const epoch = native.utcToJd(2000, 1, 1, 11, 58, 55.816);
    expect(epoch?.jdTt).toBe(2451545);
    expect(Math.abs(epoch!.jdUt - j2000.jdUt) * secondsPerDay).toBeLessThan(0.02);
    const leap = native.utcToJd(2016, 12, 31, 23, 59, 60)!;
    const newYear = native.utcToJd(2017, 1, 1)!;
    expect((newYear.jdTt - leap.jdTt) * secondsPerDay).toBeCloseTo(1, 4);

    // Deliberately move UT by a minute with TT fixed, to detect UT/TT swaps.
    const changedUt = { ...j2000, jdUt: j2000.jdUt + 60 / secondsPerDay };
    const observer = { longitudeDeg: 0, latitudeDeg: 35 };
    const first = engine.position('Moon', j2000);
    const second = engine.position('Moon', changedUt);
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('Expected Moon positions.');
    expect(second.value).toEqual(first.value);
    const earlier = engine.houses(j2000, observer, 'WholeSign');
    const later = engine.houses(changedUt, observer, 'WholeSign');
    if (earlier.status !== 'ok' || later.status !== 'ok') throw new Error('Expected house results.');
    expect(Math.abs(angleError(later.value.midheavenDeg, earlier.value.midheavenDeg))).toBeGreaterThan(0.2);
  });
});

describe('native event searches', () => {
  test('unwraps the spring equinox in forward and backward UT searches', () => {
    const center = horizons.crossingSampleCenterTt;
    const [, left] = sample(horizons.bodies.Sun.rows, center);
    const [, right] = sample(horizons.bodies.Sun.rows, center + 1 / 48);
    const referenceTt = center - angleError(left, 0) / angleError(right, left) / 48;
    const deltaT = engine.modelDeltaTSeconds(2024.22);
    const forward = engine.crossing('Sun', 0, center - 2, { direction: 1, maxDays: 5 });
    const backward = engine.crossing('Sun', 0, center + 2, { direction: -1, maxDays: 5 });
    for (const event of [forward, backward]) {
      expect(event.warnings).toContain('crossing-uses-modeled-delta-t');
      if (event.status !== 'ok') throw new Error(event.reason);
      expect(Math.abs((event.value.jdUt - referenceTt) * secondsPerDay + deltaT)).toBeLessThan(2);
    }
  });

  test('finds Mercury turning retrograde in TT and reports the change of speed sign', () => {
    const center = horizons.stationSampleCenterTt;
    const h = 1 / 24;
    const [, left] = sample(horizons.bodies.Mercury.rows, center - h);
    const [, mid] = sample(horizons.bodies.Mercury.rows, center);
    const [, right] = sample(horizons.bodies.Mercury.rows, center + h);
    const referenceTt = center + 0.5 * h * (left - right) / (left + right - 2 * mid);
    const event = engine.station('Mercury', center - 2, { direction: 1, maxDays: 5 });
    if (event.status !== 'ok') throw new Error(event.reason);
    expect(event.value.turns).toBe('retrograde');
    expect(Math.abs(event.value.jdTt - referenceTt) * secondsPerDay).toBeLessThan(30);
    const before = engine.position('Mercury', instantAtTt(event.value.jdTt - 0.02, 2024.25));
    const after = engine.position('Mercury', instantAtTt(event.value.jdTt + 0.02, 2024.25));
    expect(before).toMatchObject({ status: 'ok', value: { retrograde: false } });
    expect(after).toMatchObject({ status: 'ok', value: { retrograde: true } });
  });

  test('distinguishes no result, unsupported stations and clipped coverage', () => {
    const options = { direction: 1, maxDays: 1 } as const;
    expect(engine.crossing('Sun', 0, j2000.jdUt, options)).toMatchObject({ reason: 'no-event-returned' });
    expect(engine.crossing('Sun', 360, j2000.jdUt, options)).toMatchObject({ reason: 'invalid-input' });
    expect(engine.station('Moon', j2000.jdTt, options)).toMatchObject({ reason: 'unsupported-body' });
    expect(engine.station('Pluto', EPHEMERA_COVERAGE_TT.end, options)).toMatchObject({
      reason: 'no-event-returned',
      settings: { maxDays: 1, searchedDays: 0 },
      warnings: ['near-coverage-edge', 'search-clamped-to-coverage'],
    });
  });

  test('exposes phenomena, topocentric, siderealTime and equatorial with coverage and input validation', () => {
    const phen = engine.phenomena('Moon', j2000);
    if (phen.status !== 'ok') throw new Error(phen.reason);
    expect(phen.value.illumination).toBeGreaterThan(0);
    expect(phen.value.illumination).toBeLessThan(1);
    expect(phen.value.diameterDeg).toBeGreaterThan(0.45);
    expect(phen.value.diameterDeg).toBeLessThan(0.6);

    const topo = engine.topocentric('Moon', j2000, { latitudeDeg: 53.5461, longitudeDeg: -113.4938 });
    const geo = engine.position('Moon', j2000);
    if (topo.status !== 'ok' || geo.status !== 'ok') throw new Error('Expected Moon positions');
    expect(Math.abs(angleError(topo.value.longitude, geo.value.longitude))).toBeGreaterThan(0.05);
    expect(Math.abs(angleError(topo.value.longitude, geo.value.longitude))).toBeLessThan(1.1);

    const st = engine.siderealTime(j2000);
    if (st.status !== 'ok') throw new Error(st.reason);
    // At j2000 (12:00:00 TT = 11:58:56.17 UT1), GAST is ~0.267° before 12:00:00 UT1 (280.46°).
    expect(st.value.gastDeg).toBeCloseTo(280.1904, 3);
    const stUtNoon = engine.siderealTime({ jdUt: 2451545, jdTt: 2451545 + 63.8285 / secondsPerDay, deltaTYear: 2000 });
    if (stUtNoon.status !== 'ok') throw new Error(stUtNoon.reason);
    expect(stUtNoon.value.gastDeg).toBeCloseTo(280.457, 2);

    const eq = engine.equatorial(geo.value.longitude, geo.value.latitude, j2000);
    if (eq.status !== 'ok') throw new Error(eq.reason);
    expect(Number.isFinite(eq.value.rightAscensionDeg)).toBe(true);
    expect(Number.isFinite(eq.value.declinationDeg)).toBe(true);

    // Input and coverage validation
    expect(engine.phenomena('Chiron', j2000)).toMatchObject({ status: 'unavailable', reason: 'unsupported-body' });
    expect(engine.topocentric('Moon', j2000, { latitudeDeg: 95, longitudeDeg: 0 })).toMatchObject({ status: 'unavailable', reason: 'invalid-input' });
    expect(engine.equatorial(NaN, 0, j2000)).toMatchObject({ status: 'unavailable', reason: 'invalid-input' });
    const outside = instantAtTt(EPHEMERA_COVERAGE_TT.start - 1, 1549.9);
    expect(engine.siderealTime(outside)).toMatchObject({ status: 'unavailable', reason: 'outside-coverage' });
  });
});
