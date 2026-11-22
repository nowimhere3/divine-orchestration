import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Chart, HouseId, PlanetId } from '../../src/domain/chart';
import { PLANET_IDS } from '../../src/domain/chart';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import type { EphemeraEngine } from '../../src/engine/ephemera';
import {
  ALL_HOUSE_IDS,
  buildRangeSearchRequest,
  BUILT_IN_RESEARCH_THEMES,
  canReuseSessionComputation,
  computeChartSignature,
  computeRangeCacheKey,
  createCustomSearchQuery,
  createEverythingQuery,
  createLifeThemesQuery,
  createResearchSession,
  createThemeRegistry,
  evaluateResearchEvents,
  findInterceptedSigns,
  hasAsymmetricDualOrbs,
  HOUSE_AREA_DESCRIPTORS,
  houseFactorOf,
  isSessionCompatibleWithChart,
  natalPlanetFactorOf,
  prepareExportHandoff,
  projectAngleAspectAxes,
  reEvaluateResearchSession,
  resolveChartFactors,
  resolveResearchFocus,
  sortByRelevance,
  SUN_TO_PLUTO_BODIES,
  validateQueryRangeSpan,
} from '../../src/research';
import type { RangeEvent } from '../../src/search/range';
import { MAX_GENERAL_RANGE_DAYS, MAX_SLOW_RANGE_DAYS, searchEventRange } from '../../src/search/range';
import { SLOW_PLANET_IDS } from '../../src/search/series';
import { resolveBirthTime } from '../../src/time/resolve';
import { calculateNatal } from '../../src/view/chart-data';

let engine: EphemeraEngine;
let calgaryPlacidus: Chart;
let calgaryWholeSign: Chart;
let polarPorphyry: Chart;
let noCoordsChart: Chart;
let unknownTimeChart: Chart;

function utcDateToTt(date: string): number {
  const res = resolveBirthTime({ date, time: '00:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  if (res.kind !== 'resolved') throw new Error(`Failed to resolve ${date}`);
  return res.jdTt;
}

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm'));
  engine = await createEphemeraEngine(wasm);

  const calgaryTime = resolveBirthTime(
    { date: '1987-03-14', time: '07:25', timeZone: 'America/Edmonton' },
    engine.modelDeltaTSeconds,
  );
  if (calgaryTime.kind !== 'resolved') throw new Error('Expected resolved Calgary birth time.');
  const calgaryObserver = { latitudeDeg: 51.0447, longitudeDeg: -114.0719 };

  calgaryPlacidus = calculateNatal(engine, calgaryTime, calgaryObserver, 'Placidus');
  calgaryWholeSign = calculateNatal(engine, calgaryTime, calgaryObserver, 'WholeSign');
  noCoordsChart = calculateNatal(engine, calgaryTime, null, 'Placidus');

  // Extreme Arctic latitude triggers Placidus -> Porphyry fallback
  polarPorphyry = calculateNatal(engine, calgaryTime, { latitudeDeg: 70.0, longitudeDeg: 20.0 }, 'Placidus');

  const dateOnlyTime = resolveBirthTime(
    { date: '1987-03-14', time: null, timeZone: 'America/Edmonton' },
    engine.modelDeltaTSeconds,
  );
  if (dateOnlyTime.kind !== 'unknown-time') throw new Error('Expected unknown-time resolution.');
  unknownTimeChart = calculateNatal(engine, dateOnlyTime, calgaryObserver, 'Placidus');
});

describe('Theme registry and all 12 houses', () => {
  test('exposes all 12 houses individually and core practical built-in themes', () => {
    expect(HOUSE_AREA_DESCRIPTORS).toHaveLength(12);
    expect(HOUSE_AREA_DESCRIPTORS.map(h => h.houseId)).toEqual(ALL_HOUSE_IDS);
    expect(HOUSE_AREA_DESCRIPTORS[0].axisAngle).toBe('asc');
    expect(HOUSE_AREA_DESCRIPTORS[3].axisAngle).toBe('ic');
    expect(HOUSE_AREA_DESCRIPTORS[6].axisAngle).toBe('dsc');
    expect(HOUSE_AREA_DESCRIPTORS[9].axisAngle).toBe('mc');

    const ids = BUILT_IN_RESEARCH_THEMES.map(t => t.id);
    for (const required of [
      'project-development',
      'entrepreneurship',
      'finances',
      'identity-growth',
      'emotional-growth',
      'relationships',
    ]) {
      expect(ids).toContain(required);
    }
    for (const theme of BUILT_IN_RESEARCH_THEMES) {
      expect(theme.conventionNote.toLowerCase()).toContain('convention');
      expect(theme.sources.length).toBeGreaterThan(0);
    }
  });

  test('supports editing built-ins, adding custom themes, resetting and round-tripping customizations', () => {
    const base = createThemeRegistry();
    const edited = base
      .upsert({
        id: 'finances',
        label: 'Finances & Cash Flow',
        description: 'Custom finances grouping adding House 6 earned work.',
        houses: [2, 6, 8],
        naturalSignificators: ['venus', 'saturn', 'jupiter'],
      })
      .upsert({
        id: 'creative-launch',
        label: 'Creative Launch',
        description: 'Shipping original creative projects.',
        houses: [1, 5, 10, 11],
        naturalSignificators: ['sun', 'mercury', 'mars'],
        angles: ['mc'],
      });

    expect(edited.isModifiedBuiltIn('finances')).toBe(true);
    expect(edited.get('finances')?.houses).toEqual([2, 6, 8]);
    expect(edited.isBuiltIn('creative-launch')).toBe(false);
    expect(edited.get('creative-launch')?.houses).toEqual([1, 5, 10, 11]);

    // Round-trip customizations into a fresh registry
    const saved = edited.exportCustomizations();
    const restored = createThemeRegistry(saved);
    expect(restored.get('finances')?.houses).toEqual([2, 6, 8]);
    expect(restored.get('creative-launch')?.label).toBe('Creative Launch');

    // Resetting built-in restores defaults without deleting custom themes
    const reset = restored.resetBuiltIn('finances');
    expect(reset.isModifiedBuiltIn('finances')).toBe(false);
    expect(reset.get('finances')?.houses).toEqual([2, 8]);
    expect(reset.get('creative-launch')).toBeDefined();

    // Deleting custom theme removes it cleanly
    const removed = reset.remove('creative-launch');
    expect(removed.get('creative-launch')).toBeUndefined();

    // Invalid theme input is rejected
    expect(() => base.upsert({ id: 'BAD ID!', label: 'Oops', houses: [1] })).toThrow(RangeError);
    expect(() => base.upsert({ id: 'empty-theme', label: 'Empty', houses: [] })).toThrow(RangeError);
  });
});

describe('Personalized chart factor resolution', () => {
  test('resolves Whole Sign vs Placidus cusp signs, intercepted signs, rulers, occupants and ASC/MC/DSC/IC', () => {
    const placidus = resolveChartFactors(calgaryPlacidus, { rulershipPolicy: 'traditional' });
    const placidusModern = resolveChartFactors(calgaryPlacidus, { rulershipPolicy: 'traditional-plus-modern' });
    const wholeSign = resolveChartFactors(calgaryWholeSign, { rulershipPolicy: 'traditional' });

    expect(placidus.availability).toMatchObject({
      natalPositionsAvailable: true,
      housesAvailable: true,
      effectiveHouseSystem: 'Placidus',
      polarHouseFallback: false,
    });
    expect(wholeSign.availability.effectiveHouseSystem).toBe('WholeSign');

    // Whole Sign never has intercepted signs; every cusp is a distinct sign
    expect(wholeSign.houses).toHaveLength(12);
    expect(wholeSign.houses!.every(h => h.interceptedSignIndices.length === 0)).toBe(true);
    expect(new Set(wholeSign.houses!.map(h => h.cuspSignIndex)).size).toBe(12);

    // Placidus at 51°N Calgary resolves actual non-uniform cusps & rulers (not naive House N = Sign N)
    expect(placidus.houses).toHaveLength(12);
    expect(placidus.angles).not.toBeNull();
    expect((placidus.angles!.dsc.longitudeDeg - placidus.angles!.asc.longitudeDeg + 360) % 360).toBeCloseTo(180, 6);
    expect((placidus.angles!.ic.longitudeDeg - placidus.angles!.mc.longitudeDeg + 360) % 360).toBeCloseTo(180, 6);
    expect(placidus.angles!.dsc.solverAngle).toBe('asc');
    expect(placidus.angles!.ic.solverAngle).toBe('mc');

    // Verify modern co-rulers appear when enabled for Scorpio/Aquarius/Pisces cusps
    const modernCapableHouses = placidusModern.houses!.filter(h => h.modernCoRuler !== null);
    expect(modernCapableHouses.length).toBeGreaterThan(0);
    for (const h of modernCapableHouses) {
      expect(h.activeRulers).toContain(h.traditionalRuler);
      expect(h.activeRulers).toContain(h.modernCoRuler);
      const tradOnly = houseFactorOf(placidus, h.houseId)!;
      expect(tradOnly.activeRulers).toEqual([tradOnly.traditionalRuler]);
    }

    // Verify every natal planet is assigned to exactly one house and matches occupant lists
    expect(placidus.natalPlanets).toHaveLength(10);
    for (const p of placidus.natalPlanets) {
      expect(p.houseId).not.toBeNull();
      const hf = houseFactorOf(placidus, p.houseId!)!;
      expect(hf.occupants).toContain(p.planetId);
    }

    // Verify exact intercepted-sign detection on a synthetic wide Placidus-like house
    const syntheticCusps = {
      cusps: [
        { houseId: 1 as HouseId, longitudeDeg: 28 },  // 28° Aries -> spans Taurus (30-60) & Gemini (60-90) to 5° Cancer!
        { houseId: 2 as HouseId, longitudeDeg: 95 },
        { houseId: 3 as HouseId, longitudeDeg: 120 },
        { houseId: 4 as HouseId, longitudeDeg: 145 },
        { houseId: 5 as HouseId, longitudeDeg: 170 },
        { houseId: 6 as HouseId, longitudeDeg: 190 },
        { houseId: 7 as HouseId, longitudeDeg: 208 }, // 28° Libra -> spans Scorpio & Sagittarius to 5° Capricorn
        { houseId: 8 as HouseId, longitudeDeg: 275 },
        { houseId: 9 as HouseId, longitudeDeg: 300 },
        { houseId: 10 as HouseId, longitudeDeg: 325 },
        { houseId: 11 as HouseId, longitudeDeg: 350 },
        { houseId: 12 as HouseId, longitudeDeg: 10 },
      ],
      ascendantDeg: 28,
      midheavenDeg: 325,
      effectiveSystem: 'Placidus',
      fallback: false,
    };
    expect(findInterceptedSigns(syntheticCusps, 1)).toEqual([1, 2]); // Taurus, Gemini
    expect(findInterceptedSigns(syntheticCusps, 7)).toEqual([7, 8]); // Scorpio, Sagittarius
    expect(findInterceptedSigns(syntheticCusps, 3)).toEqual([]);
  });

  test('preserves Porphyry polar fallback, missing-location degradation and unknown-birth-time honesty', () => {
    const polar = resolveChartFactors(polarPorphyry);
    expect(polar.availability.housesAvailable).toBe(true);
    expect(polar.availability.effectiveHouseSystem).toBe('Porphyry');
    expect(polar.availability.polarHouseFallback).toBe(true);
    expect(polar.sensitivityNotes.some(n => n.includes('Porphyry'))).toBe(true);

    const noCoords = resolveChartFactors(noCoordsChart);
    expect(noCoords.availability).toMatchObject({
      natalPositionsAvailable: true,
      housesAvailable: false,
      housesUnavailableReason: 'missing-location',
    });
    expect(noCoords.houses).toBeNull();
    expect(noCoords.angles).toBeNull();
    expect(noCoords.chartRuler).toBeNull();
    expect(noCoords.natalPlanets).toHaveLength(10);
    expect(noCoords.natalPlanets.every(p => p.houseId === null)).toBe(true);

    const unknown = resolveChartFactors(unknownTimeChart);
    expect(unknown.availability).toMatchObject({
      natalPositionsAvailable: false,
      natalUnavailableReason: 'unknown-birth-time',
      housesAvailable: false,
      housesUnavailableReason: 'unknown-birth-time',
      timeStatus: 'unknown-time',
    });
    expect(unknown.houses).toBeNull();
    expect(unknown.angles).toBeNull();
    expect(unknown.natalPlanets).toHaveLength(0);
  });

  test('projects ASC/MC aspects accurately onto opposite DSC/IC axes', () => {
    const [ascConj, dscOpp] = projectAngleAspectAxes('asc', 'conjunction');
    expect(ascConj).toMatchObject({ angle: 'asc', aspect: 'conjunction', isDerivedOpposite: false });
    expect(dscOpp).toMatchObject({ angle: 'dsc', aspect: 'opposition', isDerivedOpposite: true, exactDual: true });

    const [mcSextile, icTrine] = projectAngleAspectAxes('mc', 'sextile');
    expect(mcSextile).toMatchObject({ angle: 'mc', aspect: 'sextile' });
    expect(icTrine).toMatchObject({ angle: 'ic', aspect: 'trine', isDerivedOpposite: true });
  });
});

describe('Query resolution, custom inclusion/exclusion and U6A compatibility', () => {
  test('allows selecting all 12 houses individually and respects explicit custom exclusions over theme presets', () => {
    const factors = resolveChartFactors(calgaryPlacidus);
    const registry = createThemeRegistry();

    // Every single house 1..12 can be targeted individually
    for (const houseId of ALL_HOUSE_IDS) {
      const q = createLifeThemesQuery({
        startDate: '2026-01-01',
        endDate: '2026-04-01',
        includeHouses: [houseId],
      });
      const focus = resolveResearchFocus(q, factors, registry);
      expect(focus.activeHouses).toEqual([houseId]);
      const hf = houseFactorOf(factors, houseId)!;
      expect(focus.traditionalRulerPlanets).toContain(hf.traditionalRuler);
    }

    // Explicit exclusions override built-in preset houses, natal planets and angles
    const financeH2Ruler = houseFactorOf(factors, 2)!.traditionalRuler;
    const customQ = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      activeThemeIds: ['finances', 'relationships'],
      excludeHouses: [8],
      excludeNatalPlanets: [financeH2Ruler],
      excludeFocusAngles: ['dsc'],
      excludeTransitingBodies: ['moon'],
      includeAspects: ['conjunction', 'square', 'opposition'],
    });
    const focus = resolveResearchFocus(customQ, factors, registry);
    expect(focus.activeHouses).not.toContain(8);
    expect(focus.activeHouses).toContain(2);
    expect(focus.activeHouses).toContain(7);
    expect(focus.effectiveNatalPlanets).not.toContain(financeH2Ruler);
    expect(focus.activeAngles).not.toContain('dsc');
    expect(focus.effectiveTransitingBodies).not.toContain('moon');
    expect(focus.activeAspects).toEqual(['conjunction', 'square', 'opposition']);
  });

  test('enforces U6A 5-year general and 10-year slow-planet range span limits honestly', () => {
    const start = utcDateToTt('2020-01-01');
    const overFive = start + MAX_GENERAL_RANGE_DAYS + 2;
    const tenYears = start + MAX_SLOW_RANGE_DAYS - 1;
    const overTen = start + MAX_SLOW_RANGE_DAYS + 2;

    expect(validateQueryRangeSpan(PLANET_IDS, start, overFive).ok).toBe(false);
    expect(validateQueryRangeSpan(SLOW_PLANET_IDS, start, tenYears).ok).toBe(true);
    expect(validateQueryRangeSpan(SLOW_PLANET_IDS, start, overTen).ok).toBe(false);
  });

  test('runs end-to-end with real U6A searchEventRange for 4 simultaneous themes, preserving broader context and exact score sums', () => {
    const factors = resolveChartFactors(calgaryPlacidus, { rulershipPolicy: 'traditional-plus-modern' });
    const registry = createThemeRegistry();

    // Illustrative 4-area scenario over 6 months (Sun–Pluto for fast unit runtime)
    const query = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      preset: 'custom',
      transitingBodies: SUN_TO_PLUTO_BODIES,
      activeThemeIds: ['project-development', 'identity-growth', 'emotional-growth', 'finances'],
      rulershipPolicy: 'traditional-plus-modern',
      orbPolicy: 'transit-focused',
    });

    const startTt = utcDateToTt(query.range.startDate);
    const endTt = utcDateToTt(query.range.endDate);
    const focus = resolveResearchFocus(query, factors, registry);
    const request = buildRangeSearchRequest(query, calgaryPlacidus, focus, {
      startTt,
      endTt,
      referenceTt: startTt,
    });

    const rawResult = searchEventRange(engine, request);
    expect(rawResult.status).toBe('complete');
    expect(rawResult.events.length).toBeGreaterThan(50);

    const session = createResearchSession({
      chart: calgaryPlacidus,
      query,
      rangeRequest: request,
      rawResult,
      registry,
    });

    // Zero events silently discarded: 1-to-1 partition
    const { evaluated } = session;
    expect(evaluated.all).toHaveLength(rawResult.events.length);
    expect(evaluated.primary.length + evaluated.secondary.length + evaluated.broaderContext.length).toBe(
      rawResult.events.length,
    );
    expect(evaluated.counts.total).toBe(rawResult.events.length);

    // Every single evaluated event obeys the additive transparency invariant: rawScore === sum(reasons.points)
    for (const item of evaluated.all) {
      const sum = item.relevance.reasons.reduce((acc, r) => acc + r.points, 0);
      expect(item.relevance.rawScore).toBe(sum);
      expect(item.relevance.score).toBe(Math.min(100, sum));
      expect(item.relevance.whyRelevant.length).toBeGreaterThan(0);
    }

    // Must find multi-area convergences (H8 shared by finances + emotional-growth; H10 by project-development + identity-growth)
    expect(evaluated.convergenceHighlights.length).toBeGreaterThan(0);
    expect(evaluated.convergenceHighlights[0].relevance.matchedThemeIds.length).toBeGreaterThanOrEqual(2);
    expect(
      evaluated.convergenceHighlights[0].relevance.reasons.some(r => r.code === 'multi-theme-convergence'),
    ).toBe(true);

    // Verify relevant + broader context are both distinguishable (H7 / non-selected houses stay in context)
    expect(evaluated.primary.length).toBeGreaterThan(0);
    expect(evaluated.broaderContext.length).toBeGreaterThan(0);
    for (const ctx of evaluated.broaderContext) {
      expect(ctx.relevance.inFocus).toBe(false);
      expect(ctx.relevance.reasons.some(r => r.code === 'broader-astronomical-context')).toBe(true);
    }

    // Verify sortByRelevance returns descending scores without dropping events
    const ranked = sortByRelevance(evaluated.relevant);
    expect(ranked).toHaveLength(evaluated.relevant.length);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].relevance.rawScore).toBeGreaterThanOrEqual(ranked[i].relevance.rawScore);
    }

    // Client-side re-evaluation reuses the exact cached U6A result when switching to Explore Everything or Custom Search
    const rangeOpts = { startTt, endTt, referenceTt: startTt };
    const narrowQuery = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      transitingBodies: SLOW_PLANET_IDS,
      includeHouses: [2, 8],
      includeAspects: ['square', 'opposition'],
      includeEventKinds: ['aspect-window', 'house-ingress'],
    });
    expect(canReuseSessionComputation(session, narrowQuery, calgaryPlacidus, rangeOpts, registry)).toBe(true);

    const reEvaluated = reEvaluateResearchSession(session, narrowQuery, calgaryPlacidus, registry);
    expect(reEvaluated.rawResult).toBe(session.rawResult); // Exact reference reused, zero second search
    // Planets outside the narrower query (Sun–Mars here) are out of scope: they are neither shown nor counted.
    const slowSet = new Set<PlanetId>(SLOW_PLANET_IDS);
    const slowRaw = rawResult.events.filter(e => slowSet.has(e.kind === 'station' || e.kind === 'house-ingress' ? e.planet.planetId : e.transit.planetId));
    expect(reEvaluated.evaluated.all).toHaveLength(slowRaw.length);
    expect(reEvaluated.evaluated.counts.outsideQueryScope).toBe(rawResult.events.length - slowRaw.length);
    expect(reEvaluated.evaluated.counts.calculatedEvents).toBe(rawResult.events.length);
    // Excluded event kinds (e.g. stations) are marked excludedByFocus & tier='context', never silently dropped
    const stationItems = reEvaluated.evaluated.all.filter(e => e.event.kind === 'station');
    expect(stationItems.length).toBeGreaterThan(0);
    expect(stationItems.every(e => e.relevance.excludedByFocus && e.relevance.tier === 'context')).toBe(true);

    // Expanding range or adding Moon requires a fresh worker search
    const withMoon = createEverythingQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      transitingBodies: PLANET_IDS,
    });
    expect(canReuseSessionComputation(session, withMoon, calgaryPlacidus, rangeOpts, registry)).toBe(false);

    // Exact Events-to-Export handoff works for matching chart and rejects modified chart
    expect(isSessionCompatibleWithChart(session, calgaryPlacidus)).toBe(true);
    expect(isSessionCompatibleWithChart(session, calgaryWholeSign)).toBe(false);
    expect(computeChartSignature(calgaryPlacidus)).not.toBe(computeChartSignature(calgaryWholeSign));

    const handoff = prepareExportHandoff(session, calgaryPlacidus);
    expect(handoff.reSearchRequired).toBe(false);
    expect(handoff.totalEvents).toBe(rawResult.events.length);
    expect(handoff.rawResult).toBe(rawResult);
    expect(() => prepareExportHandoff(session, calgaryWholeSign)).toThrow(/chart changed/i);
  });

  test('degrades honestly with real U6A range engine for missing-location and unknown-birth-time charts', () => {
    const registry = createThemeRegistry();
    const startTt = utcDateToTt('2026-01-01');
    const endTt = utcDateToTt('2026-05-01');

    // 1. Missing birthplace coordinates -> planetary significators only, no house ingresses/angles
    const noCoordsFactors = resolveChartFactors(noCoordsChart);
    const noCoordsQuery = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-05-01',
      transitingBodies: ['mercury', 'venus', 'mars', 'jupiter', 'saturn'],
      activeThemeIds: ['finances'],
    });
    const noCoordsFocus = resolveResearchFocus(noCoordsQuery, noCoordsFactors, registry);
    expect(noCoordsFocus.degradedMode).toBe('planetary-significators-only');
    expect(noCoordsFocus.activeHouses).toEqual([]);
    expect(noCoordsFocus.notices.some(n => n.code === 'houses-unavailable-planetary-fallback')).toBe(true);

    const noCoordsReq = buildRangeSearchRequest(noCoordsQuery, noCoordsChart, noCoordsFocus, {
      startTt,
      endTt,
      referenceTt: startTt,
    });
    expect(noCoordsReq.includeAngles).toBe(false);
    expect(noCoordsReq.includeHouseIngresses).toBe(false);
    const noCoordsRes = searchEventRange(engine, noCoordsReq);
    expect(noCoordsRes.events.some(e => e.kind === 'house-ingress' || e.kind === 'angle-aspect-window')).toBe(false);
    const noCoordsEval = evaluateResearchEvents(noCoordsRes.events, noCoordsQuery, noCoordsFocus, noCoordsFactors, registry);
    expect(noCoordsEval.relevant.length).toBeGreaterThan(0);
    expect(
      noCoordsEval.relevant.some(e =>
        e.relevance.reasons.some(r => r.code === 'natural-significator' && r.summary.includes('houses unavailable')),
      ),
    ).toBe(true);

    // 2. Unknown birth time -> stations only, never fabricates natal longitudes or houses
    const unknownFactors = resolveChartFactors(unknownTimeChart);
    const unknownQuery = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-05-01',
      transitingBodies: ['mercury', 'jupiter', 'saturn'],
      activeThemeIds: ['project-development'],
    });
    const unknownFocus = resolveResearchFocus(unknownQuery, unknownFactors, registry);
    expect(unknownFocus.degradedMode).toBe('stations-only');
    expect(unknownFocus.notices.some(n => n.code === 'unknown-birth-time-stations-only')).toBe(true);

    const unknownReq = buildRangeSearchRequest(unknownQuery, unknownTimeChart, unknownFocus, {
      startTt,
      endTt,
      referenceTt: startTt,
    });
    const unknownRes = searchEventRange(engine, unknownReq);
    expect(unknownRes.status).toBe('partial');
    expect(unknownRes.events.length).toBeGreaterThan(0);
    expect(unknownRes.events.every(e => e.kind === 'station')).toBe(true);
    const unknownEval = evaluateResearchEvents(unknownRes.events, unknownQuery, unknownFocus, unknownFactors, registry);
    expect(unknownEval.all).toHaveLength(unknownRes.events.length);
  });

  test('evaluates DSC/IC axis contacts, structural-only Custom Search, and Explore Everything cleanly', () => {
    const factors = resolveChartFactors(calgaryPlacidus);
    const registry = createThemeRegistry();

    // Synthetic angle aspect window: Transit Saturn opposition Natal ASC => exact conjunction DSC (House 7 / Relationships)
    const sampleMoment = { utc: '2026-04-01T12:00:00.000Z', jdUt: 2461132.0, jdTt: 2461132.0008 };
    const syntheticEvents: readonly RangeEvent[] = [
      {
        id: 'angle-saturn-opp-asc',
        kind: 'angle-aspect-window',
        timing: 'future',
        transit: { chartId: 'transit', planetId: 'saturn' },
        targetChartId: calgaryPlacidus.id,
        targetAngle: 'asc',
        aspect: 'opposition',
        startsAt: sampleMoment,
        endsAt: sampleMoment,
        clippedStart: false,
        clippedEnd: false,
        passes: [{ at: sampleMoment, state: 'exact', residualDeg: 0.0001, toleranceDeg: 0.001, retrograde: false, passNumberInSeries: 1 }],
        allowedOrbDeg: 3.5,
        series: {
          id: 'series-1',
          branchLongitudeDeg: factors.angles!.dsc.longitudeDeg,
          windowIndex: 0,
          windowCountInRange: 1,
          exactPassCountInRange: 1,
          isRetrogradeSeries: false,
          clippedStart: false,
          clippedEnd: false,
          complete: true,
        },
      },
      {
        id: 'station-mars-h1',
        kind: 'station',
        timing: 'future',
        planet: { chartId: 'transit', planetId: 'mars' },
        at: sampleMoment,
        turns: 'retrograde',
        inNatalHouse: 1,
      },
    ];

    // Relationships theme targets DSC (H7); opposition to ASC must match DSC conjunction!
    const relQuery = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      activeThemeIds: ['relationships'],
    });
    const relFocus = resolveResearchFocus(relQuery, factors, registry);
    const relEval = evaluateResearchEvents(syntheticEvents, relQuery, relFocus, factors, registry);
    const angleItem = relEval.all.find(e => e.event.id === 'angle-saturn-opp-asc')!;
    expect(angleItem.relevance.tier).toBe('primary');
    expect(angleItem.relevance.matchedAngles).toContain('dsc');
    expect(angleItem.relevance.matchedThemeIds).toContain('relationships');
    expect(angleItem.relevance.reasons.some(r => r.code === 'angle-axis-contact' && r.params.isDerivedOpposite)).toBe(true);

    // Structural-only Custom Search (stations only, no themes/houses) puts station in focus and angle window in context
    const stationOnlyQ = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      includeEventKinds: ['station'],
    });
    const stFocus = resolveResearchFocus(stationOnlyQ, factors, registry);
    const stEval = evaluateResearchEvents(syntheticEvents, stationOnlyQ, stFocus, factors, registry);
    expect(stEval.relevant.map(e => e.event.id)).toEqual(['station-mars-h1']);
    expect(stEval.broaderContext.map(e => e.event.id)).toEqual(['angle-saturn-opp-asc']);
    expect(stEval.broaderContext[0].relevance.excludedByFocus).toBe(true);

    // Explore Everything keeps both in focus with angular prominence noted
    const everythingQ = createEverythingQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
    });
    const evFocus = resolveResearchFocus(everythingQ, factors, registry);
    const evEval = evaluateResearchEvents(syntheticEvents, everythingQ, evFocus, factors, registry);
    expect(evEval.broaderContext).toHaveLength(0);
    expect(evEval.primary).toHaveLength(2);
    expect(evEval.all.every(e => e.relevance.reasons.some(r => r.code === 'angular-prominence'))).toBe(true);

    // Spot check natalPlanetFactorOf helper and computation-flag alignment
    const sunFactor = natalPlanetFactorOf(factors, 'sun');
    expect(sunFactor?.planetId).toBe('sun');
    expect(sunFactor?.signName).toBe('Pisces');

    const noStationsNoIngresses = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      includeStations: false,
      includeHouseIngresses: false,
    });
    expect(noStationsNoIngresses.focus.includeEventKinds).toEqual(['aspect-window', 'angle-aspect-window']);
  });
});

describe('Independent Check Regressions (Hydrogen HOLD findings)', () => {
  test('Fix 1 (Blocker 1): honors projected aspect orb policy on DSC/IC across Moon, chart-v0, and asymmetric custom orbs', () => {
    const factors = resolveChartFactors(calgaryPlacidus);
    const registry = createThemeRegistry();

    // Probe 4A: Moon under transit-focused (sextile: 4°, trine: 5°) with Relationships (DSC)
    expect(hasAsymmetricDualOrbs(['moon'], 'transit-focused')).toBe(true);
    expect(hasAsymmetricDualOrbs(SUN_TO_PLUTO_BODIES, 'transit-focused')).toBe(false);

    const moonQuery = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-02-15',
      transitingBodies: ['moon'],
      activeThemeIds: ['relationships'],
      orbPolicy: 'transit-focused',
    });
    const moonStart = utcDateToTt('2026-01-01');
    const moonEnd = utcDateToTt('2026-02-15');
    const moonFocus = resolveResearchFocus(moonQuery, factors, registry);
    const moonReq = buildRangeSearchRequest(moonQuery, calgaryPlacidus, moonFocus, {
      startTt: moonStart,
      endTt: moonEnd,
      referenceTt: moonStart,
    });
    expect(moonReq.includeAngles).toEqual(['asc', 'mc', 'dsc', 'ic']);
    const moonRaw = searchEventRange(engine, moonReq);
    const moonSession = createResearchSession({
      chart: calgaryPlacidus,
      query: moonQuery,
      rangeRequest: moonReq,
      rawResult: moonRaw,
      registry,
    });

    const dscTrines = moonSession.evaluated.all.filter(
      e => e.event.kind === 'angle-aspect-window' && e.event.targetAngle === 'dsc' && e.event.aspect === 'trine',
    );
    const dscSextiles = moonSession.evaluated.all.filter(
      e => e.event.kind === 'angle-aspect-window' && e.event.targetAngle === 'dsc' && e.event.aspect === 'sextile',
    );
    expect(dscTrines.length).toBeGreaterThan(0);
    expect(dscSextiles.length).toBeGreaterThan(0);
    expect(dscTrines.every(e => e.event.kind === 'angle-aspect-window' && e.event.allowedOrbDeg === 5 && e.relevance.inFocus)).toBe(true);
    expect(dscSextiles.every(e => e.event.kind === 'angle-aspect-window' && e.event.allowedOrbDeg === 4 && e.relevance.inFocus)).toBe(true);
    // ASC events must NOT be projected onto DSC when DSC is solved directly
    const ascItems = moonSession.evaluated.all.filter(
      e => e.event.kind === 'angle-aspect-window' && e.event.targetAngle === 'asc',
    );
    expect(ascItems.every(e => !e.relevance.matchedAngles.includes('dsc'))).toBe(true);

    // Probe 4B: Real U6A asymmetric custom orbs ({ conjunction: 8, opposition: 2, sextile: 2, trine: 7, square: 5 })
    const customAsym = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      transitingBodies: ['saturn'],
      orbPolicy: 'custom',
      customOrbsDeg: { conjunction: 8, opposition: 2, sextile: 2, trine: 7, square: 5 },
      includeFocusAngles: ['dsc'],
      includeAspects: ['opposition', 'sextile'],
    });
    const asymStart = utcDateToTt('2026-01-01');
    const asymEnd = utcDateToTt('2026-07-01');
    const asymFocus = resolveResearchFocus(customAsym, factors, registry);
    const asymReq = buildRangeSearchRequest(customAsym, calgaryPlacidus, asymFocus, {
      startTt: asymStart,
      endTt: asymEnd,
      referenceTt: asymStart,
    });
    const asymRaw = searchEventRange(engine, asymReq);
    const asymSession = createResearchSession({
      chart: calgaryPlacidus,
      query: customAsym,
      rangeRequest: asymReq,
      rawResult: asymRaw,
      registry,
    });
    const inFocusDsc = asymSession.evaluated.relevant.filter(
      e => e.event.kind === 'angle-aspect-window' && e.relevance.matchedAngles.includes('dsc'),
    );
    for (const item of inFocusDsc) {
      if (item.event.kind !== 'angle-aspect-window') continue;
      expect(item.event.targetAngle).toBe('dsc');
      expect(item.event.allowedOrbDeg).toBe(2); // opposition and sextile are both capped at 2°
    }
    const saturnConjAsc = asymSession.evaluated.all.filter(
      e => e.event.kind === 'angle-aspect-window' && e.event.targetAngle === 'asc' && e.event.aspect === 'conjunction',
    );
    for (const item of saturnConjAsc) {
      expect(item.relevance.inFocus).toBe(false);
      expect(item.relevance.tier).toBe('context');
      expect(item.relevance.matchedAngles).not.toContain('dsc');
    }

    // Probe 4C: Standalone synthetic 5.5° near-miss trine ASC (allowedOrbDeg: 6°) under chart-v0 (sextile: 4°)
    const sampleMoment = { utc: '2026-04-01T12:00:00.000Z', jdUt: 2461132.0, jdTt: 2461132.0008 };
    const nearMissTrineAsc: RangeEvent = {
      id: 'synth-near-miss-trine-asc',
      kind: 'angle-aspect-window',
      timing: 'future',
      transit: { chartId: 'transit', planetId: 'jupiter' },
      targetChartId: calgaryPlacidus.id,
      targetAngle: 'asc',
      aspect: 'trine',
      startsAt: sampleMoment,
      endsAt: sampleMoment,
      clippedStart: false,
      clippedEnd: false,
      passes: [{ at: sampleMoment, state: 'near-miss', residualDeg: 5.5, toleranceDeg: 0.001, retrograde: false, passNumberInSeries: null }],
      allowedOrbDeg: 6,
      series: {
        id: 'series-nm',
        branchLongitudeDeg: 120,
        windowIndex: 0,
        windowCountInRange: 1,
        exactPassCountInRange: 0,
        isRetrogradeSeries: false,
        clippedStart: false,
        clippedEnd: false,
        complete: true,
      },
    };
    const chartV0DscSextile = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      orbPolicy: 'chart-v0',
      includeFocusAngles: ['dsc'],
      includeAspects: ['sextile'],
    });
    const nmFocus = resolveResearchFocus(chartV0DscSextile, factors, registry);
    const nmEval = evaluateResearchEvents([nearMissTrineAsc], chartV0DscSextile, nmFocus, factors, registry);
    expect(nmEval.all[0].relevance.inFocus).toBe(false);
    expect(nmEval.all[0].relevance.tier).toBe('context');
    expect(nmEval.all[0].relevance.matchedAngles).toEqual([]);
  });

  test('Fix 2 (Blocker 2): exclusion-only Custom Search blocks excluded houses across ingress, egress, stations, angles and occupants', () => {
    const factors = resolveChartFactors(calgaryPlacidus);
    const registry = createThemeRegistry();
    const sampleMoment = { utc: '2026-03-01T00:00:00.000Z', jdUt: 2461100.5, jdTt: 2461100.5008 };

    // Find a natal planet sitting in House 7 if any, or use House 10/1 which is guaranteed occupied
    const occupiedHouse = factors.houses!.find(h => h.occupants.length > 0)!;
    const occupiedPlanet = occupiedHouse.occupants[0];
    const excludedH = 7 as HouseId;

    const events: readonly RangeEvent[] = [
      {
        id: 'ingress-6-to-7',
        kind: 'house-ingress',
        timing: 'future',
        planet: { chartId: 'transit', planetId: 'mars' },
        targetChartId: calgaryPlacidus.id,
        cuspHouseId: 7,
        fromHouse: 6,
        toHouse: 7,
        at: sampleMoment,
        retrograde: false,
        houseSystem: 'Placidus',
      },
      {
        id: 'egress-7-to-8',
        kind: 'house-ingress',
        timing: 'future',
        planet: { chartId: 'transit', planetId: 'mars' },
        targetChartId: calgaryPlacidus.id,
        cuspHouseId: 8,
        fromHouse: 7,
        toHouse: 8,
        at: sampleMoment,
        retrograde: false,
        houseSystem: 'Placidus',
      },
      {
        id: 'retro-egress-7-to-6',
        kind: 'house-ingress',
        timing: 'future',
        planet: { chartId: 'transit', planetId: 'mercury' },
        targetChartId: calgaryPlacidus.id,
        cuspHouseId: 7,
        fromHouse: 7,
        toHouse: 6,
        at: sampleMoment,
        retrograde: true,
        houseSystem: 'Placidus',
      },
      {
        id: 'ingress-5-to-6',
        kind: 'house-ingress',
        timing: 'future',
        planet: { chartId: 'transit', planetId: 'mars' },
        targetChartId: calgaryPlacidus.id,
        cuspHouseId: 6,
        fromHouse: 5,
        toHouse: 6,
        at: sampleMoment,
        retrograde: false,
        houseSystem: 'Placidus',
      },
      {
        id: 'station-in-7',
        kind: 'station',
        timing: 'future',
        planet: { chartId: 'transit', planetId: 'saturn' },
        at: sampleMoment,
        turns: 'retrograde',
        inNatalHouse: 7,
      },
      {
        id: 'dsc-direct',
        kind: 'angle-aspect-window',
        timing: 'future',
        transit: { chartId: 'transit', planetId: 'saturn' },
        targetChartId: calgaryPlacidus.id,
        targetAngle: 'dsc',
        aspect: 'conjunction',
        startsAt: sampleMoment,
        endsAt: sampleMoment,
        clippedStart: false,
        clippedEnd: false,
        passes: [{ at: sampleMoment, state: 'exact', residualDeg: 0, toleranceDeg: 0.001, retrograde: false, passNumberInSeries: 1 }],
        allowedOrbDeg: 3.5,
        series: {
          id: 'series-dsc',
          branchLongitudeDeg: factors.angles!.dsc.longitudeDeg,
          windowIndex: 0,
          windowCountInRange: 1,
          exactPassCountInRange: 1,
          isRetrogradeSeries: false,
          clippedStart: false,
          clippedEnd: false,
          complete: true,
        },
      },
      {
        id: 'aspect-to-occupied-house-planet',
        kind: 'aspect-window',
        timing: 'future',
        transit: { chartId: 'transit', planetId: 'jupiter' },
        target: { chartId: calgaryPlacidus.id, planetId: occupiedPlanet },
        aspect: 'trine',
        startsAt: sampleMoment,
        endsAt: sampleMoment,
        clippedStart: false,
        clippedEnd: false,
        passes: [{ at: sampleMoment, state: 'exact', residualDeg: 0, toleranceDeg: 0.001, retrograde: false, passNumberInSeries: 1 }],
        allowedOrbDeg: 3.5,
        series: {
          id: 'series-occ',
          branchLongitudeDeg: 0,
          windowIndex: 0,
          windowCountInRange: 1,
          exactPassCountInRange: 1,
          isRetrogradeSeries: false,
          clippedStart: false,
          clippedEnd: false,
          complete: true,
        },
      },
    ];

    const exclQuery = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-04-01',
      excludeHouses: [excludedH, occupiedHouse.houseId],
    });
    const exclFocus = resolveResearchFocus(exclQuery, factors, registry);
    const exclEval = evaluateResearchEvents(events, exclQuery, exclFocus, factors, registry, {
      solvedAngles: ['asc', 'mc', 'dsc', 'ic'],
    });

    const byId = (id: string) => exclEval.all.find(e => e.event.id === id)!;
    for (const blockedId of ['ingress-6-to-7', 'egress-7-to-8', 'retro-egress-7-to-6', 'station-in-7', 'dsc-direct', 'aspect-to-occupied-house-planet']) {
      expect(byId(blockedId).relevance.excludedByFocus).toBe(true);
      expect(byId(blockedId).relevance.inFocus).toBe(false);
      expect(byId(blockedId).relevance.tier).toBe('context');
      expect(byId(blockedId).relevance.matchedHouses).not.toContain(7);
    }
    expect(byId('ingress-5-to-6').relevance.inFocus).toBe(true);
    expect(byId('ingress-5-to-6').relevance.matchedHouses).toEqual([6]);

    // When House 8 IS explicitly active while House 7 is excluded, 7->8 matches ONLY House 8 (never 7), while 6->7 stays excluded
    const h8NotH7 = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-04-01',
      includeHouses: [8],
      excludeHouses: [7],
    });
    const h8Focus = resolveResearchFocus(h8NotH7, factors, registry);
    const h8Eval = evaluateResearchEvents(events, h8NotH7, h8Focus, factors, registry);
    const h8ById = (id: string) => h8Eval.all.find(e => e.event.id === id)!;
    expect(h8ById('egress-7-to-8').relevance.inFocus).toBe(true);
    expect(h8ById('egress-7-to-8').relevance.matchedHouses).toEqual([8]);
    expect(h8ById('ingress-6-to-7').relevance.excludedByFocus).toBe(true);
    expect(h8ById('ingress-6-to-7').relevance.inFocus).toBe(false);
  });

  test('Fix 3 (Blocker 3): re-times on referenceTt changes but invalidates reuse when transitChartId changes', () => {
    const factors = resolveChartFactors(calgaryPlacidus);
    const registry = createThemeRegistry();
    const startTt = utcDateToTt('2026-01-01');
    const endTt = utcDateToTt('2026-02-15');

    const query = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-02-15',
      transitingBodies: ['saturn', 'jupiter'],
      activeThemeIds: ['finances'],
    });
    const focus = resolveResearchFocus(query, factors, registry);
    const req = buildRangeSearchRequest(query, calgaryPlacidus, focus, {
      startTt,
      endTt,
      referenceTt: startTt,
      transitChartId: 'transit',
    });
    const raw = searchEventRange(engine, req);
    const session = createResearchSession({
      chart: calgaryPlacidus,
      query,
      rangeRequest: req,
      rawResult: raw,
      registry,
    });

    // Same referenceTt & transitChartId -> reuses cleanly
    expect(
      canReuseSessionComputation(session, query, calgaryPlacidus, {
        startTt,
        endTt,
        referenceTt: startTt,
        transitChartId: 'transit',
      }, registry),
    ).toBe(true);

    // Probe 5C (U6B-2 corrections, I1): moving the Time Machine reference only changes past/present/future timing.
    // The calculation is reused (same cache key) and timing is re-derived, never left stale.
    for (const referenceTt of [endTt, null]) {
      expect(
        canReuseSessionComputation(session, query, calgaryPlacidus, {
          startTt,
          endTt,
          referenceTt,
          transitChartId: 'transit',
        }, registry),
      ).toBe(true);
    }
    const refChangedReq = buildRangeSearchRequest(query, calgaryPlacidus, focus, {
      startTt,
      endTt,
      referenceTt: endTt,
      transitChartId: 'transit',
    });
    expect(computeRangeCacheKey(session.chartSignature, refChangedReq)).toBe(session.computeCacheKey);
    const atEnd = reEvaluateResearchSession(session, query, calgaryPlacidus, registry, endTt);
    expect(atEnd.rawResult.settings.referenceTt).toBe(endTt);
    expect(atEnd.rawResult.events.length).toBe(raw.events.length);
    expect(atEnd.rawResult.events.every(e => e.timing === 'past' || e.timing === 'present')).toBe(true);
    expect(session.rawResult.events.some(e => e.timing === 'future')).toBe(true); // the original session is untouched

    // Probe 5D: Changing transitChartId MUST invalidate reuse (even in superset body narrowing)
    const narrower = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-02-15',
      transitingBodies: ['saturn'],
      activeThemeIds: ['finances'],
    });
    expect(
      canReuseSessionComputation(session, narrower, calgaryPlacidus, {
        startTt,
        endTt,
        referenceTt: startTt,
        transitChartId: 'transit-alt',
      }, registry),
    ).toBe(false);
  });

  test('Fix 4 (Defect 4): degraded house-only and angle-only queries report unavailable focus instead of promoting all events', () => {
    const registry = createThemeRegistry();
    const startTt = utcDateToTt('2026-01-01');
    const endTt = utcDateToTt('2026-05-01');

    // Probe 6A: Unknown birth time + house-only query (includeHouses: [10])
    const unknownFactors = resolveChartFactors(unknownTimeChart);
    const houseOnlyThemes = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-05-01',
      transitingBodies: ['mercury', 'jupiter', 'saturn'],
      includeHouses: [10],
    });
    const uFocus = resolveResearchFocus(houseOnlyThemes, unknownFactors, registry);
    expect(uFocus.unavailableFocus).toBe(true);
    expect(uFocus.notices.some(n => n.code === 'requested-houses-or-angles-unavailable')).toBe(true);
    const uReq = buildRangeSearchRequest(houseOnlyThemes, unknownTimeChart, uFocus, {
      startTt,
      endTt,
      referenceTt: startTt,
    });
    const uRaw = searchEventRange(engine, uReq);
    expect(uRaw.events.length).toBeGreaterThan(0);
    const uEval = evaluateResearchEvents(uRaw.events, houseOnlyThemes, uFocus, unknownFactors, registry);
    expect(uEval.relevant).toHaveLength(0);
    expect(uEval.broaderContext).toHaveLength(uRaw.events.length);
    expect(uEval.broaderContext.every(e => e.relevance.whyRelevant.includes('unavailable for this chart'))).toBe(true);

    // Probe 6B: Missing coordinates + house-only & angle-only Custom Search
    const noCoordsFactors = resolveChartFactors(noCoordsChart);
    const angleOnlyCustom = createCustomSearchQuery({
      startDate: '2026-01-01',
      endDate: '2026-05-01',
      transitingBodies: ['mercury', 'saturn'],
      includeFocusAngles: ['mc'],
    });
    const ncFocus = resolveResearchFocus(angleOnlyCustom, noCoordsFactors, registry);
    expect(ncFocus.unavailableFocus).toBe(true);
    expect(ncFocus.notices.some(n => n.code === 'requested-houses-or-angles-unavailable')).toBe(true);
    const ncReq = buildRangeSearchRequest(angleOnlyCustom, noCoordsChart, ncFocus, {
      startTt,
      endTt,
      referenceTt: startTt,
    });
    const ncRaw = searchEventRange(engine, ncReq);
    expect(ncRaw.events.length).toBeGreaterThan(0);
    const ncEval = evaluateResearchEvents(ncRaw.events, angleOnlyCustom, ncFocus, noCoordsFactors, registry);
    expect(ncEval.relevant).toHaveLength(0);
    expect(ncEval.broaderContext).toHaveLength(ncRaw.events.length);
  });

  test('Fix 5 (Defect 5): findInterceptedSigns detects exact 0° next-cusp boundaries including 0° Aries wraparound', () => {
    const makeCusps = (h1: number, h2: number, h12 = 330) => ({
      cusps: [
        { houseId: 1 as HouseId, longitudeDeg: h1 },
        { houseId: 2 as HouseId, longitudeDeg: h2 },
        { houseId: 3 as HouseId, longitudeDeg: 90 },
        { houseId: 4 as HouseId, longitudeDeg: 120 },
        { houseId: 5 as HouseId, longitudeDeg: 150 },
        { houseId: 6 as HouseId, longitudeDeg: 180 },
        { houseId: 7 as HouseId, longitudeDeg: 210 },
        { houseId: 8 as HouseId, longitudeDeg: 240 },
        { houseId: 9 as HouseId, longitudeDeg: 270 },
        { houseId: 10 as HouseId, longitudeDeg: 290 },
        { houseId: 11 as HouseId, longitudeDeg: 310 },
        { houseId: 12 as HouseId, longitudeDeg: h12 },
      ],
      ascendantDeg: h1,
      midheavenDeg: 290,
      effectiveSystem: 'Placidus',
      fallback: false,
    });

    expect(findInterceptedSigns(makeCusps(0, 60), 1)).toEqual([1]);     // 0° Aries -> 0° Gemini intercepts Taurus
    expect(findInterceptedSigns(makeCusps(29, 60), 1)).toEqual([1]);    // 29° Aries -> 0° Gemini intercepts Taurus
    expect(findInterceptedSigns(makeCusps(0, 30), 1)).toEqual([]);      // Exact 30° Whole Sign has no interception
    expect(findInterceptedSigns(makeCusps(29, 59.9), 1)).toEqual([]);   // H2 sits inside Taurus -> not intercepted
    expect(findInterceptedSigns(makeCusps(0, 30, 325), 12)).toEqual([11]); // 25° Aquarius -> 0° Aries intercepts Pisces
  });

  test('Fix 6 (Axis Scoring): counts one physical ASC/DSC contact only once (+25) while keeping both angle labels and theme attributions', () => {
    const factors = resolveChartFactors(calgaryPlacidus);
    const registry = createThemeRegistry();
    const sampleMoment = { utc: '2026-04-01T12:00:00.000Z', jdUt: 2461132.0, jdTt: 2461132.0008 };

    // Both ASC (entrepreneurship) and DSC (relationships) are active simultaneously
    const bothEndsQuery = createLifeThemesQuery({
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      transitingBodies: SUN_TO_PLUTO_BODIES,
      activeThemeIds: ['entrepreneurship', 'relationships'],
      orbPolicy: 'transit-focused',
    });
    const focus = resolveResearchFocus(bothEndsQuery, factors, registry);
    expect(focus.activeAngles).toContain('asc');
    expect(focus.activeAngles).toContain('dsc');

    const saturnOppAsc: RangeEvent = {
      id: 'saturn-opp-asc-axis-test',
      kind: 'angle-aspect-window',
      timing: 'future',
      transit: { chartId: 'transit', planetId: 'saturn' },
      targetChartId: calgaryPlacidus.id,
      targetAngle: 'asc',
      aspect: 'opposition',
      startsAt: sampleMoment,
      endsAt: sampleMoment,
      clippedStart: false,
      clippedEnd: false,
      passes: [{ at: sampleMoment, state: 'exact', residualDeg: 0, toleranceDeg: 0.001, retrograde: false, passNumberInSeries: 1 }],
      allowedOrbDeg: 3.5,
      series: {
        id: 'series-axis',
        branchLongitudeDeg: factors.angles!.dsc.longitudeDeg,
        windowIndex: 0,
        windowCountInRange: 1,
        exactPassCountInRange: 1,
        isRetrogradeSeries: false,
        clippedStart: false,
        clippedEnd: false,
        complete: true,
      },
    };

    const evaluated = evaluateResearchEvents([saturnOppAsc], bothEndsQuery, focus, factors, registry, {
      solvedAngles: ['asc', 'mc'],
    });
    const rel = evaluated.all[0].relevance;
    const angleReasons = rel.reasons.filter(r => r.code === 'angle-axis-contact');
    expect(angleReasons).toHaveLength(1);
    expect(angleReasons[0].points).toBe(25);
    expect(rel.matchedAngles).toEqual(['asc', 'dsc']);
    expect(rel.matchedThemeIds).toEqual(['entrepreneurship', 'relationships']);
    expect(rel.reasons.some(r => r.code === 'multi-theme-convergence' && r.points === 12)).toBe(true);
    expect(rel.rawScore).toBe(rel.reasons.reduce((sum, r) => sum + r.points, 0));
    // Expected exact breakdown: angle-axis-contact (25) + multi-theme-convergence (12) + social cycle (12) + exact pass (8) = 57 (not 82)
    expect(rel.rawScore).toBe(57);
  });
});
