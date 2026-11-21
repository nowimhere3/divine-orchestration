import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, test } from 'vitest';
import { angularSeparation, calculateAspects, createAspectRuleSet, MAJOR_ASPECT_ANGLES } from '../../src/domain/aspects';
import type { AspectId } from '../../src/domain/aspects';
import { createDateOnlyNatalChart, PLANET_IDS } from '../../src/domain/chart';
import type { HouseFacts, PlanetId, TimedChart } from '../../src/domain/chart';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import type { EphemeraEngine } from '../../src/engine/ephemera';
import {
  aspectMotionState,
  buildTransitEnrichmentRequest,
  calculateDateOnlyNatalFacts,
  calculateTransitAngleAspects,
  computeTransitEnrichment,
  EXACT_ORB_THRESHOLD_DEG,
  inspectorPersonalTransit,
  interpretTransits,
  scoreTransitAspect,
  STATIONARY_SPEED_DEG_PER_DAY,
  transitBucket,
  transitMaxOrb,
  transitSymbolicMeanings,
  transitWindowKey,
} from '../../src/interpret';
import { composeTransitAspectSynthesis } from '../../src/interpret/copy-transits';
import { instantFromTt } from '../../src/time/ephemeris-time';
import { searchEvents } from '../../src/search/events';
import type { TransitReading } from '../../src/interpret';
import { formatLunarTimestamp } from '../../src/lunar';
import { resolveBirthTime } from '../../src/time/resolve';
import { availablePositions, calculateNatal, calculatePositions, planetName, wrapDegrees } from '../../src/view/chart-data';
import type { PositionMap } from '../../src/view/chart-data';

const FORBIDDEN_COPY = /\byou will\b|\bwill happen\b|\bdestined\b|\bguaranteed\b|\bdoomed\b|\bdefinitely\b|\bastro\.com\b|\bco-?star\b|\bastro-?seek\b|\bcafe astrology\b/i;

let engine: EphemeraEngine;
const aspectRules = createAspectRuleSet();

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm'));
  engine = await createEphemeraEngine(wasm);
});

function buildNatalFixture(date: string, time: string, timeZone: string, observer: { latitudeDeg: number; longitudeDeg: number } | null) {
  const resolved = resolveBirthTime({ date, time, timeZone }, engine.modelDeltaTSeconds);
  if (resolved.kind !== 'resolved') throw new Error(`Could not resolve ${date} ${time} ${timeZone}`);
  const chart = calculateNatal(engine, resolved, observer, 'WholeSign') as TimedChart;
  const positions = chart.planets.status === 'available' ? availablePositions(chart.planets.value) : new Map();
  const houses: HouseFacts | null = chart.houses.status === 'available' ? chart.houses.value : null;
  return { chart: { ...chart, label: 'Fixture Natal' }, positions, houses, resolved };
}

function buildTransitSnapshot(
  natal: ReturnType<typeof buildNatalFixture>,
  transitDate: string,
  transitTime: string,
  displayZone = 'UTC',
  enrich = false,
): { reading: TransitReading; transitPositions: PositionMap; selectedTt: number } {
  const tResolved = resolveBirthTime({ date: transitDate, time: transitTime, timeZone: 'UTC' }, engine.modelDeltaTSeconds);
  if (tResolved.kind !== 'resolved' || !tResolved.utc) throw new Error(`Could not resolve transit ${transitDate}`);
  const { planets } = calculatePositions(engine, tResolved);
  const transitPositions = availablePositions(planets);
  const crossAspects = calculateAspects([
    ...[...natal.positions].map(([planetId, p]) => ({ chartId: 'natal', planetId, longitudeDeg: p.longitudeDeg })),
    ...[...transitPositions].map(([planetId, p]) => ({ chartId: 'transit', planetId, longitudeDeg: p.longitudeDeg })),
  ], aspectRules).filter(a => a.from.chartId !== a.to.chartId);

  const momentLabel = formatLunarTimestamp(Date.parse(tResolved.utc), displayZone);
  const baseInput = {
    natalChart: natal.chart,
    natalPositions: natal.positions,
    transitPositions,
    transitAspects: crossAspects,
    houses: natal.houses,
    chartRulerId: null as PlanetId | null,
    dateOnlyNatalFacts: null,
    transitMoonState: null,
    selectedTt: tResolved.jdTt,
    momentLabel,
    displayZone,
    isDemo: false,
    birthSummary: `${natal.chart.time.input.date} · ${natal.chart.time.input.time}`,
  };

  let reading = interpretTransits({ ...baseInput, enrichment: null, enrichmentState: 'idle' });
  if (enrich) {
    const req = buildTransitEnrichmentRequest(reading, natal.positions, natal.houses, 'test-sig');
    if (req) {
      const enrichment = computeTransitEnrichment(engine, req);
      reading = interpretTransits({ ...baseInput, enrichment, enrichmentState: 'ready' });
    }
  }
  return { reading, transitPositions, selectedTt: tResolved.jdTt };
}

describe('U5B Transit Mathematics & Motion State', () => {
  test('aspectMotionState agrees with finite-difference orb derivatives across all 5 aspects, direct & retrograde, and 0°/180° wraparound', () => {
    const aspects: AspectId[] = ['conjunction', 'sextile', 'square', 'trine', 'opposition'];
    const targetLongitudes = [0.4, 359.6, 179.5, 180.5, 42.25, 295.8];
    const speeds = [1.0, -0.85, 0.05, -0.04];
    const offsets = [-2.2, -0.5, 0.5, 2.2];
    const dt = 1e-4;

    for (const aspect of aspects) {
      const exactAngle = MAJOR_ASPECT_ANGLES[aspect];
      for (const targetLon of targetLongitudes) {
        for (const signSide of [-1, 1]) {
          // Skip duplicate geometry for 0° and 180° when signSide is redundant
          for (const offset of offsets) {
            const transitLon = wrapDegrees(targetLon + signSide * exactAngle + offset);
            const orb0 = Math.abs(angularSeparation(transitLon, targetLon) - exactAngle);
            if (orb0 <= EXACT_ORB_THRESHOLD_DEG + 0.02) continue;
            for (const speed of speeds) {
              const transitLonNext = wrapDegrees(transitLon + speed * dt);
              const orbNext = Math.abs(angularSeparation(transitLonNext, targetLon) - exactAngle);
              const expected = orbNext < orb0 ? 'applying' : 'separating';
              const actual = aspectMotionState(transitLon, speed, targetLon, aspect);
              expect(actual, `${aspect} target=${targetLon} transit=${transitLon} speed=${speed}`).toBe(expected);
            }
          }
        }
      }
    }
  });

  test('aspectMotionState classifies exact orb and stationary speed conservatively', () => {
    // Stationary takes precedence when speed magnitude is below threshold
    expect(aspectMotionState(120.5, 0, 120, 'conjunction')).toBe('stationary');
    expect(aspectMotionState(120.5, STATIONARY_SPEED_DEG_PER_DAY * 0.5, 120, 'conjunction')).toBe('stationary');
    expect(aspectMotionState(120.02, 0.00001, 120, 'conjunction')).toBe('stationary');

    // Exact when within EXACT_ORB_THRESHOLD_DEG and moving
    expect(aspectMotionState(120.05, 0.5, 120, 'conjunction')).toBe('exact');
    expect(aspectMotionState(359.95, -0.4, 0.01, 'conjunction')).toBe('exact');
    expect(aspectMotionState(300.04, 0.8, 120, 'opposition')).toBe('exact');
  });

  test('deterministic prioritization ranks tight outer/Saturn contacts above wide Moon contacts and boosts angles/chart ruler', () => {
    const saturnSunTight = scoreTransitAspect({
      transitId: 'saturn',
      target: { kind: 'planet', planetId: 'sun' },
      aspect: 'square',
      orbDeg: 0.2,
      motion: 'applying',
    });
    const moonMarsWide = scoreTransitAspect({
      transitId: 'moon',
      target: { kind: 'planet', planetId: 'mars' },
      aspect: 'sextile',
      orbDeg: 3.5,
      motion: 'separating',
    });
    const saturnRuler = scoreTransitAspect({
      transitId: 'saturn',
      target: { kind: 'planet', planetId: 'venus' },
      aspect: 'square',
      orbDeg: 0.5,
      motion: 'applying',
      chartRulerId: 'venus',
    });
    const saturnNonRuler = scoreTransitAspect({
      transitId: 'saturn',
      target: { kind: 'planet', planetId: 'venus' },
      aspect: 'square',
      orbDeg: 0.5,
      motion: 'applying',
      chartRulerId: null,
    });
    const plutoAsc = scoreTransitAspect({
      transitId: 'pluto',
      target: { kind: 'angle', angle: 'asc' },
      aspect: 'conjunction',
      orbDeg: 0.3,
      motion: 'exact',
    });

    expect(saturnSunTight).toBeGreaterThan(moonMarsWide);
    expect(saturnRuler).toBeGreaterThan(saturnNonRuler);
    expect(plutoAsc).toBeGreaterThan(saturnNonRuler);

    expect(transitBucket('pluto')).toBe('long-term');
    expect(transitBucket('saturn')).toBe('long-term');
    expect(transitBucket('jupiter')).toBe('long-term');
    expect(transitBucket('mars')).toBe('medium-term');
    expect(transitBucket('sun')).toBe('medium-term');
    expect(transitBucket('mercury')).toBe('medium-term');
    expect(transitBucket('moon')).toBe('lunar-brief');
  });
});

describe('U5B Tier-2 Enrichment: Retrograde Triple Passes, Outer Stitching & Natal Houses', () => {
  test('Mercury triple-pass fixture (2024 Aries 20°) yields 3 exact passes with pass 2 retrograde and Horizons-bracketed timestamps', async () => {
    const fixtureRaw = await readFile(new URL('../fixtures/horizons-mercury-triple.json', import.meta.url), 'utf8');
    const fixture = JSON.parse(fixtureRaw) as {
      targetLongitudeDeg: number;
      contacts: [[number, number], [number, number]][];
      stations: [[number, number], [number, number], [number, number]][];
    };

    // Select a moment right near pass 2 (retrograde pass on 2024-04-15)
    const midResolved = resolveBirthTime({ date: '2024-04-15', time: '09:00', timeZone: 'UTC' }, engine.modelDeltaTSeconds);
    if (midResolved.kind !== 'resolved') throw new Error('Expected resolved Mercury mid date');

    const pairKey = transitWindowKey('mercury', { kind: 'planet', planetId: 'sun' }, 'conjunction');
    const enrichment = computeTransitEnrichment(engine, {
      signature: 'mercury-triple-test',
      selectedTt: midResolved.jdTt,
      pairs: [{
        key: pairKey,
        transitId: 'mercury',
        target: { kind: 'planet', planetId: 'sun' },
        targetLongitudeDeg: fixture.targetLongitudeDeg,
        aspect: 'conjunction',
        allowedOrbDeg: 4.0,
      }],
      houseTargets: [],
    });

    const win = enrichment.windows[pairKey];
    expect(win).toBeDefined();
    expect(win.isRetrogradeSeries).toBe(true);
    const exactPasses = win.passes.filter(p => p.state !== 'near-miss');
    expect(exactPasses).toHaveLength(3);
    expect(exactPasses.map(p => p.passNumber)).toEqual([1, 2, 3]);
    expect(exactPasses.every(p => p.totalExactPasses === 3)).toBe(true);
    expect(exactPasses[0].retrograde).toBe(false);
    expect(exactPasses[1].retrograde).toBe(true);
    expect(exactPasses[2].retrograde).toBe(false);

    // Verify each exact pass JD TT falls inside NASA/JPL Horizons 3-hour contact bracket (±0.02d tolerance)
    for (let i = 0; i < 3; i++) {
      const [leftJd] = fixture.contacts[i][0];
      const [rightJd] = fixture.contacts[i][1];
      expect(exactPasses[i].jdTt).toBeGreaterThanOrEqual(leftJd - 0.02);
      expect(exactPasses[i].jdTt).toBeLessThanOrEqual(rightJd + 0.02);
    }

    // Nearby stations around 2024-04-15 should capture Mercury's stations (within ±14d)
    const mercuryStations = enrichment.nearbyStations.filter(s => s.planetId === 'mercury');
    expect(mercuryStations.length).toBeGreaterThanOrEqual(1);
    const stationDirections = new Set(mercuryStations.map(s => s.turns));
    expect(stationDirections.has('retrograde') || stationDirections.has('direct')).toBe(true);
  });

  test('slow outer-planet enrichment stitches across 2x365-day chunks and computes retrograde-aware natal house stays', () => {
    // Saturn in Pisces around 2024-09-01 (retrograde in mid-Pisces, ~16° Pisces)
    const mid = resolveBirthTime({ date: '2024-09-01', time: '12:00', timeZone: 'UTC' }, engine.modelDeltaTSeconds);
    if (mid.kind !== 'resolved') throw new Error('Expected resolved Saturn date');
    const satPos = engine.position('Saturn', mid);
    if (satPos.status !== 'ok') throw new Error('Expected Saturn position');

    // Target a natal degree Saturn hits multiple times across its 2024–2025 retrograde loop (~16° Pisces = 346°)
    const targetLon = 346.0;
    const key = transitWindowKey('saturn', { kind: 'planet', planetId: 'sun' }, 'conjunction');
    // Whole Sign House 12 spanning 330°–360° (Pisces)
    const enrichment = computeTransitEnrichment(engine, {
      signature: 'saturn-stitch-test',
      selectedTt: mid.jdTt,
      pairs: [{
        key,
        transitId: 'saturn',
        target: { kind: 'planet', planetId: 'sun' },
        targetLongitudeDeg: targetLon,
        aspect: 'conjunction',
        allowedOrbDeg: 3.5,
      }],
      houseTargets: [{
        planetId: 'saturn',
        houseNumber: 12,
        cuspStartDeg: 330,
        cuspEndDeg: 360,
      }],
    });

    const win = enrichment.windows[key];
    expect(win).toBeDefined();
    expect(win.isRetrogradeSeries).toBe(true);
    const exactPasses = win.passes.filter(p => p.state !== 'near-miss');
    expect(exactPasses.length).toBeGreaterThanOrEqual(3);
    expect(exactPasses.some(p => p.retrograde === true)).toBe(true);
    // Span between pass 1 and pass 3 for Saturn is ~9 months (~270d), well captured by 2-chunk ±365d search
    const spanDays = exactPasses[exactPasses.length - 1].jdTt - exactPasses[0].jdTt;
    expect(spanDays).toBeGreaterThan(200);

    // Check natal house ingress/egress for Saturn in Pisces (330°..360°)
    const houseSpan = enrichment.houseSpans.saturn;
    expect(houseSpan).toBeDefined();
    expect(houseSpan!.houseNumber).toBe(12);
    // Saturn enters Pisces in early March 2023 and exits into Aries in late May 2025
    expect(houseSpan!.clippedEntry).toBe(false);
    expect(houseSpan!.enteredAtEpochMs).not.toBeNull();
    expect(houseSpan!.enteredAtEpochMs!).toBeGreaterThan(Date.parse('2023-03-01T00:00:00Z'));
    expect(houseSpan!.enteredAtEpochMs!).toBeLessThan(Date.parse('2023-03-15T00:00:00Z'));
    expect(houseSpan!.exitsAtEpochMs).not.toBeNull();
    expect(houseSpan!.exitsAtEpochMs!).toBeGreaterThan(Date.parse('2025-05-01T00:00:00Z'));
    expect(houseSpan!.exitsAtEpochMs!).toBeLessThan(Date.parse('2025-06-05T00:00:00Z'));
  });

  test('detects retrograde house cusp re-entry when a planet crosses a cusp, retrogrades out, and re-enters', () => {
    // Mercury in April 2024 retrogrades from ~27° Aries back to ~15.98° Aries.
    // Put a natal house cusp at 20° Aries -> 50° Taurus so Mercury enters >20°, retrogrades <20°, and re-enters >20°.
    const at = resolveBirthTime({ date: '2024-04-02', time: '00:00', timeZone: 'UTC' }, engine.modelDeltaTSeconds);
    if (at.kind !== 'resolved') throw new Error('Expected resolved Mercury date');

    const enrichment = computeTransitEnrichment(engine, {
      signature: 'mercury-house-reentry',
      selectedTt: at.jdTt,
      pairs: [],
      houseTargets: [{
        planetId: 'mercury',
        houseNumber: 5,
        cuspStartDeg: 20,
        cuspEndDeg: 50,
      }],
    });

    const span = enrichment.houseSpans.mercury;
    expect(span).toBeDefined();
    expect(span!.enteredAtEpochMs).not.toBeNull();
    expect(span!.exitsAtEpochMs).not.toBeNull();
    expect(span!.includesRetrogradeReentry).toBe(true);
  });

  test('Mars 2020-09-09 station retrograde series derives clipped end from chronological outer window and never ends before pass 3', () => {
    const marsTt = 2459102.5; // 2020-09-09 Mars retrograde station
    const marsPos = engine.position('Mars', instantFromTt(marsTt, engine.modelDeltaTSeconds));
    if (marsPos.status !== 'ok') throw new Error('Expected Mars position');
    const targetLon = wrapDegrees(marsPos.value.longitude - 0.6);
    const key = transitWindowKey('mars', { kind: 'planet', planetId: 'sun' }, 'conjunction');

    const enrichment = computeTransitEnrichment(engine, {
      signature: 'mars-2020-station',
      selectedTt: marsTt,
      pairs: [{
        key,
        transitId: 'mars',
        target: { kind: 'planet', planetId: 'sun' },
        targetLongitudeDeg: targetLon,
        aspect: 'conjunction',
        allowedOrbDeg: 4.0,
      }],
      houseTargets: [],
    });

    const win = enrichment.windows[key];
    expect(win).toBeDefined();
    expect(win.clippedStart).toBe(false);
    expect(win.startsAtEpochMs).not.toBeNull();
    expect(win.clippedEnd).toBe(true);
    expect(win.endsAtEpochMs).toBeNull();

    const exactPasses = win.passes.filter(p => p.state !== 'near-miss');
    expect(exactPasses).toHaveLength(3);
    expect(exactPasses.map(p => p.retrograde)).toEqual([false, true, false]);
    expect(win.startsAtEpochMs!).toBeLessThanOrEqual(exactPasses[0].epochMs);
    expect(exactPasses[2].utc).toMatch(/^2021-01-01T/);

    // Copy must NOT claim a closed 3-pass series when clipped
    const copy = composeTransitAspectSynthesis({
      transitId: 'mars',
      target: { kind: 'planet', planetId: 'sun' },
      aspect: 'conjunction',
      motion: 'applying',
      bucket: 'medium-term',
      retrograde: false,
      orbDeg: 0.6,
      transitHouse: null,
      targetHouse: null,
      enrichment: win,
      displayZone: 'UTC',
    });
    expect(copy.synthesis).toContain('extends beyond the search horizon');
    expect(copy.synthesis).not.toContain('3-pass series');
  });

  test('Saturn 2019 retrograde station flags clipped end when series continues beyond +365d search horizon', () => {
    const satSearch = searchEvents(engine, {
      startTt: 2458540,
      endTt: 2458800,
      referenceTt: 2458600,
      transitChartId: 'transit',
      bodies: ['saturn'],
      targets: [],
      rules: aspectRules,
    });
    const satRx = satSearch.context?.events.find(e => e.kind === 'station' && e.turns === 'retrograde');
    if (!satRx || satRx.kind !== 'station' || satRx.at.jdTt === null) throw new Error('Expected Saturn 2019 Rx station');

    const satTt = satRx.at.jdTt;
    const satPos = engine.position('Saturn', instantFromTt(satTt, engine.modelDeltaTSeconds));
    if (satPos.status !== 'ok') throw new Error('Expected Saturn position');
    const targetLon = wrapDegrees(satPos.value.longitude + 2.0);
    const key = transitWindowKey('saturn', { kind: 'planet', planetId: 'sun' }, 'conjunction');

    const enrichment = computeTransitEnrichment(engine, {
      signature: 'saturn-2019-station',
      selectedTt: satTt,
      pairs: [{
        key,
        transitId: 'saturn',
        target: { kind: 'planet', planetId: 'sun' },
        targetLongitudeDeg: targetLon,
        aspect: 'conjunction',
        allowedOrbDeg: 3.5,
      }],
      houseTargets: [],
    });

    const win = enrichment.windows[key];
    expect(win).toBeDefined();
    expect(win.clippedStart).toBe(false);
    expect(win.startsAtEpochMs).not.toBeNull();
    expect(win.clippedEnd).toBe(true);
    expect(win.endsAtEpochMs).toBeNull();
    expect(win.passes.some(p => p.utc?.startsWith('2020-01-10'))).toBe(true);

    const copy = composeTransitAspectSynthesis({
      transitId: 'saturn',
      target: { kind: 'planet', planetId: 'sun' },
      aspect: 'conjunction',
      motion: 'stationary',
      bucket: 'long-term',
      retrograde: false,
      orbDeg: 2.0,
      transitHouse: null,
      targetHouse: null,
      enrichment: win,
      displayZone: 'UTC',
    });
    expect(copy.synthesis).toContain('extends beyond the current search horizon');
  });

  test('Moon sextile orb cap is consistently 4.0° across planets and angles while other Moon aspects keep 5.0°', () => {
    expect(transitMaxOrb('moon', 'sextile')).toBe(4.0);
    expect(transitMaxOrb('moon', 'conjunction')).toBe(5.0);
    expect(transitMaxOrb('moon', 'square')).toBe(5.0);
    expect(transitMaxOrb('moon', 'trine')).toBe(5.0);
    expect(transitMaxOrb('moon', 'opposition')).toBe(5.0);
    expect(transitMaxOrb('saturn', 'sextile')).toBe(3.5);

    const mkPos = (longitudeDeg: number) => ({
      longitudeDeg,
      latitudeDeg: 0,
      distanceAu: 0.0025,
      longitudeSpeedDegPerDay: 13.0,
      latitudeSpeedDegPerDay: 0,
      distanceSpeedAuPerDay: 0,
      retrograde: false,
    });
    const houses: HouseFacts = {
      cusps: Array.from({ length: 12 }, (_, i) => ({ houseId: (i + 1) as HouseFacts['cusps'][number]['houseId'], longitudeDeg: i * 30 })),
      ascendantDeg: 0,
      midheavenDeg: 270,
      effectiveSystem: 'WholeSign',
      fallback: false,
    };

    // 4.5° orb from 60° sextile to ASC (0°) -> excluded (matches 4.0° chart rule for sextiles)
    const angle45 = calculateTransitAngleAspects(new Map([['moon', mkPos(64.5)]]), houses);
    expect(angle45.filter(a => a.angle === 'asc' && a.aspect === 'sextile')).toHaveLength(0);

    // 3.8° orb from 60° sextile to ASC (0°) -> included with allowedOrbDeg 4.0
    const angle38 = calculateTransitAngleAspects(new Map([['moon', mkPos(63.8)]]), houses);
    const sextileHit = angle38.find(a => a.angle === 'asc' && a.aspect === 'sextile');
    expect(sextileHit).toBeDefined();
    expect(sextileHit!.allowedOrbDeg).toBe(4.0);

    // 4.5° orb from 0° conjunction to ASC (0°) -> still included with allowedOrbDeg 5.0
    const conj45 = calculateTransitAngleAspects(new Map([['moon', mkPos(4.5)]]), houses);
    const conjHit = conj45.find(a => a.angle === 'asc' && a.aspect === 'conjunction');
    expect(conjHit).toBeDefined();
    expect(conjHit!.allowedOrbDeg).toBe(5.0);
  });
});

describe('U5B Honest Fallbacks, Timezone Formatting, Inspector Scoping & Anti-Fatalism', () => {
  test('missing coordinates produces no-houses mode without inventing houses or angles', () => {
    const natalNoCoords = buildNatalFixture('1990-07-15', '18:30', 'America/Edmonton', null);
    const { reading } = buildTransitSnapshot(natalNoCoords, '2026-11-20', '18:00', 'America/Edmonton', true);

    expect(reading.mode).toBe('no-houses');
    expect(reading.houseSystemLabel).toBeNull();
    expect(reading.houseTransits).toEqual([]);
    expect(reading.allAspects.every(a => !a.isAngleContact)).toBe(true);
    expect(reading.omittedNotes.some(n => /coordinates/i.test(n))).toBe(true);
  });

  test('unknown birth time produces conservative date-only mode omitting houses, angles, Moon targets and exact passes', () => {
    const unknownTime = resolveBirthTime({ date: '1990-07-15', time: null, timeZone: 'UTC' }, engine.modelDeltaTSeconds);
    if (unknownTime.kind !== 'unknown-time') throw new Error('Expected unknown-time');
    const dateOnlyChart = createDateOnlyNatalChart({
      id: 'natal',
      label: 'Unknown Time',
      time: unknownTime,
      settings: { zodiac: 'tropical', requestedHouseSystem: 'WholeSign', observer: null },
    });
    const dateOnlyFacts = calculateDateOnlyNatalFacts(engine, unknownTime.input);
    const tResolved = resolveBirthTime({ date: '2026-11-20', time: '18:00', timeZone: 'UTC' }, engine.modelDeltaTSeconds);
    if (tResolved.kind !== 'resolved' || !tResolved.utc) throw new Error('Expected resolved transit time');
    const { planets } = calculatePositions(engine, tResolved);
    const transitPositions = availablePositions(planets);

    const reading = interpretTransits({
      natalChart: dateOnlyChart,
      natalPositions: new Map(),
      transitPositions,
      transitAspects: [],
      houses: null,
      chartRulerId: null,
      dateOnlyNatalFacts: dateOnlyFacts,
      transitMoonState: null,
      selectedTt: tResolved.jdTt,
      momentLabel: formatLunarTimestamp(Date.parse(tResolved.utc), 'UTC'),
      displayZone: 'UTC',
      isDemo: false,
      birthSummary: '1990-07-15 · time unknown',
      enrichment: null,
      enrichmentState: 'idle',
    });

    expect(reading.mode).toBe('date-only');
    expect(reading.houseTransits).toEqual([]);
    expect(reading.buckets.lunarBrief).toEqual([]);
    expect(reading.allAspects.every(a => a.approximateDateOnly)).toBe(true);
    expect(reading.allAspects.every(a => a.transitId !== 'moon')).toBe(true);
    expect(reading.allAspects.every(a => a.target.kind === 'planet' && a.target.planetId !== 'moon')).toBe(true);
    expect(reading.allAspects.every(a => a.enrichment === null)).toBe(true);
    expect(buildTransitEnrichmentRequest(reading, new Map(), null, 'sig')).toBeNull();
  });

  test('formats enriched timestamps in Alberta Time (ABT post-2026-11-01), UTC and named IANA zones', () => {
    const natal = buildNatalFixture('1990-07-15', '18:30', 'America/Edmonton', { latitudeDeg: 51.0447, longitudeDeg: -114.0719 });
    // Post-2026-11-01 Alberta Time (America/Edmonton permanent UTC-06:00 ABT)
    const abt = buildTransitSnapshot(natal, '2026-11-20', '18:00', 'America/Edmonton', true);
    const utc = buildTransitSnapshot(natal, '2026-11-20', '18:00', 'UTC', true);
    const tokyo = buildTransitSnapshot(natal, '2026-11-20', '18:00', 'Asia/Tokyo', true);

    expect(abt.reading.momentLabel).toContain('ABT');
    expect(utc.reading.momentLabel).toContain('UTC');
    expect(tokyo.reading.momentLabel).not.toContain('ABT');

    // Enriched pass synthesis uses the requested displayZone
    const enrichedWithPass = abt.reading.allAspects.find(a => a.enrichment?.nearestPass);
    if (enrichedWithPass?.enrichment?.nearestPass) {
      const formattedAbt = formatLunarTimestamp(enrichedWithPass.enrichment.nearestPass.epochMs, 'America/Edmonton');
      const formattedUtc = formatLunarTimestamp(enrichedWithPass.enrichment.nearestPass.epochMs, 'UTC');
      expect(formattedAbt).not.toBe(formattedUtc);
      expect(enrichedWithPass.synthesis).toContain(formattedAbt);
    }
  });

  test('passes anti-fatalism & zero-commercial-copy lint and scopes Inspector notes strictly to transit items', () => {
    const natal = buildNatalFixture('2000-01-01', '12:00', 'UTC', { latitudeDeg: 51.5074, longitudeDeg: -0.1278 });
    const { reading } = buildTransitSnapshot(natal, '2026-11-20', '18:00', 'UTC', true);

    expect(reading.mode).toBe('complete');
    expect(reading.allAspects.length).toBeGreaterThan(0);
    expect(reading.houseTransits.length).toBeGreaterThan(0);

    // Disclaimer explicitly disavows prediction
    expect(reading.overview.symbolismDisclaimer).toContain('not scientific measurement or guaranteed prediction');

    // Lint every interpretive prose field
    const texts: string[] = [
      reading.overview.headline,
      reading.overview.synthesis,
      ...reading.themes.flatMap(t => [t.title, t.symbolismBasis, t.synthesis, t.reflection]),
      ...reading.allAspects.flatMap(a => [a.title, a.symbolismBasis, a.synthesis, a.reflection]),
      ...reading.houseTransits.flatMap(h => [h.symbolismBasis, h.synthesis]),
      ...reading.reflections.map(r => r.question),
      ...transitSymbolicMeanings(reading, 'transit', 'natal').map(m => m.description),
    ];
    for (const text of texts) {
      expect(text, `Forbidden deterministic or commercial copy found in: ${text}`).not.toMatch(FORBIDDEN_COPY);
    }

    // Inspector scoping: transit planet & transit-to-natal aspect return notes; natal planet/angle/concept return null
    const sampleTransitPlanet = reading.houseTransits[0].planetId;
    const planetNote = inspectorPersonalTransit(reading, `transit/${sampleTransitPlanet}`);
    expect(planetNote).not.toBeNull();
    expect(planetNote!.heading).toBe('In these transits');

    const samplePlanetAspect = reading.allAspects.find(a => !a.isAngleContact);
    if (samplePlanetAspect) {
      const aspectNote = inspectorPersonalTransit(reading, samplePlanetAspect.id);
      expect(aspectNote).not.toBeNull();
      expect(aspectNote!.heading).toBe('In these transits');
      expect(aspectNote!.synthesis).toContain(planetName(samplePlanetAspect.transitId));
    }

    expect(inspectorPersonalTransit(reading, 'natal/sun')).toBeNull();
    expect(inspectorPersonalTransit(reading, 'angle/asc')).toBeNull();
    expect(inspectorPersonalTransit(reading, 'house/1')).toBeNull();
    expect(inspectorPersonalTransit(reading, 'concept/transits')).toBeNull();

    // Verify all PlanetIds are recognized cleanly
    expect(PLANET_IDS.length).toBe(10);
  });
});
