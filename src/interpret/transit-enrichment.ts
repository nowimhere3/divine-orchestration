import { angularSeparation, createAspectRuleSet, MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectId } from '../domain/aspects';
import type { PlanetId } from '../domain/chart';
import type { AstrologyEvent } from '../domain/event';
import type { EphemeraEngine, PlanetName } from '../engine/ephemera';
import { EPHEMERA_COVERAGE_TT } from '../engine/ephemera';
import { jdTtToResolvedTime } from '../lunar/events';
import { searchEvents } from '../search/events';
import type { FixedNatalPoint } from '../search/events';
import { aspectWindows, TIME_EPS, uniqueTimes } from '../search/geometry';
import type { Sample } from '../search/geometry';
import { instantFromTt, instantFromUt } from '../time/ephemeris-time';
import { planetName, wrapDegrees } from '../view/chart-data';
import { passViews, retrogradeAt } from '../view/event-model';
import { transitMaxOrb } from './transit-math';
import type {
  NearbyStationInfo,
  TransitEnrichmentData,
  TransitEnrichmentHouseTarget,
  TransitEnrichmentPair,
  TransitEnrichmentRequest,
  TransitHouseSpan,
  TransitPassSummary,
  TransitWindowEnrichment,
} from './transit-types';

type AspectWindowEvent = Extract<AstrologyEvent, { kind: 'aspect-window' }>;
type StationEvent = Extract<AstrologyEvent, { kind: 'station' }>;

function searchHalfWindowDays(planetId: PlanetId): number {
  switch (planetId) {
    case 'moon': return 2;
    case 'sun':
    case 'mercury':
    case 'venus': return 75;
    case 'mars': return 120;
    case 'jupiter':
    case 'saturn':
    case 'uranus':
    case 'neptune':
    case 'pluto': return 365;
  }
}

function houseCrossingMaxDays(planetId: PlanetId): number {
  switch (planetId) {
    case 'mars': return 120;
    case 'jupiter': return 450;
    case 'saturn': return 1100;
    case 'uranus':
    case 'neptune':
    case 'pluto': return 1500;
    default: return 45;
  }
}

function isSlowBody(planetId: PlanetId): boolean {
  return planetId === 'jupiter' || planetId === 'saturn' || planetId === 'uranus' || planetId === 'neptune' || planetId === 'pluto';
}

/**
 * Conservative upper bound on a single retrograde loop arc (degrees) for each planet.
 * When a planet exits orb inside the search horizon yet remains inside this shadow radius
 * at the horizon edge without having completed a full retrograde+direct miss, an additional
 * pass or orb re-entry beyond the horizon cannot be ruled out.
 */
const MAX_RETROGRADE_ARC_DEG: Readonly<Record<PlanetId, number>> = {
  sun: 0,
  moon: 0,
  mercury: 17,
  venus: 18,
  mars: 20,
  jupiter: 11,
  saturn: 8,
  uranus: 5,
  neptune: 3.5,
  pluto: 3.5,
};

function deduplicateStationTts(stationTts: readonly number[]): readonly number[] {
  const unique: number[] = [];
  for (const tt of [...stationTts].sort((a, b) => a - b)) {
    if (!unique.length || Math.abs(tt - unique[unique.length - 1]) > 0.05) {
      unique.push(tt);
    }
  }
  return unique;
}

function exactBranchLongitude(targetLongitudeDeg: number, aspect: AspectId, nearLon: number | null): number {
  const angle = MAJOR_ASPECT_ANGLES[aspect];
  const plus = wrapDegrees(targetLongitudeDeg + angle);
  if (angle === 0 || angle === 180 || nearLon === null) return plus;
  const minus = wrapDegrees(targetLongitudeDeg - angle);
  return angularSeparation(nearLon, plus) <= angularSeparation(nearLon, minus) ? plus : minus;
}

function isSeriesOpenAtHorizon(
  body: PlanetId,
  branchLon: number,
  allowedOrbDeg: number,
  horizonLon: number | null,
  stationsBetweenEdgeAndWindow: number,
): boolean {
  if (body === 'sun' || body === 'moon') return false;
  if (stationsBetweenEdgeAndWindow >= 2) return false;
  if (horizonLon === null) return true;
  return angularSeparation(horizonLon, branchLon) <= allowedOrbDeg + MAX_RETROGRADE_ARC_DEG[body];
}

function ttToEpochMs(engine: EphemeraEngine, jdTt: number): number {
  return jdTtToResolvedTime(engine, jdTt).epochMs;
}

function deduplicatePasses(
  passes: readonly TransitPassSummary[],
): readonly TransitPassSummary[] {
  const sorted = [...passes].sort((a, b) => a.jdTt - b.jdTt);
  const merged: TransitPassSummary[] = [];
  for (const pass of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(pass.jdTt - prev.jdTt) <= 0.001) {
      // Keep the tighter / non-near-miss pass if duplicated at chunk seam.
      if (prev.state === 'near-miss' && pass.state !== 'near-miss') merged[merged.length - 1] = pass;
      continue;
    }
    merged.push(pass);
  }
  const totalExact = merged.filter(p => p.state !== 'near-miss').length;
  let exactIdx = 0;
  return merged.map(pass => ({
    ...pass,
    passNumber: pass.state === 'near-miss' ? null : ++exactIdx,
    totalExactPasses: totalExact,
  }));
}

function pickNearestPass(passes: readonly TransitPassSummary[], selectedTt: number): TransitPassSummary | null {
  if (!passes.length) return null;
  const exact = passes.filter(p => p.state !== 'near-miss');
  const pool = exact.length ? exact : passes;
  return [...pool].sort((a, b) => Math.abs(a.jdTt - selectedTt) - Math.abs(b.jdTt - selectedTt))[0] ?? null;
}

interface SeriesWindowCandidate<T> {
  readonly start: number;
  readonly end: number;
  readonly repLon: number | null;
  readonly item: T;
}

/**
 * Selects the active aspect window containing `selectedTt` together with any adjacent windows
 * bridged across a chunk seam or across a single retrograde turnaround station of the same
 * aspect branch (e.g., direct -> retrograde -> direct triple-pass series).
 */
function selectSeriesWindows<T>(
  candidates: readonly SeriesWindowCandidate<T>[],
  body: PlanetId,
  selectedTt: number,
  stationTts: readonly number[],
): readonly T[] {
  if (!candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => a.start - b.start || a.end - b.end);
  const uniqueStations: number[] = [];
  for (const tt of [...stationTts].sort((a, b) => a - b)) {
    if (!uniqueStations.length || Math.abs(tt - uniqueStations[uniqueStations.length - 1]) > 0.05) {
      uniqueStations.push(tt);
    }
  }

  let seedIdx = sorted.findIndex(w => selectedTt >= w.start - 0.05 && selectedTt <= w.end + 0.05);
  if (seedIdx === -1) {
    let bestDist = Infinity;
    sorted.forEach((w, i) => {
      const mid = Number.isFinite(w.start) && Number.isFinite(w.end) ? (w.start + w.end) / 2 : selectedTt;
      const dist = Math.abs(mid - selectedTt);
      if (dist < bestDist) {
        bestDist = dist;
        seedIdx = i;
      }
    });
  }

  const areChained = (left: SeriesWindowCandidate<T>, right: SeriesWindowCandidate<T>): boolean => {
    if (right.start <= left.end + 0.1) return true;
    if (body === 'sun' || body === 'moon') return false;
    const stationsBetween = uniqueStations.filter(tt => tt > left.end - 0.1 && tt < right.start + 0.1);
    if (stationsBetween.length !== 1) return false;
    if (left.repLon !== null && right.repLon !== null && angularSeparation(left.repLon, right.repLon) > 25) {
      return false;
    }
    return true;
  };

  let lo = seedIdx;
  while (lo > 0 && areChained(sorted[lo - 1], sorted[lo])) lo -= 1;
  let hi = seedIdx;
  while (hi < sorted.length - 1 && areChained(sorted[hi], sorted[hi + 1])) hi += 1;

  return sorted.slice(lo, hi + 1).map(c => c.item);
}

function solveAnglePairWindow(
  engine: EphemeraEngine,
  pair: TransitEnrichmentPair,
  selectedTt: number,
  halfDays: number,
  stations: readonly StationEvent[],
): TransitWindowEnrichment | null {
  const start = Math.max(EPHEMERA_COVERAGE_TT.start, selectedTt - halfDays);
  const end = Math.min(EPHEMERA_COVERAGE_TT.end, selectedTt + halfDays);
  if (end <= start) return null;

  const modelDelta = engine.modelDeltaTSeconds;
  const bodyName = planetName(pair.transitId) as PlanetName;
  const samples = new Map<number, Sample>();
  const sample = (tt: number): Sample => {
    const existing = samples.get(tt);
    if (existing) return existing;
    const res = engine.position(bodyName, instantFromTt(tt, modelDelta));
    if (res.status !== 'ok') throw new Error(res.reason);
    const value: Sample = { tt, longitude: res.value.longitude, speed: res.value.longitudeSpeed };
    samples.set(tt, value);
    return value;
  };
  const seed = (longitude: number, a: number, b: number) => {
    const left = instantFromTt(a, modelDelta).jdUt;
    const right = instantFromTt(b, modelDelta).jdUt;
    if (right <= left) return null;
    const res = engine.crossing(bodyName, longitude, left, { direction: 1, maxDays: right - left });
    return res.status === 'ok' ? instantFromUt(res.value.jdUt, modelDelta).jdTt : null;
  };

  try {
    const turns = stations
      .filter(s => s.planet.planetId === pair.transitId && s.at.jdTt !== null && s.at.jdTt > start && s.at.jdTt < end)
      .map(s => s.at.jdTt!);
    const gridStep = pair.transitId === 'moon' ? 0.5 : 4;
    const grid = Array.from({ length: Math.ceil((end - start) / gridStep) }, (_, i) => start + i * gridStep);
    const track = [start, ...uniqueTimes([...grid, ...turns]).filter(t => t - start > TIME_EPS && end - t > TIME_EPS), end].map(sample);
    const windows = aspectWindows(track, turns, pair.targetLongitudeDeg, MAJOR_ASPECT_ANGLES[pair.aspect], pair.allowedOrbDeg, sample, seed);
    const chosen = selectSeriesWindows(
      windows.map(w => ({
        start: w.start,
        end: w.end,
        repLon: w.passes[0] ? sample(w.passes[0].tt).longitude : sample((w.start + w.end) / 2).longitude,
        item: w,
      })),
      pair.transitId,
      selectedTt,
      turns,
    );
    if (!chosen.length) return null;

    const rawPasses: TransitPassSummary[] = chosen.flatMap(w => w.passes.map((pass) => {
      const resolved = jdTtToResolvedTime(engine, pass.tt);
      const speed = sample(pass.tt).speed;
      return {
        jdTt: pass.tt,
        epochMs: resolved.epochMs,
        utc: resolved.utc,
        state: pass.state,
        residualDeg: pass.residual,
        retrograde: pair.transitId === 'sun' || pair.transitId === 'moon' ? false : speed < 0,
        passNumber: null,
        totalExactPasses: 0,
      };
    }));
    const passes = deduplicatePasses(rawPasses);
    const exactCount = passes.filter(p => p.state !== 'near-miss').length;
    const first = chosen[0];
    const last = chosen[chosen.length - 1];
    const uniqueTurns = deduplicateStationTts(turns);
    const firstRepLon = first.passes[0] ? sample(first.passes[0].tt).longitude : sample((first.start + first.end) / 2).longitude;
    const lastRepLon = last.passes[0] ? sample(last.passes[0].tt).longitude : sample((last.start + last.end) / 2).longitude;
    const startBranch = exactBranchLongitude(pair.targetLongitudeDeg, pair.aspect, firstRepLon);
    const endBranch = exactBranchLongitude(pair.targetLongitudeDeg, pair.aspect, lastRepLon);
    const shadowClippedStart = !first.clippedStart && isSeriesOpenAtHorizon(
      pair.transitId,
      startBranch,
      pair.allowedOrbDeg,
      sample(start).longitude,
      uniqueTurns.filter(tt => tt > start + 1e-4 && tt < first.start - 1e-4).length,
    );
    const shadowClippedEnd = !last.clippedEnd && isSeriesOpenAtHorizon(
      pair.transitId,
      endBranch,
      pair.allowedOrbDeg,
      sample(end).longitude,
      uniqueTurns.filter(tt => tt > last.end + 1e-4 && tt < end - 1e-4).length,
    );
    const clippedStart = first.clippedStart || shadowClippedStart;
    const clippedEnd = last.clippedEnd || shadowClippedEnd;
    return {
      key: pair.key,
      startsAtEpochMs: clippedStart ? null : ttToEpochMs(engine, first.start),
      endsAtEpochMs: clippedEnd ? null : ttToEpochMs(engine, last.end),
      clippedStart,
      clippedEnd,
      passes,
      nearestPass: pickNearestPass(passes, selectedTt),
      isRetrogradeSeries: exactCount > 1 || passes.some(p => p.retrograde === true),
    };
  } catch {
    return null;
  }
}

function computeHouseSpan(
  engine: EphemeraEngine,
  target: TransitEnrichmentHouseTarget,
  selectedTt: number,
): TransitHouseSpan | null {
  const maxDays = houseCrossingMaxDays(target.planetId);
  const selectedUt = instantFromTt(selectedTt, engine.modelDeltaTSeconds).jdUt;
  const bodyName = planetName(target.planetId) as PlanetName;

  const cuspStart = wrapDegrees(target.cuspStartDeg);
  const cuspEnd = wrapDegrees(target.cuspEndDeg);
  const backStart = engine.crossing(bodyName, cuspStart, selectedUt, { direction: -1, maxDays });
  const backEnd = engine.crossing(bodyName, cuspEnd, selectedUt, { direction: -1, maxDays });
  const fwdStart = engine.crossing(bodyName, cuspStart, selectedUt, { direction: 1, maxDays });
  const fwdEnd = engine.crossing(bodyName, cuspEnd, selectedUt, { direction: 1, maxDays });

  let enteredUt: number | null = null;
  let enteredRetro = false;
  if (backStart.status === 'ok' && backEnd.status === 'ok') {
    if (backEnd.value.jdUt > backStart.value.jdUt) {
      enteredUt = backEnd.value.jdUt;
      enteredRetro = true;
    } else {
      enteredUt = backStart.value.jdUt;
    }
  } else if (backStart.status === 'ok') {
    enteredUt = backStart.value.jdUt;
  } else if (backEnd.status === 'ok') {
    enteredUt = backEnd.value.jdUt;
    enteredRetro = true;
  }

  let exitsUt: number | null = null;
  let exitsRetro = false;
  if (fwdStart.status === 'ok' && fwdEnd.status === 'ok') {
    if (fwdStart.value.jdUt < fwdEnd.value.jdUt) {
      exitsUt = fwdStart.value.jdUt;
      exitsRetro = true;
    } else {
      exitsUt = fwdEnd.value.jdUt;
    }
  } else if (fwdEnd.status === 'ok') {
    exitsUt = fwdEnd.value.jdUt;
  } else if (fwdStart.status === 'ok') {
    exitsUt = fwdStart.value.jdUt;
    exitsRetro = true;
  }

  const enteredAtEpochMs = enteredUt !== null
    ? ttToEpochMs(engine, instantFromUt(enteredUt, engine.modelDeltaTSeconds).jdTt)
    : null;
  const exitsAtEpochMs = exitsUt !== null
    ? ttToEpochMs(engine, instantFromUt(exitsUt, engine.modelDeltaTSeconds).jdTt)
    : null;

  return {
    planetId: target.planetId,
    houseNumber: target.houseNumber,
    enteredAtEpochMs,
    exitsAtEpochMs,
    clippedEntry: enteredUt === null,
    clippedExit: exitsUt === null,
    includesRetrogradeReentry: enteredRetro || exitsRetro,
  };
}

/**
 * Pure Tier-2 transit enrichment solver (runs inside the event Web Worker in the browser
 * or directly in Vitest unit tests). Computes exact contact dates, multi-pass retrograde
 * repetitions (with 2-chunk 730-day stitching for slow outer planets), nearby stations,
 * and natal house ingress/egress dates.
 */
export function computeTransitEnrichment(
  engine: EphemeraEngine,
  request: TransitEnrichmentRequest,
): TransitEnrichmentData {
  const { selectedTt } = request;
  const windows: Record<string, TransitWindowEnrichment> = {};
  const houseSpans: Record<string, TransitHouseSpan> = {};
  const stationEvents: StationEvent[] = [];
  let partial = false;

  // Group planet-to-planet pairs by transiting body so each body's track is sampled minimally.
  const pairsByBody = new Map<PlanetId, TransitEnrichmentPair[]>();
  for (const pair of request.pairs) {
    pairsByBody.set(pair.transitId, [...(pairsByBody.get(pair.transitId) ?? []), pair]);
  }

  for (const [body, pairs] of pairsByBody) {
    const planetPairs = pairs.filter(p => p.target.kind === 'planet');
    const anglePairs = pairs.filter(p => p.target.kind === 'angle');
    const halfDays = searchHalfWindowDays(body);
    const rules = createAspectRuleSet({
      conjunction: transitMaxOrb(body, 'conjunction'),
      sextile: transitMaxOrb(body, 'sextile'),
      square: transitMaxOrb(body, 'square'),
      trine: transitMaxOrb(body, 'trine'),
      opposition: transitMaxOrb(body, 'opposition'),
    });

    // Unique natal planet targets needed for this transiting body
    const uniqueTargets = new Map<PlanetId, FixedNatalPoint>();
    for (const pair of planetPairs) {
      if (pair.target.kind === 'planet' && !uniqueTargets.has(pair.target.planetId)) {
        uniqueTargets.set(pair.target.planetId, {
          chartId: 'natal',
          planetId: pair.target.planetId,
          longitudeDeg: pair.targetLongitudeDeg,
        });
      }
    }

    // Run 1 chunk for fast/medium bodies, or 2 contiguous 365-day chunks for slow outer bodies
    // so multi-pass retrograde series (> 366 days) stitch seamlessly without raising MAX_SEARCH_DAYS.
    const chunks: readonly (readonly [number, number])[] = isSlowBody(body)
      ? [
        [Math.max(EPHEMERA_COVERAGE_TT.start, selectedTt - 365), selectedTt],
        [selectedTt, Math.min(EPHEMERA_COVERAGE_TT.end, selectedTt + 365)],
      ]
      : [
        [Math.max(EPHEMERA_COVERAGE_TT.start, selectedTt - halfDays), Math.min(EPHEMERA_COVERAGE_TT.end, selectedTt + halfDays)],
      ];

    const globalStart = chunks[0][0];
    const globalEnd = chunks[chunks.length - 1][1];
    const chunkEvents: AstrologyEvent[] = [];
    const windowRecords: { readonly event: AspectWindowEvent; readonly chunkStart: number; readonly chunkEnd: number }[] = [];
    for (const [chunkStart, chunkEnd] of chunks) {
      if (chunkEnd <= chunkStart) {
        partial = true;
        continue;
      }
      const res = searchEvents(engine, {
        startTt: chunkStart,
        endTt: chunkEnd,
        referenceTt: selectedTt,
        transitChartId: 'transit',
        bodies: [body],
        targets: [...uniqueTargets.values()],
        rules,
      });
      if (res.status !== 'complete') partial = true;
      if (res.context?.events) {
        chunkEvents.push(...res.context.events);
        for (const ev of res.context.events) {
          if (ev.kind === 'aspect-window') windowRecords.push({ event: ev, chunkStart, chunkEnd });
        }
      }
    }

    const bodyStations = chunkEvents.filter((e): e is StationEvent => e.kind === 'station');
    const bodyStationTts = deduplicateStationTts(
      bodyStations.map(s => s.at.jdTt).filter((tt): tt is number => tt !== null),
    );
    stationEvents.push(...bodyStations);

    const bodyLonAt = (tt: number | null): number | null => {
      if (tt === null || !Number.isFinite(tt)) return null;
      const p = engine.position(planetName(body), instantFromTt(tt, engine.modelDeltaTSeconds));
      return p.status === 'ok' ? p.value.longitude : null;
    };

    // Match & stitch windows for each active planet-to-planet pair
    for (const pair of planetPairs) {
      if (pair.target.kind !== 'planet') continue;
      const targetId = pair.target.planetId;
      const matching = windowRecords.filter(rec =>
        rec.event.transit.planetId === body
        && rec.event.target.planetId === targetId
        && rec.event.aspect === pair.aspect,
      );
      if (!matching.length) continue;

      // Chain windows overlapping selectedTt across chunk seams AND across single-station
      // retrograde turnaround loops (direct -> retrograde -> direct triple passes).
      const chosen = selectSeriesWindows(
        matching.map(rec => {
          const w = rec.event;
          const s = w.startsAt?.jdTt ?? rec.chunkStart;
          const e = w.endsAt?.jdTt ?? rec.chunkEnd;
          const repTt = w.passes[0]?.at.jdTt ?? (Number.isFinite(s) && Number.isFinite(e) ? (s + e) / 2 : null);
          return { start: s, end: e, repLon: bodyLonAt(repTt), item: { ...rec, startTt: s, endTt: e, repLon: bodyLonAt(repTt) } };
        }),
        body,
        selectedTt,
        bodyStationTts,
      );

      const first = chosen[0];
      const last = chosen[chosen.length - 1];

      const rawPasses: TransitPassSummary[] = [];
      for (const rec of chosen) {
        const w = rec.event;
        for (const pv of passViews(w, chunkEvents)) {
          if (pv.pass.at.jdTt === null) continue;
          const retro = pv.retrograde ?? retrogradeAt(body, pv.pass.at.jdTt, chunkEvents);
          const posSpeed = retro === null
            ? (() => {
              const p = engine.position(planetName(body), instantFromTt(pv.pass.at.jdTt!, engine.modelDeltaTSeconds));
              return p.status === 'ok' ? p.value.retrograde : null;
            })()
            : retro;
          rawPasses.push({
            jdTt: pv.pass.at.jdTt,
            epochMs: ttToEpochMs(engine, pv.pass.at.jdTt),
            utc: pv.pass.at.utc,
            state: pv.pass.state,
            residualDeg: pv.pass.residualDeg,
            retrograde: posSpeed,
            passNumber: null,
            totalExactPasses: 0,
          });
        }
      }

      const passes = deduplicatePasses(rawPasses);
      const exactCount = passes.filter(p => p.state !== 'near-miss').length;

      // Derive bounds and clipping flags strictly from the chronological outer windows,
      // distinguishing internal chunk-seam clipping from true outer-horizon clipping and
      // checking whether a retrograde planet remains inside its return shadow at the horizon.
      const directClippedStart = first.event.startsAt === null
        || (first.event.clippedStart && Math.abs(first.chunkStart - globalStart) <= 1e-4);
      const directClippedEnd = last.event.endsAt === null
        || (last.event.clippedEnd && Math.abs(last.chunkEnd - globalEnd) <= 1e-4);

      const startBranch = exactBranchLongitude(pair.targetLongitudeDeg, pair.aspect, first.repLon);
      const endBranch = exactBranchLongitude(pair.targetLongitudeDeg, pair.aspect, last.repLon);
      const shadowClippedStart = !directClippedStart && isSeriesOpenAtHorizon(
        body,
        startBranch,
        pair.allowedOrbDeg,
        bodyLonAt(globalStart),
        bodyStationTts.filter(tt => tt > globalStart + 1e-4 && tt < first.startTt - 1e-4).length,
      );
      const shadowClippedEnd = !directClippedEnd && isSeriesOpenAtHorizon(
        body,
        endBranch,
        pair.allowedOrbDeg,
        bodyLonAt(globalEnd),
        bodyStationTts.filter(tt => tt > last.endTt + 1e-4 && tt < globalEnd - 1e-4).length,
      );

      const clippedStart = directClippedStart || shadowClippedStart;
      const clippedEnd = directClippedEnd || shadowClippedEnd;
      const startTt = !clippedStart ? first.event.startsAt?.jdTt ?? null : null;
      const endTt = !clippedEnd ? last.event.endsAt?.jdTt ?? null : null;

      windows[pair.key] = {
        key: pair.key,
        startsAtEpochMs: startTt !== null ? ttToEpochMs(engine, startTt) : null,
        endsAtEpochMs: endTt !== null ? ttToEpochMs(engine, endTt) : null,
        clippedStart,
        clippedEnd,
        passes,
        nearestPass: pickNearestPass(passes, selectedTt),
        isRetrogradeSeries: exactCount > 1 || passes.some(p => p.retrograde === true),
      };
    }

    // Solve active transit-to-angle pairs using the exact same geometry solver
    for (const pair of anglePairs) {
      const solved = solveAnglePairWindow(engine, pair, selectedTt, isSlowBody(body) ? 365 : halfDays, bodyStations);
      if (solved) windows[pair.key] = solved;
    }
  }

  // Deduplicate nearby stations within ±14 days of selectedTt
  const seenStations = new Set<string>();
  const nearbyStations: NearbyStationInfo[] = [];
  for (const st of stationEvents) {
    if (st.at.jdTt === null) continue;
    const deltaDays = st.at.jdTt - selectedTt;
    if (Math.abs(deltaDays) > 14) continue;
    const key = `${st.planet.planetId}|${st.turns}|${Math.round(st.at.jdTt * 10)}`;
    if (seenStations.has(key)) continue;
    seenStations.add(key);
    nearbyStations.push({
      planetId: st.planet.planetId,
      turns: st.turns,
      epochMs: ttToEpochMs(engine, st.at.jdTt),
      jdTt: st.at.jdTt,
      daysFromSelected: deltaDays,
    });
  }
  nearbyStations.sort((a, b) => Math.abs(a.daysFromSelected) - Math.abs(b.daysFromSelected));

  // House ingress/egress for requested transiting planets
  for (const hTarget of request.houseTargets) {
    const span = computeHouseSpan(engine, hTarget, selectedTt);
    if (span) houseSpans[hTarget.planetId] = span;
  }

  return {
    signature: request.signature,
    status: partial ? 'partial' : 'ready',
    windows,
    houseSpans,
    nearbyStations,
  };
}
