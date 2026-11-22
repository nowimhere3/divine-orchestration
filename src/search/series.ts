import { angularSeparation, MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectId } from '../domain/aspects';
import type { PlanetId } from '../domain/chart';
import { normalize } from './geometry';

/** Slow outer and social planets eligible for extended multi-year range searches and chunk stitching. */
export const SLOW_PLANET_IDS: readonly PlanetId[] = Object.freeze([
  'jupiter', 'saturn', 'uranus', 'neptune', 'pluto',
]);

export function isSlowBody(planetId: PlanetId): boolean {
  return planetId === 'jupiter' || planetId === 'saturn' || planetId === 'uranus' || planetId === 'neptune' || planetId === 'pluto';
}

/**
 * Conservative upper bound on a single retrograde loop arc (degrees) for each planet.
 * When a planet exits orb inside the search horizon yet remains inside this shadow radius
 * at the horizon edge without having completed a full retrograde+direct miss, an additional
 * pass or orb re-entry beyond the horizon cannot be ruled out.
 */
export const MAX_RETROGRADE_ARC_DEG: Readonly<Record<PlanetId, number>> = Object.freeze({
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
});

export function deduplicateStationTts(stationTts: readonly number[], spacingDays = 0.05): readonly number[] {
  const unique: number[] = [];
  for (const tt of [...stationTts].sort((a, b) => a - b)) {
    if (!unique.length || Math.abs(tt - unique[unique.length - 1]) > spacingDays) {
      unique.push(tt);
    }
  }
  return unique;
}

/**
 * Resolves which exact ecliptic longitude branch (`target + angle` or `target - angle`)
 * an aspect window occupies, using a representative longitude from inside the window.
 * Prevents ever merging opposite/mirror aspect branches (e.g., waxing vs. waning square).
 */
export function exactBranchLongitude(targetLongitudeDeg: number, aspect: AspectId, nearLon: number | null): number {
  const angle = MAJOR_ASPECT_ANGLES[aspect];
  const plus = normalize(targetLongitudeDeg + angle);
  if (angle === 0 || angle === 180 || nearLon === null) return plus;
  const minus = normalize(targetLongitudeDeg - angle);
  return angularSeparation(nearLon, plus) <= angularSeparation(nearLon, minus) ? plus : minus;
}

/**
 * Returns true if a retrograde-capable planet remains close enough to `branchLon` at a
 * search horizon edge that an additional pass or orb re-entry beyond the horizon cannot be ruled out.
 */
export function isSeriesOpenAtHorizon(
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

export interface SeriesWindowCandidate<T> {
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
export function selectSeriesWindows<T>(
  candidates: readonly SeriesWindowCandidate<T>[],
  body: PlanetId,
  selectedTt: number,
  stationTts: readonly number[],
): readonly T[] {
  if (!candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => a.start - b.start || a.end - b.end);
  const uniqueStations = deduplicateStationTts(stationTts);

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

/**
 * Checks whether two adjacent-chunk aspect windows represent one continuous in-orb window
 * split across a chunk seam on the exact same aspect branch.
 */
export function areWindowsSeamAdjacent(
  left: { readonly chunkIndex: number; readonly endTt: number; readonly clippedEnd: boolean; readonly branchLon: number },
  right: { readonly chunkIndex: number; readonly startTt: number; readonly clippedStart: boolean; readonly branchLon: number },
): boolean {
  if (left.chunkIndex + 1 !== right.chunkIndex) return false;
  if (!left.clippedEnd || !right.clippedStart) return false;
  if (Math.abs(left.endTt - right.startTt) > 1e-4) return false;
  return angularSeparation(left.branchLon, right.branchLon) < 1.0;
}

/**
 * Checks whether two chronological stitched windows for the same `(body, target, aspect)`
 * belong to the same retrograde turnaround series on the exact same aspect branch.
 * Strictly refuses to chain opposite/mirror aspect branches or separate synodic orbits.
 */
export function areWindowsRetrogradeChained(
  body: PlanetId,
  left: { readonly endTt: number; readonly branchLon: number; readonly repLon: number | null },
  right: { readonly startTt: number; readonly branchLon: number; readonly repLon: number | null },
  uniqueStationTts: readonly number[],
): boolean {
  if (body === 'sun' || body === 'moon') return false;
  if (angularSeparation(left.branchLon, right.branchLon) >= 1.0) return false;
  if (right.startTt <= left.endTt - 1e-4) return false;
  const stationsBetween = uniqueStationTts.filter(tt => tt > left.endTt - 0.1 && tt < right.startTt + 0.1);
  if (stationsBetween.length !== 1) return false;
  if (left.repLon !== null && right.repLon !== null && angularSeparation(left.repLon, right.repLon) > 25) {
    return false;
  }
  return true;
}
