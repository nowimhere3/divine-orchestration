import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, test } from 'vitest';
import { angularSeparation, createAspectRuleSet, MAJOR_ASPECT_ANGLES } from '../../src/domain/aspects';
import type { HouseFacts, HouseId } from '../../src/domain/chart';
import { createEphemeraEngine, EPHEMERA_COVERAGE_TT } from '../../src/engine/ephemera';
import type { EphemeraEngine } from '../../src/engine/ephemera';
import { transitMaxOrb } from '../../src/interpret/transit-math';
import { startEventRangeSearch } from '../../src/search/client';
import { MAX_SEARCH_DAYS, searchEvents } from '../../src/search/events';
import { CONTACT_TOLERANCE_DEG } from '../../src/search/geometry';
import type { SearchWorkerMessage, SearchWorkerRequest } from '../../src/search/protocol';
import {
  computeRangeChunks,
  MAX_GENERAL_RANGE_DAYS,
  MAX_SLOW_RANGE_DAYS,
  RANGE_CHUNK_DAYS,
  searchEventRange,
} from '../../src/search/range';
import type {
  AngleAspectWindowEvent,
  EventRangeSearchRequest,
  HouseIngressEvent,
  RangeAspectWindowEvent,
  RangeSearchProgress,
  RangeStationEvent,
} from '../../src/search/range';
import { instantFromTt, SECONDS_PER_DAY } from '../../src/time/ephemeris-time';
import { resolveBirthTime } from '../../src/time/resolve';
import { calculateNatal, natalHouse, wrapDegrees } from '../../src/view/chart-data';
import mercury from '../fixtures/horizons-mercury-triple.json';

let engine: EphemeraEngine;
let greenwichWholeSignHouses: HouseFacts;
let greenwichPlacidusHouses: HouseFacts;

const utcTt = (date: string, time = '00:00') => {
  const res = resolveBirthTime({ date, time, offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  if (res.kind !== 'resolved') throw new Error(`Could not resolve ${date} ${time}`);
  return res.jdTt;
};

const secondsBetween = (a: number, b: number) => Math.abs(a - b) * SECONDS_PER_DAY;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  engine = await createEphemeraEngine(await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm')));

  const natalTime = resolveBirthTime(
    { date: '2000-01-01', time: '12:00', timeZone: 'Europe/London' },
    engine.modelDeltaTSeconds,
  );
  if (natalTime.kind !== 'resolved') throw new Error('Could not resolve natal fixture time');
  const observer = { latitudeDeg: 51.4779, longitudeDeg: 0 };
  const ws = calculateNatal(engine, natalTime, observer, 'WholeSign');
  const pl = calculateNatal(engine, natalTime, observer, 'Placidus');
  if (ws.houses.status !== 'available' || pl.houses.status !== 'available') {
    throw new Error('Could not calculate fixture houses');
  }
  greenwichWholeSignHouses = ws.houses.value;
  greenwichPlacidusHouses = pl.houses.value;
});

describe('U6A Multi-Year Range Chunking & Limit Enforcement', () => {
  test('preserves MAX_SEARCH_DAYS = 366 and computes exact chunks across leap days without omitting partial final chunks', () => {
    expect(MAX_SEARCH_DAYS).toBe(366);
    expect(RANGE_CHUNK_DAYS).toBe(366);
    expect(MAX_GENERAL_RANGE_DAYS).toBe(1827);
    expect(MAX_SLOW_RANGE_DAYS).toBe(3653);

    // 1 leap year (366 days) -> 1 chunk
    const leap1Start = utcTt('2024-01-01');
    const leap1End = utcTt('2025-01-01');
    expect(Math.round(leap1End - leap1Start)).toBe(366);
    expect(computeRangeChunks(leap1Start, leap1End)).toHaveLength(1);

    // 367 days -> 2 chunks with a 1-day final partial chunk preserved
    const chunks367 = computeRangeChunks(leap1Start, leap1Start + 367);
    expect(chunks367).toHaveLength(2);
    expect(chunks367[0].endTt - chunks367[0].startTt).toBeCloseTo(366, 9);
    expect(chunks367[1].endTt - chunks367[1].startTt).toBeCloseTo(1, 9);
    expect(chunks367[1].endTt).toBe(leap1Start + 367);

    // 2 years spanning leap day 2024-02-29 (731 days) -> 2 chunks ending at exact endTt
    const y2Start = utcTt('2024-01-01');
    const y2End = utcTt('2026-01-01');
    expect(Math.round(y2End - y2Start)).toBe(731);
    const y2Chunks = computeRangeChunks(y2Start, y2End);
    expect(y2Chunks).toHaveLength(2);
    expect(y2Chunks[0].startTt).toBe(y2Start);
    expect(y2Chunks[1].endTt).toBe(y2End);

    // 733 days -> 3 chunks (366 + 366 + 1), never dropping the 1-day partial tail
    const chunks733 = computeRangeChunks(y2Start, y2Start + 733);
    expect(chunks733).toHaveLength(3);
    expect(chunks733[2].endTt - chunks733[2].startTt).toBeCloseTo(1, 9);

    // 5 Gregorian years spanning TWO leap days (2020 and 2024 -> 1827 days)
    const y5Start = utcTt('2020-01-01');
    const y5End = utcTt('2025-01-01');
    expect(Math.round(y5End - y5Start)).toBe(1827);
    const y5Chunks = computeRangeChunks(y5Start, y5End);
    expect(y5Chunks).toHaveLength(5);
    expect(y5Chunks.every(c => c.endTt - c.startTt <= MAX_SEARCH_DAYS + 1e-6)).toBe(true);
    expect(y5Chunks[0].startTt).toBe(y5Start);
    expect(y5Chunks[y5Chunks.length - 1].endTt).toBe(y5End);

    // 10 Gregorian years spanning THREE leap days (2020, 2024, 2028 -> 3653 days)
    const y10Start = utcTt('2020-01-01');
    const y10End = utcTt('2030-01-01');
    expect(Math.round(y10End - y10Start)).toBe(3653);
    const y10Chunks = computeRangeChunks(y10Start, y10End);
    expect(y10Chunks).toHaveLength(10);
    expect(y10Chunks.every(c => c.endTt - c.startTt <= MAX_SEARCH_DAYS + 1e-6)).toBe(true);
    expect(y10Chunks[0].startTt).toBe(y10Start);
    expect(y10Chunks[y10Chunks.length - 1].endTt).toBe(y10End);
  });

  test('executes 2-year, 5-year (general), and 10-year (slow-planet-only) ranges, enforces limits, and includes final partial chunk events', () => {
    // 2-year general search (2024-01-01 -> 2026-01-01)
    const y2Progress: RangeSearchProgress[] = [];
    const y2 = searchEventRange(engine, {
      startTt: utcTt('2024-01-01'),
      endTt: utcTt('2026-01-01'),
      referenceTt: utcTt('2025-01-01'),
      transitChartId: 'transit',
      bodies: ['sun', 'saturn'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 280 }],
    }, p => y2Progress.push(p));

    expect(y2.status).toBe('complete');
    expect(y2.range.chunkCount).toBe(2);
    expect(y2.range.slowBodiesOnly).toBe(false);
    expect(y2.range.maxAllowedDays).toBe(MAX_GENERAL_RANGE_DAYS);
    expect(y2Progress[0].completed).toBe(0);
    expect(y2Progress[y2Progress.length - 1].completed).toBe(y2Progress[y2Progress.length - 1].total);
    expect(y2Progress.map(p => p.chunkIndex)).toEqual(
      [...y2Progress.map(p => p.chunkIndex)].sort((a, b) => a - b),
    );
    // Sun conjunct 280° Capricorn (~Jan 1) has a clipped tail exiting early Jan 2024 plus 2 exact passes (Dec 2024 & Dec 2025).
    const sunConjs = y2.events.filter(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.transit.planetId === 'sun' && e.aspect === 'conjunction',
    );
    const exactSunConjs = sunConjs.filter(w => w.passes.some(p => p.state !== 'near-miss'));
    expect(exactSunConjs).toHaveLength(2);
    expect(sunConjs.some(w => w.clippedStart && w.startsAt === null)).toBe(true);

    // 5-year general search spanning TWO leap days (2020-01-01 -> 2025-01-01 = 1827 days)
    const y5Start = utcTt('2020-01-01');
    const y5End = utcTt('2025-01-01');
    const y5 = searchEventRange(engine, {
      startTt: y5Start,
      endTt: y5End,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 280 }],
    });
    expect(y5.status).toBe('complete');
    expect(y5.range.chunkCount).toBe(5);
    // Sun returns to 280° Capricorn 5 times across 2020..2024 (plus clipped tail on 2020-01-01).
    const y5SunConjs = y5.events.filter(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction' && e.passes.some(p => p.state !== 'near-miss'),
    );
    expect(y5SunConjs).toHaveLength(5);
    expect(y5SunConjs[4].passes[0].at.utc).toMatch(/^2024-12-/);

    // Exceeding 5 years with a non-slow planet throws RangeError
    expect(() => searchEventRange(engine, {
      startTt: y5Start,
      endTt: y5Start + MAX_GENERAL_RANGE_DAYS + 1,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['saturn', 'mars'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 280 }],
    })).toThrow(RangeError);

    // 10-year slow-planet-only search spanning THREE leap days (2020-01-01 -> 2030-01-01 = 3653 days)
    const y10Start = utcTt('2020-01-01');
    const y10End = utcTt('2030-01-01');
    const y10 = searchEventRange(engine, {
      startTt: y10Start,
      endTt: y10End,
      referenceTt: utcTt('2025-01-01'),
      transitChartId: 'transit',
      bodies: ['jupiter', 'saturn', 'uranus', 'neptune', 'pluto'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 15 }],
    });
    expect(y10.status).toBe('complete');
    expect(y10.range.chunkCount).toBe(10);
    expect(y10.range.slowBodiesOnly).toBe(true);
    expect(y10.range.maxAllowedDays).toBe(MAX_SLOW_RANGE_DAYS);
    // Every slow planet stations ~2 times per year -> ~100 stations over 10 years
    const stations = y10.events.filter((e): e is RangeStationEvent => e.kind === 'station');
    expect(stations.length).toBeGreaterThan(80);

    // Exceeding 10 years even for slow planets throws RangeError
    expect(() => searchEventRange(engine, {
      startTt: y10Start,
      endTt: y10Start + MAX_SLOW_RANGE_DAYS + 1,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['pluto'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 15 }],
    })).toThrow(RangeError);

    // Explicit final 1-day partial chunk test: exact Sun conjunction inside the last 1-day chunk is found!
    // (367 days spans both the Dec 2024 conjunction in chunk 0 and the Dec 2025 conjunction in the 1-day final chunk 1.)
    const exactDec2025 = exactSunConjs[1].passes[0].at.jdTt!;
    const partialStart = exactDec2025 - 366.5;
    const partialEnd = exactDec2025 + 0.5; // 367 days -> chunk 0 = 366d, chunk 1 = 1d containing exactDec2025
    const partialRes = searchEventRange(engine, {
      startTt: partialStart,
      endTt: partialEnd,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 280 }],
    });
    expect(partialRes.range.chunkCount).toBe(2);
    const tailConjs = partialRes.events.filter(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction',
    );
    expect(tailConjs).toHaveLength(2);
    expect(secondsBetween(tailConjs[1].passes[0].at.jdTt!, exactDec2025)).toBeLessThan(0.1);
  });

  test('accepts valid 5-year and 10-year calendar intervals across leap seconds and historical deltaT growth, while rejecting overlong ranges', () => {
    const validFiveYearCases = [
      ['2016-01-01', '2021-01-01'], // 2 leap days + 1 leap second (2016-12-31)
      ['1972-01-01', '1977-01-01'], // 2 leap days + 6 leap seconds
      ['1904-01-01', '1909-01-01'], // 2 leap days + pre-UTC deltaT growth
      ['1964-01-01', '1969-01-01'], // 2 leap days + early-UTC drift era
    ] as const;

    for (const [fromDate, toDate] of validFiveYearCases) {
      const startTt = utcTt(fromDate);
      const endTt = utcTt(toDate);
      // Confirm these legitimate calendar ranges genuinely exceed 1827.0 TT days due to leap seconds / deltaT
      expect(endTt - startTt).toBeGreaterThan(MAX_GENERAL_RANGE_DAYS);

      const res = searchEventRange(engine, {
        startTt,
        endTt,
        referenceTt: null,
        transitChartId: 'transit',
        bodies: ['sun'],
        targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 120 }],
      });
      expect(res.status).toBe('complete');
      expect(res.range.clippedToCoverage).toBe(false);
      expect(res.range.effectiveStart.jdTt).toBe(startTt);
      expect(res.range.effectiveEnd.jdTt).toBe(endTt);
      expect(res.range.chunkCount).toBe(5);
      // 5 exact Sun conjunctions to 120° Leo (~Aug each year) confirm full unclipped coverage
      const conjs = res.events.filter(
        (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction',
      );
      expect(conjs).toHaveLength(5);
    }

    const validTenYearSlowCases = [
      ['1996-01-01', '2006-01-01'], // 3 leap days + 3 leap seconds
      ['2012-01-01', '2022-01-01'], // 3 leap days + 3 leap seconds
      ['1972-01-01', '1982-01-01'], // 3 leap days + 10 leap seconds
      ['1956-01-01', '1966-01-01'], // 3 leap days + pre-UTC to early-UTC deltaT/drift
    ] as const;

    for (const [fromDate, toDate] of validTenYearSlowCases) {
      const startTt = utcTt(fromDate);
      const endTt = utcTt(toDate);
      expect(endTt - startTt).toBeGreaterThan(MAX_SLOW_RANGE_DAYS);

      const res = searchEventRange(engine, {
        startTt,
        endTt,
        referenceTt: null,
        transitChartId: 'transit',
        bodies: ['pluto'],
        targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 120 }],
      });
      expect(res.status).toBe('complete');
      expect(res.range.clippedToCoverage).toBe(false);
      expect(res.range.effectiveStart.jdTt).toBe(startTt);
      expect(res.range.effectiveEnd.jdTt).toBe(endTt);
      expect(res.range.chunkCount).toBe(10);
      expect(res.range.slowBodiesOnly).toBe(true);
    }

    // Declining-deltaT historical era (1552 -> 1562) accepts exact TT max span too
    const earlyStart = utcTt('1552-01-01');
    const earlyRes = searchEventRange(engine, {
      startTt: earlyStart,
      endTt: earlyStart + MAX_SLOW_RANGE_DAYS,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['pluto'],
      targets: [],
    });
    expect(earlyRes.status).toBe('complete');
    expect(earlyRes.range.chunkCount).toBe(10);

    // Genuinely overlong calendar and TT intervals must still be rejected with RangeError
    const overlongGeneralCases: readonly (readonly [number, number])[] = [
      [utcTt('2016-01-01'), utcTt('2021-01-02')],         // 1828 civil days (5y + 1 day)
      [utcTt('2016-01-01', '00:00'), utcTt('2021-01-01', '00:01')], // 5y + 1 minute
      [utcTt('1904-01-01'), utcTt('1909-01-02')],         // historical 5y + 1 day
      [utcTt('2020-01-01'), utcTt('2025-01-02')],         // modern 5y + 1 day
    ];
    for (const [startTt, endTt] of overlongGeneralCases) {
      expect(() => searchEventRange(engine, {
        startTt,
        endTt,
        referenceTt: null,
        transitChartId: 'transit',
        bodies: ['sun'],
        targets: [],
      })).toThrow(RangeError);
    }

    const overlongSlowCases: readonly (readonly [number, number])[] = [
      [utcTt('1996-01-01'), utcTt('2006-01-02')],         // 3654 civil days (10y + 1 day)
      [utcTt('2012-01-01', '00:00'), utcTt('2022-01-01', '00:01')], // 10y + 1 minute
      [utcTt('1956-01-01'), utcTt('1966-01-02')],         // cross-era 10y + 1 day
      [utcTt('2020-01-01'), utcTt('2030-01-02')],         // modern 10y + 1 day
    ];
    for (const [startTt, endTt] of overlongSlowCases) {
      expect(() => searchEventRange(engine, {
        startTt,
        endTt,
        referenceTt: null,
        transitChartId: 'transit',
        bodies: ['pluto'],
        targets: [],
      })).toThrow(RangeError);
    }
  });
});

describe('U6A Continuous Event Mathematics: Stitching, Retrograde Series, Mirror Branches & Stations', () => {
  test('stitches Mercury retrograde triple-pass seamlessly across chunk seams (including an exact-pass seam) and tracks multi-window retrograde series', () => {
    const startTt = 2460369.5; // 2024-02-29 (outside Mercury's 8° orb + 17° retrograde shadow of 20° Aries)
    const endTt = 2460460.5;   // 2024-05-30 (91 days, clear of 25° shadow on both ends)

    // 1. Wide orb (chart-v0 = 8°): single continuous window split artificially across 5 chunks (chunkDays = 20)
    const refSingle = searchEvents(engine, {
      startTt,
      endTt,
      referenceTt: 2460420,
      transitChartId: 'transit',
      bodies: ['mercury'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 20 }],
      rules: createAspectRuleSet(),
    });
    const refConj = refSingle.context!.events.find(
      e => e.kind === 'aspect-window' && e.aspect === 'conjunction',
    )!;
    if (refConj.kind !== 'aspect-window') throw new Error('expected aspect-window');

    const stitched = searchEventRange(engine, {
      startTt,
      endTt,
      referenceTt: 2460420,
      transitChartId: 'transit',
      bodies: ['mercury'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 20 }],
      orbPolicy: 'chart-v0',
      chunkDays: 20, // puts seams right inside the active window
    });

    expect(stitched.range.chunkCount).toBe(5);
    const stitchedConjs = stitched.events.filter(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction',
    );
    expect(stitchedConjs).toHaveLength(1);
    const win = stitchedConjs[0];
    expect(win.clippedStart).toBe(false);
    expect(win.clippedEnd).toBe(false);
    expect(win.timing).toBe('present');
    expect(secondsBetween(win.startsAt!.jdTt!, refConj.startsAt!.jdTt!)).toBeLessThan(0.1);
    expect(secondsBetween(win.endsAt!.jdTt!, refConj.endsAt!.jdTt!)).toBeLessThan(0.1);
    expect(win.passes).toHaveLength(3);
    expect(win.passes.map(p => p.retrograde)).toEqual([false, true, false]);
    expect(win.passes.map(p => p.passNumberInSeries)).toEqual([1, 2, 3]);
    expect(win.series.isRetrogradeSeries).toBe(true);
    expect(win.series.exactPassCountInRange).toBe(3);
    expect(win.series.windowCountInRange).toBe(1);
    expect(win.series.clippedStart).toBe(false);
    expect(win.series.clippedEnd).toBe(false);
    expect(win.series.complete).toBe(true);

    // 1b. Place a chunk seam directly ON exact pass 2 (retrograde pass): zero duplicate passes!
    const pass2Tt = win.passes[1].at.jdTt!;
    const seamOnPass = searchEventRange(engine, {
      startTt,
      endTt,
      referenceTt: 2460420,
      transitChartId: 'transit',
      bodies: ['mercury'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 20 }],
      orbPolicy: 'chart-v0',
      chunkDays: pass2Tt - startTt,
    });
    const seamOnPassConjs = seamOnPass.events.filter(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction',
    );
    expect(seamOnPassConjs).toHaveLength(1);
    expect(seamOnPassConjs[0].passes).toHaveLength(3);
    expect(secondsBetween(seamOnPassConjs[0].passes[1].at.jdTt!, pass2Tt)).toBeLessThan(0.1);

    // Check against independent Horizons brackets
    for (const [i, pass] of win.passes.entries()) {
      const [[a, lonA], [b, lonB]] = mercury.contacts[i];
      const expected = a + ((20 - lonA) / (lonB - lonA)) * (b - a);
      expect(secondsBetween(pass.at.jdTt!, expected)).toBeLessThan(35);
      expect(pass.residualDeg!).toBeLessThanOrEqual(CONTACT_TOLERANCE_DEG);
    }

    // 2. Tighter orb (2°): Mercury leaves orb between passes, producing 3 separate windows linked into 1 continuous series!
    const multiWin = searchEventRange(engine, {
      startTt: startTt - 15,
      endTt: endTt + 15,
      referenceTt: 2460420,
      transitChartId: 'transit',
      bodies: ['mercury'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 20 }],
      orbPolicy: 'custom',
      rules: createAspectRuleSet({ conjunction: 2 }),
      chunkDays: 25,
    });
    const seriesWins = multiWin.events.filter(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction',
    );
    expect(seriesWins).toHaveLength(3);
    const seriesIds = new Set(seriesWins.map(w => w.series.id));
    expect(seriesIds.size).toBe(1);
    expect(seriesWins.map(w => w.series.windowIndex)).toEqual([0, 1, 2]);
    expect(seriesWins.every(w => w.series.windowCountInRange === 3)).toBe(true);
    expect(seriesWins.every(w => w.series.exactPassCountInRange === 3)).toBe(true);
    expect(seriesWins.every(w => w.series.isRetrogradeSeries && w.series.complete)).toBe(true);
    expect(seriesWins.flatMap(w => w.passes.map(p => p.passNumberInSeries))).toEqual([1, 2, 3]);
    expect(seriesWins.flatMap(w => w.passes.map(p => p.retrograde))).toEqual([false, true, false]);
  });

  test('never merges mirrored aspect branches (waxing vs waning squares/sextiles/trines)', () => {
    const startTt = utcTt('2024-01-01');
    const endTt = utcTt('2025-01-01');
    const res = searchEventRange(engine, {
      startTt,
      endTt,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 0 }],
      orbPolicy: 'transit-focused',
      chunkDays: 100,
    });

    for (const [aspect, expectedBranches] of [
      ['square', [90, 270]],
      ['sextile', [60, 300]],
      ['trine', [120, 240]],
    ] as const) {
      const wins = res.events.filter(
        (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === aspect,
      );
      expect(wins).toHaveLength(2);
      expect(wins[0].series.id).not.toBe(wins[1].series.id);
      const branches = wins.map(w => Math.round(w.series.branchLongitudeDeg)).sort((a, b) => a - b);
      expect(branches).toEqual([...expectedBranches]);
      expect(angularSeparation(wins[0].series.branchLongitudeDeg, wins[1].series.branchLongitudeDeg)).toBeGreaterThan(100);
    }
  });

  test('reports outer-planet clipped windows and incomplete retrograde series honestly, then completes when range expands', () => {
    // Saturn in 2024–2025 makes a 3-pass conjunction around 16° Pisces (346°):
    // Pass 1 direct (~Apr 2024), Pass 2 retrograde (~Sep 2024), Pass 3 direct (~Jan 2025).
    const full = searchEventRange(engine, {
      startTt: utcTt('2023-06-01'),
      endTt: utcTt('2026-06-01'),
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['saturn'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 346 }],
      orbPolicy: 'transit-focused',
    });
    const fullConjs = full.events.filter(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction',
    );
    const fullPasses = fullConjs.flatMap(w => w.passes.filter(p => p.state !== 'near-miss'));
    expect(fullPasses).toHaveLength(3);
    expect(fullPasses.map(p => p.retrograde)).toEqual([false, true, false]);
    expect(new Set(fullConjs.map(w => w.series.id)).size).toBe(1);
    expect(fullConjs.every(w => w.series.complete && w.series.isRetrogradeSeries)).toBe(true);

    // Now truncate the range right after Pass 1 (before Saturn exits its retrograde shadow):
    // must NOT report the truncated 1-pass window as a complete series!
    const pass1Tt = fullPasses[0].at.jdTt!;
    const truncated = searchEventRange(engine, {
      startTt: utcTt('2023-06-01'),
      endTt: pass1Tt + 60, // Saturn has not finished its retrograde loop back over 346°
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['saturn'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 346 }],
      orbPolicy: 'transit-focused',
    });
    const truncConjs = truncated.events.filter(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction',
    );
    expect(truncConjs).toHaveLength(1);
    expect(truncConjs[0].series.clippedEnd).toBe(true);
    expect(truncConjs[0].series.complete).toBe(false);

    // Direct mid-orb clipping test: start right at exact pass 2
    const pass2Tt = fullPasses[1].at.jdTt!;
    const midOrb = searchEventRange(engine, {
      startTt: pass2Tt,
      endTt: pass2Tt + 15,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['saturn'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 346 }],
      orbPolicy: 'transit-focused',
    });
    const midConj = midOrb.events.find(
      (e): e is RangeAspectWindowEvent => e.kind === 'aspect-window' && e.aspect === 'conjunction',
    )!;
    expect(midConj.clippedStart).toBe(true);
    expect(midConj.startsAt).toBeNull();
    expect(midConj.clippedEnd).toBe(true);
    expect(midConj.endsAt).toBeNull();
    expect(midConj.series.clippedStart).toBe(true);
    expect(midConj.series.clippedEnd).toBe(true);
    expect(midConj.series.complete).toBe(false);
  });

  test('deduplicates stations falling exactly on a chunk boundary and records natal house when houses exist', () => {
    const station = engine.station('Mercury', 2460402, { direction: 1, maxDays: 2 });
    if (station.status !== 'ok') throw new Error('expected Mercury station fixture');
    const seamTt = station.value.jdTt;

    // Place chunk boundary right ON the exact Mercury station instant!
    const res = searchEventRange(engine, {
      startTt: seamTt - 15,
      endTt: seamTt + 15,
      referenceTt: seamTt,
      transitChartId: 'transit',
      bodies: ['mercury'],
      targets: [],
      houses: greenwichWholeSignHouses,
      chunkDays: 15,
    });

    expect(res.range.chunkCount).toBe(2);
    const stations = res.events.filter((e): e is RangeStationEvent => e.kind === 'station');
    expect(stations).toHaveLength(1);
    expect(stations[0].turns).toBe('retrograde');
    expect(stations[0].timing).toBe('present');
    expect(secondsBetween(stations[0].at.jdTt!, seamTt)).toBeLessThan(0.1);
    expect(res.stationResidualsDegPerDay[stations[0].id]).toBeLessThan(1e-7);

    const pos = engine.position('Mercury', instantFromTt(seamTt, engine.modelDeltaTSeconds));
    if (pos.status !== 'ok') throw new Error('expected Mercury position');
    expect(stations[0].inNatalHouse).toBe(natalHouse(wrapDegrees(pos.value.longitude), greenwichWholeSignHouses));
  });
});

describe('U6A Natal ASC/MC Contacts, House Ingress/Egress & Transit-Focused Orbs', () => {
  test('finds accurate transit-to-ASC and transit-to-MC contacts, stitches across seams, and handles missing houses honestly', () => {
    const startTt = utcTt('2024-01-01');
    const endTt = utcTt('2025-01-01');

    const res = searchEventRange(engine, {
      startTt,
      endTt,
      referenceTt: utcTt('2024-06-01'),
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [],
      houses: greenwichPlacidusHouses,
      includeAngles: true,
      orbPolicy: 'transit-focused',
      chunkDays: 120,
    });

    expect(res.status).toBe('complete');
    const angleWins = res.events.filter((e): e is AngleAspectWindowEvent => e.kind === 'angle-aspect-window');
    // Over 1 year, Sun makes 8 exact contacts (1 conj, 1 opp, 2 sq, 2 tr, 2 sex) to both ASC and MC.
    // Because Greenwich 2000-01-01 12:00 UTC has MC near the Jan 1 Sun (~280° Capricorn), MC also has a clipped orb tail on Jan 1.
    const ascWins = angleWins.filter(w => w.targetAngle === 'asc');
    const mcWins = angleWins.filter(w => w.targetAngle === 'mc');
    expect(ascWins.filter(w => w.passes.some(p => p.state !== 'near-miss'))).toHaveLength(8);
    expect(mcWins.filter(w => w.passes.some(p => p.state !== 'near-miss'))).toHaveLength(8);

    // Every exact pass agrees with Ephemera position within CONTACT_TOLERANCE_DEG
    for (const w of angleWins) {
      const targetLon = w.targetAngle === 'asc'
        ? greenwichPlacidusHouses.ascendantDeg
        : greenwichPlacidusHouses.midheavenDeg;
      expect(w.allowedOrbDeg).toBe(transitMaxOrb('sun', w.aspect));
      for (const pass of w.passes) {
        const pos = engine.position('Sun', instantFromTt(pass.at.jdTt!, engine.modelDeltaTSeconds));
        if (pos.status !== 'ok') throw new Error('expected Sun position');
        const sep = angularSeparation(pos.value.longitude, targetLon);
        expect(Math.abs(sep - MAJOR_ASPECT_ANGLES[w.aspect])).toBeLessThanOrEqual(CONTACT_TOLERANCE_DEG);
      }
    }

    // Requesting angles without houses reports houses-unavailable honestly without fabricating contacts
    const noHouses = searchEventRange(engine, {
      startTt,
      endTt: startTt + 30,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [],
      houses: null,
      includeAngles: ['mc'],
      includeHouseIngresses: true,
    });
    expect(noHouses.status).toBe('partial');
    expect(noHouses.unavailable).toContainEqual({ kind: 'houses', reason: 'houses-unavailable' });
    expect(noHouses.events.filter(e => e.kind === 'angle-aspect-window' || e.kind === 'house-ingress')).toHaveLength(0);

    // Direct DSC/IC solving honors asymmetric orbs accurately while includeAngles: true remains ASC/MC only
    const dscRes = searchEventRange(engine, {
      startTt,
      endTt: utcTt('2024-07-01'),
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [],
      houses: greenwichPlacidusHouses,
      includeAngles: ['dsc', 'ic'],
      orbPolicy: 'custom',
      rules: createAspectRuleSet({ conjunction: 8, opposition: 2, sextile: 2, trine: 7, square: 5 }),
    });
    expect(dscRes.settings.angles).toEqual(['dsc', 'ic']);
    const dscWins = dscRes.events.filter((e): e is AngleAspectWindowEvent => e.kind === 'angle-aspect-window' && e.targetAngle === 'dsc');
    expect(dscWins.length).toBeGreaterThan(0);
    for (const w of dscWins) {
      const expectedOrb = w.aspect === 'conjunction' ? 8 : w.aspect === 'trine' ? 7 : w.aspect === 'square' ? 5 : 2;
      expect(w.allowedOrbDeg).toBe(expectedOrb);
      const dscLon = wrapDegrees(greenwichPlacidusHouses.ascendantDeg + 180);
      for (const pass of w.passes) {
        const pos = engine.position('Sun', instantFromTt(pass.at.jdTt!, engine.modelDeltaTSeconds));
        if (pos.status !== 'ok') throw new Error('expected Sun position');
        const sep = angularSeparation(pos.value.longitude, dscLon);
        expect(Math.abs(sep - MAJOR_ASPECT_ANGLES[w.aspect])).toBeLessThanOrEqual(CONTACT_TOLERANCE_DEG);
      }
    }
  });

  test('detects direct and retrograde natal house ingress/egress crossings including retrograde re-entry', () => {
    // Build a valid 12-house Whole Sign-like system with House 10 starting at 20° Aries (20°),
    // right where Mercury makes its 2024 direct -> retrograde -> direct triple crossing!
    const customHouses: HouseFacts = {
      effectiveSystem: 'Placidus',
      fallback: false,
      ascendantDeg: 110,
      midheavenDeg: 20,
      cusps: Array.from({ length: 12 }, (_, i) => ({
        houseId: (i + 1) as HouseId,
        longitudeDeg: wrapDegrees(110 + i * 30), // House 10 cusp = (110 + 9*30) % 360 = 20° Aries!
      })),
    };
    expect(customHouses.cusps[9].longitudeDeg).toBe(20);

    const res = searchEventRange(engine, {
      startTt: 2460389.5, // 2024-03-20
      endTt: 2460445.5,   // 2024-05-15
      referenceTt: 2460420,
      transitChartId: 'transit',
      bodies: ['mercury'],
      targets: [],
      houses: customHouses,
      includeHouseIngresses: true,
      targetHouses: [10],
      chunkDays: 20, // splits across 3 chunks to verify seam deduplication too
    });

    expect(res.status).toBe('complete');
    const ingresses = res.events.filter((e): e is HouseIngressEvent => e.kind === 'house-ingress');
    // Mercury crosses 20° Aries (H9 <-> H10) three times:
    // 1. Direct H9 -> H10, 2. Retrograde H10 -> H9, 3. Direct H9 -> H10!
    const h10Crossings = ingresses.filter(e => e.cuspHouseId === 10);
    expect(h10Crossings).toHaveLength(3);
    expect(h10Crossings.map(e => [e.fromHouse, e.toHouse, e.retrograde])).toEqual([
      [9, 10, false],
      [10, 9, true],
      [9, 10, false],
    ]);

    // Verify each crossing matches cusp longitude and natalHouse() before/after!
    for (const [i, cross] of h10Crossings.entries()) {
      const tt = cross.at.jdTt!;
      const atPos = engine.position('Mercury', instantFromTt(tt, engine.modelDeltaTSeconds));
      const beforePos = engine.position('Mercury', instantFromTt(tt - 0.1, engine.modelDeltaTSeconds));
      const afterPos = engine.position('Mercury', instantFromTt(tt + 0.1, engine.modelDeltaTSeconds));
      if (atPos.status !== 'ok' || beforePos.status !== 'ok' || afterPos.status !== 'ok') {
        throw new Error('expected Mercury positions');
      }
      expect(angularSeparation(atPos.value.longitude, 20)).toBeLessThanOrEqual(CONTACT_TOLERANCE_DEG);
      expect(natalHouse(wrapDegrees(beforePos.value.longitude), customHouses)).toBe(cross.fromHouse);
      expect(natalHouse(wrapDegrees(afterPos.value.longitude), customHouses)).toBe(cross.toHouse);
      const [[a, lonA], [b, lonB]] = mercury.contacts[i];
      const expected = a + ((20 - lonA) / (lonB - lonA)) * (b - a);
      expect(secondsBetween(tt, expected)).toBeLessThan(35);
    }

    // Also verify Sun crosses all 12 Whole Sign houses in 1 year (including 0° Aries wraparound!)
    const sunYear = searchEventRange(engine, {
      startTt: utcTt('2024-01-01'),
      endTt: utcTt('2025-01-01'),
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [],
      houses: greenwichWholeSignHouses,
      includeHouseIngresses: true,
    });
    const sunIngresses = sunYear.events.filter((e): e is HouseIngressEvent => e.kind === 'house-ingress');
    expect(sunIngresses).toHaveLength(12);
    expect(new Set(sunIngresses.map(e => e.toHouse)).size).toBe(12);
    expect(sunIngresses.every(e => !e.retrograde)).toBe(true);
  });

  test('applies transit-focused orb caps vs chart-v0 orbs cleanly per transiting planet', () => {
    const startTt = utcTt('2024-01-01');
    const endTt = utcTt('2025-01-01');
    const req: EventRangeSearchRequest = {
      startTt,
      endTt,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['pluto', 'saturn', 'sun'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 300 }],
      orbPolicy: 'transit-focused',
    };
    const focused = searchEventRange(engine, req);
    expect(focused.provenance.orbPolicy).toBe('transit-focused');
    for (const ev of focused.events) {
      if (ev.kind === 'aspect-window') {
        expect(ev.allowedOrbDeg).toBe(transitMaxOrb(ev.transit.planetId, ev.aspect));
      }
    }

    const chartOrbs = searchEventRange(engine, { ...req, orbPolicy: 'chart-v0' });
    expect(chartOrbs.provenance.orbPolicy).toBe('chart-v0');
    const defaults = createAspectRuleSet().orbsDeg;
    for (const ev of chartOrbs.events) {
      if (ev.kind === 'aspect-window') {
        expect(ev.allowedOrbDeg).toBe(defaults[ev.aspect]);
      }
    }
  });
});

describe('U6A Coverage Boundaries & Worker Client Cancellation / Stale-Job Protection', () => {
  test('handles outside-coverage and clipped-coverage intervals honestly', () => {
    const edgeStart = EPHEMERA_COVERAGE_TT.start;
    const outside = searchEventRange(engine, {
      startTt: edgeStart - 20,
      endTt: edgeStart - 5,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 0 }],
    });
    expect(outside.status).toBe('unavailable');
    expect(outside.reason).toBe('outside-coverage');
    expect(outside.range.chunkCount).toBe(0);
    expect(outside.events).toEqual([]);

    const clipped = searchEventRange(engine, {
      startTt: edgeStart - 10,
      endTt: edgeStart + 20,
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['sun'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 0 }],
    });
    expect(clipped.status).toBe('partial');
    expect(clipped.range.clippedToCoverage).toBe(true);
    expect(clipped.range.effectiveStart.jdTt).toBe(edgeStart);
    expect(clipped.range.effectiveDays).toBeCloseTo(20, 6);
    expect(clipped.warnings).toContain('interval-clipped');
  });

  test('worker client forwards progress, resolves results, and terminates/suppresses late messages on cancel', async () => {
    class MockWorker {
      onmessage: ((event: MessageEvent<SearchWorkerMessage>) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      posted: SearchWorkerRequest[] = [];

      postMessage(message: SearchWorkerRequest) {
        this.posted.push(message);
      }
      terminate() {
        this.terminated = true;
      }
      emit(data: SearchWorkerMessage) {
        this.onmessage?.({ data } as MessageEvent<SearchWorkerMessage>);
      }
    }

    const baseRequest: EventRangeSearchRequest = {
      startTt: utcTt('2024-01-01'),
      endTt: utcTt('2025-01-01'),
      referenceTt: null,
      transitChartId: 'transit',
      bodies: ['saturn'],
      targets: [{ chartId: 'natal', planetId: 'sun', longitudeDeg: 0 }],
    };

    // 1. Happy path: posts kind: 'range-search', forwards progress, resolves and terminates worker
    const w1 = new MockWorker();
    const seenProgress: RangeSearchProgress[] = [];
    const job1 = startEventRangeSearch(baseRequest, p => seenProgress.push(p), () => w1 as unknown as Worker);
    expect(w1.posted).toEqual([{ kind: 'range-search', request: baseRequest }]);

    w1.emit({ type: 'range-progress', progress: { completed: 1, total: 2, chunkIndex: 0, chunkCount: 1 } });
    const fakeResult = searchEventRange(engine, { ...baseRequest, endTt: baseRequest.startTt + 10 });
    w1.emit({ type: 'range-complete', result: fakeResult });

    const resolved = await job1.result;
    expect(resolved).toEqual(fakeResult);
    expect(seenProgress).toEqual([{ completed: 1, total: 2, chunkIndex: 0, chunkCount: 1 }]);
    expect(w1.terminated).toBe(true);

    // 2. Cancel path: rejects with AbortError, terminates worker, and ignores any late progress/complete messages
    const w2 = new MockWorker();
    const progressAfterCancel: RangeSearchProgress[] = [];
    const job2 = startEventRangeSearch(baseRequest, p => progressAfterCancel.push(p), () => w2 as unknown as Worker);
    w2.emit({ type: 'range-progress', progress: { completed: 0, total: 2, chunkIndex: 0, chunkCount: 1 } });
    job2.cancel();
    expect(w2.terminated).toBe(true);

    // Emit stale late messages after cancellation — must be ignored silently!
    w2.emit({ type: 'range-progress', progress: { completed: 2, total: 2, chunkIndex: 0, chunkCount: 1 } });
    w2.emit({ type: 'range-complete', result: fakeResult });

    await expect(job2.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(progressAfterCancel).toHaveLength(1);
  });
});
