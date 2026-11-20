import { angularSeparation, MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectId } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { HouseFacts } from '../domain/chart';
import type { PositionMap } from '../view/chart-data';
import type { AngleAspectFact, AngleId } from './types';

/** Tighter interpretive orbs for natal planets aspecting the Ascendant or Midheaven. */
export const ANGLE_ASPECT_ORBS_DEG: Readonly<Record<AspectId, number>> = Object.freeze({
  conjunction: 6,
  opposition: 6,
  square: 4,
  trine: 4,
  sextile: 3,
});

const ASPECT_IDS = Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[];

/**
 * Pure calculation of major natal planetary aspects to the Ascendant and Midheaven.
 * Kept separate from SnapshotV0's PlanetId-only AspectFact array so existing schemas stay unchanged.
 */
export function calculateAngleAspects(
  positions: PositionMap,
  houses: HouseFacts | null,
  orbsDeg: Readonly<Record<AspectId, number>> = ANGLE_ASPECT_ORBS_DEG,
): readonly AngleAspectFact[] {
  if (!houses || !positions.size) return [];
  const angles: readonly (readonly [AngleId, number])[] = [
    ['asc', houses.ascendantDeg],
    ['mc', houses.midheavenDeg],
  ];
  const results: AngleAspectFact[] = [];
  for (const planetId of PLANET_IDS) {
    const pos = positions.get(planetId);
    if (!pos) continue;
    for (const [angle, angleLon] of angles) {
      const separationDeg = angularSeparation(pos.longitudeDeg, angleLon);
      let closest: AspectId | undefined;
      let bestOrb = Infinity;
      for (const aspect of ASPECT_IDS) {
        const distance = Math.abs(separationDeg - MAJOR_ASPECT_ANGLES[aspect]);
        if (distance <= orbsDeg[aspect] && distance < bestOrb) {
          closest = aspect;
          bestOrb = distance;
        }
      }
      if (!closest) continue;
      results.push({
        id: JSON.stringify(['natal', planetId, 'angle', angle, closest]),
        planetId,
        angle,
        aspect: closest,
        exactAngleDeg: MAJOR_ASPECT_ANGLES[closest],
        separationDeg,
        orbDeg: bestOrb,
        allowedOrbDeg: orbsDeg[closest],
      });
    }
  }
  return results.sort((a, b) => a.orbDeg - b.orbDeg || a.id.localeCompare(b.id));
}
