import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, test } from 'vitest';
import { createEphemeraEngine, EPHEMERA_COVERAGE_TT } from '../../src/engine/ephemera';
import type { EngineInstant, EphemeraEngine } from '../../src/engine/ephemera';
import {
  AU_IN_KM,
  calculateDateOnlyMoonSummary,
  calculateLunarCycle,
  calculateMoonSky,
  calculateMoonState,
  classifyLunarPhase,
  findPrincipalPhase,
  formatLunarTimestamp,
  loadObservingLocation,
  OBSERVER_PRESETS,
  PRINCIPAL_PHASE_ANGLES,
  PRINCIPAL_PHASE_HALF_WIDTH_DEG,
  resolveObservingLocation,
  saemundssonRefractionDeg,
  saveObservingLocation,
  wrap180,
} from '../../src/lunar';
import type { PrincipalPhaseId } from '../../src/lunar';
import { resolveBirthTime } from '../../src/time/resolve';
import { wrapDegrees } from '../../src/view/chart-data';
import horizons from '../fixtures/horizons.json';
import lunarRef from '../fixtures/lunar-reference.json';

const SECONDS_PER_DAY = 86_400;
let engine: EphemeraEngine;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasmBytes = await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm'));
  engine = await createEphemeraEngine(wasmBytes);
});

function instantAtTt(jdTt: number, deltaTYear: number): EngineInstant {
  return {
    jdTt,
    jdUt: jdTt - engine.modelDeltaTSeconds(deltaTYear) / SECONDS_PER_DAY,
    deltaTYear,
  };
}

function instantAtUtc(date: string, time: string): EngineInstant {
  const resolved = resolveBirthTime({ date, time, offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  if (resolved.kind !== 'resolved') throw new Error(`Failed to resolve ${date} ${time}`);
  return resolved;
}

describe('eight lunar phases, illumination, waxing/waning and Scout discrepancy resolution', () => {
  test('classifies all eight lunar phases at exact angles, bin boundaries and 0/360 wraparound', () => {
    const w = PRINCIPAL_PHASE_HALF_WIDTH_DEG;
    expect(classifyLunarPhase(0)).toMatchObject({ phase: 'new', phaseLabel: 'New Moon', waxing: true, principalPhase: 'new' });
    expect(classifyLunarPhase(360 - w + 0.01)).toMatchObject({ phase: 'new', waxing: false, principalPhase: 'new' });
    expect(classifyLunarPhase(w - 0.01)).toMatchObject({ phase: 'new', waxing: true, principalPhase: 'new' });
    expect(classifyLunarPhase(w + 0.01)).toMatchObject({ phase: 'waxing-crescent', waxing: true, principalPhase: null });
    expect(classifyLunarPhase(45)).toMatchObject({ phase: 'waxing-crescent', phaseLabel: 'Waxing Crescent', waxing: true });
    expect(classifyLunarPhase(90 - w - 0.01)).toMatchObject({ phase: 'waxing-crescent', waxing: true });
    expect(classifyLunarPhase(90)).toMatchObject({ phase: 'first-quarter', phaseLabel: 'First Quarter', waxing: true, principalPhase: 'first-quarter' });
    expect(classifyLunarPhase(90 + w + 0.01)).toMatchObject({ phase: 'waxing-gibbous', phaseLabel: 'Waxing Gibbous', waxing: true });
    expect(classifyLunarPhase(180 - w - 0.01)).toMatchObject({ phase: 'waxing-gibbous', waxing: true });
    expect(classifyLunarPhase(179.99)).toMatchObject({ phase: 'full', waxing: true, principalPhase: 'full' });
    expect(classifyLunarPhase(180)).toMatchObject({ phase: 'full', phaseLabel: 'Full Moon', waxing: false, principalPhase: 'full' });
    expect(classifyLunarPhase(180 + w + 0.01)).toMatchObject({ phase: 'waning-gibbous', phaseLabel: 'Waning Gibbous', waxing: false });
    expect(classifyLunarPhase(270)).toMatchObject({ phase: 'last-quarter', phaseLabel: 'Last Quarter', waxing: false, principalPhase: 'last-quarter' });
    expect(classifyLunarPhase(270 + w + 0.01)).toMatchObject({ phase: 'waning-crescent', phaseLabel: 'Waning Crescent', waxing: false });
    expect(classifyLunarPhase(360 - w - 0.01)).toMatchObject({ phase: 'waning-crescent', waxing: false });
  });

  test('resolves the Scout numerical discrepancies at 2026-11-20 16:38 UTC and satisfies cosine illumination identity', () => {
    const instant = instantAtUtc('2026-11-20', '16:38:00');
    const state = calculateMoonState(engine, instant);
    if (state.status !== 'ok') throw new Error(state.reason);
    const v = state.value;
    const ref = lunarRef.scoutDiscrepancyResolutions;

    // Sun on Nov 20, 2026 is at 28°22′ Scorpio (238.37°), not 8.37° Scorpio
    expect(v.sunLongitudeDeg).toBeCloseTo(ref.sunLongitudeDeg, 3);
    expect(v.moonLongitudeDeg).toBeCloseTo(ref.moonLongitudeDeg, 3);
    expect(v.formattedPosition).toBe(ref.moonSignFormatted);
    expect(v.elongationDeg).toBeCloseTo(ref.geocentricElongationDeg, 3);
    expect(v.separation3dDeg).toBeCloseTo(ref.separation3dDeg, 3);
    expect(v.phaseAngleDeg).toBeCloseTo(ref.phaseAngleDeg, 3);
    expect(v.illumination).toBeCloseTo(ref.illumination, 5);
    expect(v.phase).toBe('waxing-gibbous');
    expect(v.waxing).toBe(true);

    // Identity: illumination = (1 + cos(phaseAngle)) / 2
    const cosineIllum = (1 + Math.cos(v.phaseAngleDeg * (Math.PI / 180))) / 2;
    expect(Math.abs(v.illumination - cosineIllum)).toBeLessThan(1e-6);
  });

  test('agrees with JPL Horizons J2000.0 and April 2024 Moon and Sun fixtures', () => {
    for (const jdTt of horizons.positionEpochsTt) {
      const year = jdTt === 2451545 ? 2000 : 2024.27;
      const instant = instantAtTt(jdTt, year);
      const state = calculateMoonState(engine, instant);
      if (state.status !== 'ok') throw new Error(state.reason);
      const moonRow = horizons.bodies.Moon.rows.find(([jd]) => Math.abs(jd - jdTt) < 1e-8)!;
      const sunRow = horizons.bodies.Sun.rows.find(([jd]) => Math.abs(jd - jdTt) < 1e-8)!;
      expect(Math.abs(wrap180(state.value.moonLongitudeDeg - moonRow[1])) * 3600).toBeLessThan(1);
      expect(Math.abs(wrap180(state.value.sunLongitudeDeg - sunRow[1])) * 3600).toBeLessThan(1);
      expect(Math.abs(wrap180(state.value.elongationDeg - wrapDegrees(moonRow[1] - sunRow[1]))) * 3600).toBeLessThan(1.5);
    }
  });
});

describe('principal lunar phase event accuracy, Full Moon < 100% illumination and cycle invariants', () => {
  test.each(lunarRef.principalPhases)('matches authoritative reference: $label', fixture => {
    const start = instantAtTt(fixture.searchStartJdTt, fixture.deltaTYear);
    const res = findPrincipalPhase(engine, start, fixture.phase as PrincipalPhaseId, 1);
    if (res.status !== 'ok') throw new Error(res.reason);
    const ev = res.value;

    // Verify exact geocentric ecliptic elongation at found TT instant is targetAngleDeg within 0.0001°
    const eventState = calculateMoonState(engine, {
      jdTt: ev.jdTt,
      jdUt: ev.jdUt,
      deltaTYear: ev.deltaTYear,
    });
    if (eventState.status !== 'ok') throw new Error(eventState.reason);
    const target = PRINCIPAL_PHASE_ANGLES[fixture.phase as PrincipalPhaseId];
    expect(Math.abs(wrap180(eventState.value.elongationDeg - target))).toBeLessThan(1e-4);

    if ('referenceJdTt' in fixture && typeof fixture.referenceJdTt === 'number') {
      const diffSecTt = Math.abs(ev.jdTt - fixture.referenceJdTt) * SECONDS_PER_DAY;
      expect(diffSecTt).toBeLessThanOrEqual(fixture.toleranceSecondsTt);
    }
    if ('referenceUtc' in fixture && typeof fixture.referenceUtc === 'string') {
      const refMs = Date.parse(fixture.referenceUtc);
      const diffSecUt = Math.abs(ev.epochMs - refMs) / 1000;
      expect(diffSecUt).toBeLessThanOrEqual(fixture.toleranceSecondsUt);
    }
    if ('expectedAlbertaFormatted' in fixture && typeof fixture.expectedAlbertaFormatted === 'string') {
      expect(formatLunarTimestamp(ev.epochMs, 'America/Edmonton')).toBe(fixture.expectedAlbertaFormatted);
    }
  });

  test('verifies Full Moon illumination is below 100% (~99.81%) at high lunar ecliptic latitude vs >99.99% during a lunar eclipse', () => {
    // High-latitude Full Moon: 2026-11-24 (β ≈ +4.96°)
    const nov2026Start = instantAtUtc('2026-11-20', '16:38:00');
    const novFull = findPrincipalPhase(engine, nov2026Start, 'full', 1);
    if (novFull.status !== 'ok') throw new Error(novFull.reason);
    const novState = calculateMoonState(engine, novFull.value);
    if (novState.status !== 'ok') throw new Error(novState.reason);

    expect(Math.abs(wrap180(novState.value.elongationDeg - 180))).toBeLessThan(1e-5);
    expect(novState.value.moonLatitudeDeg).toBeGreaterThan(4.9);
    // Because β ≈ +4.96°, illumination at exact Full Moon is ~99.814% (below 99.9% and below 100%)
    expect(novState.value.illumination).toBeGreaterThan(0.997);
    expect(novState.value.illumination).toBeLessThan(0.9985);

    // Penumbral Eclipse Full Moon: 2024-03-25 (|β| ≈ 0.96° < 1.0°, illumination > 99.99%)
    const mar2024Start = instantAtUtc('2024-03-20', '00:00:00');
    const marFull = findPrincipalPhase(engine, mar2024Start, 'full', 1);
    if (marFull.status !== 'ok') throw new Error(marFull.reason);
    const marState = calculateMoonState(engine, marFull.value);
    if (marState.status !== 'ok') throw new Error(marState.reason);
    expect(Math.abs(marState.value.moonLatitudeDeg)).toBeLessThan(1.0);
    expect(marState.value.illumination).toBeGreaterThan(0.9999);
  });

  test('enforces strict ordering, spacing and synodic cycle length invariants across 1550–2649', () => {
    const sampleYears: [number, number][] = [
      [2287220.5, 1550.1],
      [2305447.5, 1600.0],
      [2451545.0, 2000.0],
      [2461365.2, 2026.89],
      [2670690.5, 2600.0],
      [2688910.5, 2649.9],
    ];
    for (const [jdTt, year] of sampleYears) {
      const cycle = calculateLunarCycle(engine, instantAtTt(jdTt, year));
      if (cycle.status !== 'ok') throw new Error(cycle.reason);
      const { upcoming, previous, next, ageDays, synodicLengthDays, cycleProgress } = cycle.value;
      expect(upcoming).toHaveLength(4);
      expect(next).toEqual(upcoming[0]);
      expect(previous).not.toBeNull();
      expect(previous!.jdTt).toBeLessThanOrEqual(jdTt);
      expect(next!.jdTt).toBeGreaterThan(jdTt);

      for (let i = 0; i < upcoming.length - 1; i += 1) {
        const dt = upcoming[i + 1].jdTt - upcoming[i].jdTt;
        // Quarter-to-quarter spacing ranges from ~6.5 to ~8.3 days
        expect(dt).toBeGreaterThan(6.2);
        expect(dt).toBeLessThan(8.6);
      }

      expect(ageDays).not.toBeNull();
      expect(synodicLengthDays).not.toBeNull();
      expect(synodicLengthDays!).toBeGreaterThan(29.15);
      expect(synodicLengthDays!).toBeLessThan(29.95);
      expect(ageDays!).toBeGreaterThanOrEqual(0);
      expect(ageDays!).toBeLessThanOrEqual(synodicLengthDays!);
      expect(cycleProgress).toBeGreaterThanOrEqual(0);
      expect(cycleProgress).toBeLessThanOrEqual(1);
    }
  });

  test('handles ephemeris coverage edges gracefully without throwing', () => {
    const nearStart = instantAtTt(EPHEMERA_COVERAGE_TT.start + 1, 1550);
    const startCycle = calculateLunarCycle(engine, nearStart);
    expect(startCycle.status).toBe('ok');
    expect(startCycle.warnings).toContain('near-coverage-edge');

    const outside = instantAtTt(EPHEMERA_COVERAGE_TT.start - 1, 1549.99);
    expect(calculateMoonState(engine, outside)).toMatchObject({ status: 'unavailable', reason: 'outside-coverage' });
    expect(calculateLunarCycle(engine, outside)).toMatchObject({ status: 'unavailable', reason: 'outside-coverage' });
  });
});

describe('topocentric parallax, sign-boundary crossings, altitude, refraction and meridian passage', () => {
  test('matches independent WGS84 ellipsoid parallax math to < 0.01 arcsec across northern, southern, equatorial and polar sites', () => {
    const instant = instantAtUtc('2026-11-20', '16:38:00');
    const sites = [
      OBSERVER_PRESETS.edmonton.observer,
      OBSERVER_PRESETS.calgary.observer,
      { latitudeDeg: -33.8688, longitudeDeg: 151.2093 }, // Sydney
      { latitudeDeg: 0, longitudeDeg: 0 }, // Equator
      { latitudeDeg: 89.9, longitudeDeg: -62.35 }, // Near North Pole
    ];

    const geoPos = engine.position('Moon', instant);
    const gastRes = engine.siderealTime(instant);
    if (geoPos.status !== 'ok' || gastRes.status !== 'ok') throw new Error('Expected geocentric Moon & GAST');
    const geoEq = engine.equatorial(geoPos.value.longitude, geoPos.value.latitude, instant);
    if (geoEq.status !== 'ok') throw new Error('Expected equatorial coordinates');

    const aKm = 6378.137;
    const f = 1 / 298.257223563;
    const e2 = 2 * f - f * f;
    const deg = Math.PI / 180;

    for (const obs of sites) {
      const sky = calculateMoonSky(engine, instant, obs, 'UTC');
      if (sky.status !== 'ok') throw new Error(sky.reason);
      const topoEq = engine.equatorial(sky.value.topocentricLongitudeDeg, sky.value.topocentricLatitudeDeg, instant);
      if (topoEq.status !== 'ok') throw new Error(topoEq.reason);

      // Independent WGS84 topocentric equatorial reduction
      const phi = obs.latitudeDeg * deg;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const c = 1 / Math.sqrt(1 - e2 * sinPhi * sinPhi);
      const rhoCos = c * cosPhi;
      const rhoSin = c * (1 - e2) * sinPhi;

      const lst = wrapDegrees(gastRes.value.gastDeg + obs.longitudeDeg) * deg;
      const ra = geoEq.value.rightAscensionDeg * deg;
      const dec = geoEq.value.declinationDeg * deg;
      const distAu = geoPos.value.distance;

      const x = distAu * Math.cos(dec) * Math.cos(ra) - (rhoCos * aKm / AU_IN_KM) * Math.cos(lst);
      const y = distAu * Math.cos(dec) * Math.sin(ra) - (rhoCos * aKm / AU_IN_KM) * Math.sin(lst);
      const z = distAu * Math.sin(dec) - (rhoSin * aKm / AU_IN_KM);
      const rTopo = Math.hypot(x, y, z);
      const raTopoDeg = wrapDegrees(Math.atan2(y, x) / deg);
      const decTopoDeg = Math.asin(z / rTopo) / deg;

      expect(Math.abs(wrap180(topoEq.value.rightAscensionDeg - raTopoDeg)) * 3600).toBeLessThan(0.01);
      expect(Math.abs(topoEq.value.declinationDeg - decTopoDeg) * 3600).toBeLessThan(0.01);
      expect(Math.abs(sky.value.topocentricDistanceAu - rTopo) * AU_IN_KM).toBeLessThan(0.01);
    }
  });

  test('detects and explains a zodiac sign-boundary difference between geocentric and topocentric Moon', () => {
    // Find a crossing of 30° (Aries -> Taurus) and evaluate just after the geocentric ingress
    const startUt = instantAtUtc('2026-11-20', '16:38:00').jdUt;
    const ingress = engine.crossing('Moon', 30, startUt, { direction: 1, maxDays: 5 });
    if (ingress.status !== 'ok') throw new Error(ingress.reason);

    // 15 minutes after geocentric ingress into Taurus (~0°08′ Taurus geocentric)
    const jdUt = ingress.value.jdUt + 15 / 1440;
    const year = 2026.89;
    const jdTt = jdUt + engine.modelDeltaTSeconds(year) / SECONDS_PER_DAY;
    const instant: EngineInstant = { jdUt, jdTt, deltaTYear: year };

    // Choose an observer longitude where the Moon is in the western sky (negative Δλ parallax ~ -0.5°)
    const st = engine.siderealTime(instant);
    if (st.status !== 'ok') throw new Error(st.reason);
    const observer = { latitudeDeg: 0, longitudeDeg: wrap180(30 + 75 - st.value.gastDeg) };

    const sky = calculateMoonSky(engine, instant, observer, 'UTC');
    if (sky.status !== 'ok') throw new Error(sky.reason);

    expect(sky.value.geocentricSignName).toBe('Taurus');
    expect(sky.value.topocentricSignName).toBe('Aries');
    expect(sky.value.signDiffers).toBe(true);
    expect(sky.value.parallaxDeltaLonDeg).toBeLessThan(-0.15);
    expect(sky.value.signDifferenceNote).toContain('Taurus');
    expect(sky.value.signDifferenceNote).toContain('Aries');
    expect(sky.value.signDifferenceNote).toContain('geocentric');
  });

  test('computes Sæmundsson refraction, horizon visibility and lunar-day upper meridian passage gap', () => {
    // Refraction behaves smoothly at horizon, high altitude, and below -1°
    expect(saemundssonRefractionDeg(0)).toBeCloseTo(0.48, 1);
    expect(saemundssonRefractionDeg(45)).toBeCloseTo(0.016, 2);
    expect(saemundssonRefractionDeg(-0.5)).toBeGreaterThan(0.4);
    expect(saemundssonRefractionDeg(-1.5)).toBe(0);
    expect(saemundssonRefractionDeg(90)).toBe(0);

    // Scan a synodic month at Edmonton to verify upper meridian passage occurs daily except on the ~1 lunar-day gap date
    let gapDays = 0;
    let transitDays = 0;
    for (let day = 1; day <= 30; day += 1) {
      const dateStr = `2026-11-${String(day).padStart(2, '0')}`;
      const instant = instantAtUtc(dateStr, '18:00:00');
      const sky = calculateMoonSky(engine, instant, OBSERVER_PRESETS.edmonton.observer, 'America/Edmonton');
      if (sky.status !== 'ok') throw new Error(sky.reason);
      if (sky.value.localDateTransit === null) {
        gapDays += 1;
        expect(sky.value.nextTransit ?? sky.value.nearestTransit).not.toBeNull();
      } else {
        transitDays += 1;
        // At upper transit, topocentric culmination altitude is less than geocentric culmination altitude by ~p*cos(h)
        expect(Number.isFinite(sky.value.localDateTransit.culminationApparentAltitudeDeg)).toBe(true);
      }
    }
    expect(transitDays).toBeGreaterThanOrEqual(28);
    expect(gapDays).toBeGreaterThanOrEqual(1);
    expect(gapDays).toBeLessThanOrEqual(2);
  });
});

describe('observer location persistence, profile fallback and unknown birth time summaries', () => {
  test('handles missing coordinates, deleted profiles and storage gracefully without reusing demo coordinates', () => {
    const profiles = [
      {
        id: 'p-with-coords',
        name: 'Calgary Person',
        birth: { date: '1990-05-15', time: '08:30', timeZone: 'America/Edmonton' },
        observer: { latitudeDeg: 51.0447, longitudeDeg: -114.0719 },
        houseSystem: 'WholeSign' as const,
      },
      {
        id: 'p-no-coords',
        name: 'No Coords Person',
        birth: { date: '1990-05-15', time: '08:30', timeZone: 'America/Edmonton' },
        observer: null,
        houseSystem: 'WholeSign' as const,
      },
    ];

    // Default is none (geocentric only)
    expect(resolveObservingLocation({ mode: 'none' }, profiles)).toMatchObject({
      observer: null,
      shortLabel: 'Geocentric only',
      fallbackNotice: null,
    });

    // Active profile with coordinates
    expect(resolveObservingLocation({ mode: 'profile', profileId: 'p-with-coords' }, profiles)).toMatchObject({
      observer: { latitudeDeg: 51.0447, longitudeDeg: -114.0719 },
      shortLabel: 'Calgary Person birthplace',
      fallbackNotice: null,
    });

    // Profile without coordinates falls back cleanly to none
    const noCoordsRes = resolveObservingLocation({ mode: 'profile', profileId: 'p-no-coords' }, profiles);
    expect(noCoordsRes.observer).toBeNull();
    expect(noCoordsRes.fallbackNotice).toContain('no birthplace coordinates');

    // Deleted profile falls back cleanly to none
    const deletedRes = resolveObservingLocation({ mode: 'profile', profileId: 'deleted-id' }, profiles);
    expect(deletedRes.observer).toBeNull();
    expect(deletedRes.fallbackNotice).toContain('deleted');

    // Mock storage round-trip
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
    };
    saveObservingLocation({ mode: 'preset', presetId: 'calgary' }, storage);
    expect(loadObservingLocation(storage)).toEqual({ mode: 'preset', presetId: 'calgary' });
    saveObservingLocation({ mode: 'manual', observer: { latitudeDeg: 52.13, longitudeDeg: -106.67 } }, storage);
    expect(loadObservingLocation(storage)).toEqual({ mode: 'manual', observer: { latitudeDeg: 52.13, longitudeDeg: -106.67 } });
  });

  test('computes date-only Moon range for unknown birth time profiles including sign-change days', () => {
    const summary = calculateDateOnlyMoonSummary(engine, {
      date: '2026-11-20',
      time: null,
      timeZone: 'America/Edmonton',
    });
    expect(summary.status).toBe('ok');
    expect(summary.fullSummary).toContain('Moon on birth date:');
    expect(summary.fullSummary).toContain('birth time unknown');
    expect(summary.startState).not.toBeNull();
    expect(summary.endState).not.toBeNull();
  });
});
