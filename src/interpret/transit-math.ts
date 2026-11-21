import { angularSeparation, MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectId } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { HouseFacts, PlanetId } from '../domain/chart';
import type { PositionMap } from '../view/chart-data';
import { wrapDegrees } from '../view/chart-data';
import type { AngleId } from './types';
import type {
  TransitBucket,
  TransitMotionState,
  TransitTargetRef,
  TransitTightness,
} from './transit-types';

const ASPECT_IDS = Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[];

/** Exact peak orb threshold in degrees. */
export const EXACT_ORB_THRESHOLD_DEG = 0.08;
/** Stationary speed threshold in degrees per day. */
export const STATIONARY_SPEED_DEG_PER_DAY = 1e-4;

/**
 * Speed-aware interpretive orb caps for transits (matching U5 Scout).
 * Wider natal-scale aspects remain inspectable on the chart table without flooding transit synthesis.
 * Sextiles are additionally capped at 4.0° for all bodies (including the Moon) so transit readings
 * remain 100% consistent across planet-to-planet aspects, angle contacts, and the chart wheel's
 * 4.0° sextile rule.
 */
export const TRANSIT_MAX_ORBS_DEG: Readonly<Record<PlanetId, number>> = Object.freeze({
  pluto: 3.0,
  neptune: 3.0,
  uranus: 3.0,
  saturn: 3.5,
  jupiter: 3.5,
  mars: 4.0,
  sun: 4.0,
  venus: 4.0,
  mercury: 4.0,
  moon: 5.0,
});

const SEXTILE_MAX_ORB_DEG = 4.0;

const PEAK_ORB_DEG: Readonly<Record<PlanetId, number>> = Object.freeze({
  pluto: 1.0,
  neptune: 1.0,
  uranus: 1.0,
  saturn: 1.0,
  jupiter: 1.0,
  mars: 1.0,
  sun: 1.0,
  venus: 1.0,
  mercury: 1.0,
  moon: 1.5,
});

const TRANSIT_TEMPO_WEIGHT: Readonly<Record<PlanetId, number>> = Object.freeze({
  pluto: 1.0,
  neptune: 1.0,
  uranus: 1.0,
  saturn: 0.95,
  jupiter: 0.95,
  mars: 0.65,
  sun: 0.45,
  venus: 0.45,
  mercury: 0.45,
  moon: 0.25,
});

const TARGET_PLANET_WEIGHT: Readonly<Record<PlanetId, number>> = Object.freeze({
  sun: 1.0,
  moon: 1.0,
  mercury: 0.85,
  venus: 0.85,
  mars: 0.85,
  jupiter: 0.70,
  saturn: 0.70,
  uranus: 0.55,
  neptune: 0.55,
  pluto: 0.55,
});

const ASPECT_WEIGHT: Readonly<Record<AspectId, number>> = Object.freeze({
  conjunction: 1.0,
  opposition: 1.0,
  square: 0.92,
  trine: 0.80,
  sextile: 0.68,
});

export function signedArc(toDeg: number, fromDeg: number): number {
  const diff = wrapDegrees(toDeg) - wrapDegrees(fromDeg);
  return diff > 180 ? diff - 360 : diff <= -180 ? diff + 360 : diff;
}

export function transitMaxOrb(planetId: PlanetId, aspect?: AspectId): number {
  const base = TRANSIT_MAX_ORBS_DEG[planetId];
  return aspect === 'sextile' ? Math.min(base, SEXTILE_MAX_ORB_DEG) : base;
}

export function transitBucket(planetId: PlanetId): TransitBucket {
  if (planetId === 'moon') return 'lunar-brief';
  if (planetId === 'jupiter' || planetId === 'saturn' || planetId === 'uranus' || planetId === 'neptune' || planetId === 'pluto') {
    return 'long-term';
  }
  return 'medium-term';
}

export function transitTightness(planetId: PlanetId, orbDeg: number, aspect?: AspectId): TransitTightness {
  const peak = PEAK_ORB_DEG[planetId];
  const max = transitMaxOrb(planetId, aspect);
  if (orbDeg <= peak * 0.5) return 'peak';
  if (orbDeg <= Math.min(peak * 1.4, max * 0.5)) return 'tight';
  return 'active';
}

/**
 * Analytical motion state for a transiting body aspecting a fixed natal longitude.
 * Uses de/dt = sign(s - A) * sign(Δ) * v_T, which naturally handles all 5 major aspects,
 * 0°/360° and 180° wraparound, and both direct (v_T > 0) and retrograde (v_T < 0) motion.
 */
export function aspectMotionState(
  transitLonDeg: number,
  transitSpeedDegPerDay: number,
  targetLonDeg: number,
  aspect: AspectId,
): TransitMotionState {
  if (!Number.isFinite(transitSpeedDegPerDay) || Math.abs(transitSpeedDegPerDay) < STATIONARY_SPEED_DEG_PER_DAY) {
    return 'stationary';
  }
  const delta = signedArc(transitLonDeg, targetLonDeg); // (-180, 180]
  const sep = Math.abs(delta); // [0, 180]
  const angle = MAJOR_ASPECT_ANGLES[aspect];
  const orb = Math.abs(sep - angle);

  if (orb <= EXACT_ORB_THRESHOLD_DEG) return 'exact';

  // For conjunction (A=0), s - A = s > 0; for opposition (A=180), s - A < 0.
  const signDelta = delta >= 0 ? 1 : -1;
  const signResidual = sep > angle ? 1 : -1;
  const dOrbDt = signResidual * signDelta * transitSpeedDegPerDay;
  return dOrbDt < 0 ? 'applying' : 'separating';
}

export function motionStateLabel(motion: TransitMotionState): string {
  switch (motion) {
    case 'exact': return 'Peak (exact)';
    case 'stationary': return 'Stationary in orb';
    case 'applying': return 'Applying';
    case 'separating': return 'Separating';
  }
}

export function scoreTransitAspect(input: {
  readonly transitId: PlanetId;
  readonly target: TransitTargetRef;
  readonly aspect: AspectId;
  readonly orbDeg: number;
  readonly motion: TransitMotionState;
  readonly chartRulerId?: PlanetId | null;
}): number {
  const maxOrb = transitMaxOrb(input.transitId, input.aspect);
  if (maxOrb <= 0 || input.orbDeg > maxOrb) return 0;
  const tempo = TRANSIT_TEMPO_WEIGHT[input.transitId];
  const targetWeight = input.target.kind === 'angle'
    ? 1.0
    : input.chartRulerId && input.target.planetId === input.chartRulerId
      ? 1.0
      : TARGET_PLANET_WEIGHT[input.target.planetId];
  const aspectWeight = ASPECT_WEIGHT[input.aspect];
  const tightness = Math.max(0, 1 - Math.pow(input.orbDeg / maxOrb, 1.3));
  const motionBonus = input.motion === 'exact' ? 0.15
    : input.motion === 'stationary' ? 0.10
      : input.motion === 'applying' ? 0.08
        : 0;
  return Number((tempo * targetWeight * aspectWeight * (0.2 + 0.8 * tightness) + motionBonus).toFixed(4));
}

export interface TransitAngleAspect {
  readonly id: string;
  readonly transitId: PlanetId;
  readonly angle: AngleId;
  readonly aspect: AspectId;
  readonly exactAngleDeg: number;
  readonly separationDeg: number;
  readonly orbDeg: number;
  readonly allowedOrbDeg: number;
}

/**
 * Pure calculation of active transiting planets aspecting natal Ascendant and Midheaven,
 * using each transiting planet's speed-aware transit orb cap.
 */
export function calculateTransitAngleAspects(
  transitPositions: PositionMap,
  houses: HouseFacts | null,
): readonly TransitAngleAspect[] {
  if (!houses || !transitPositions.size) return [];
  const angles: readonly (readonly [AngleId, number])[] = [
    ['asc', houses.ascendantDeg],
    ['mc', houses.midheavenDeg],
  ];
  const results: TransitAngleAspect[] = [];
  for (const transitId of PLANET_IDS) {
    const pos = transitPositions.get(transitId);
    if (!pos) continue;
    for (const [angle, angleLon] of angles) {
      const separationDeg = angularSeparation(pos.longitudeDeg, angleLon);
      let closest: AspectId | undefined;
      let bestOrb = Infinity;
      let bestMaxOrb = 0;
      for (const aspect of ASPECT_IDS) {
        const maxOrb = transitMaxOrb(transitId, aspect);
        const dist = Math.abs(separationDeg - MAJOR_ASPECT_ANGLES[aspect]);
        if (dist <= maxOrb && dist < bestOrb) {
          closest = aspect;
          bestOrb = dist;
          bestMaxOrb = maxOrb;
        }
      }
      if (!closest) continue;
      results.push({
        id: JSON.stringify(['transit', transitId, 'angle', angle, closest]),
        transitId,
        angle,
        aspect: closest,
        exactAngleDeg: MAJOR_ASPECT_ANGLES[closest],
        separationDeg,
        orbDeg: bestOrb,
        allowedOrbDeg: bestMaxOrb,
      });
    }
  }
  return results.sort((a, b) => a.orbDeg - b.orbDeg || a.id.localeCompare(b.id));
}

export function transitWindowKey(transitId: PlanetId, target: TransitTargetRef, aspect: AspectId): string {
  const targetPart = target.kind === 'angle' ? `angle:${target.angle}` : `planet:${target.planetId}`;
  return `${transitId}|${targetPart}|${aspect}`;
}
