import type { PlanetRef } from './chart';

export const MAJOR_ASPECT_ANGLES = Object.freeze({
  conjunction: 0, sextile: 60, square: 90, trine: 120, opposition: 180,
});
export type AspectId = keyof typeof MAJOR_ASPECT_ANGLES;

export interface AspectRuleSetV0 {
  readonly version: 0;
  readonly orbsDeg: Readonly<Record<AspectId, number>>;
}

export interface AspectFact {
  readonly id: string;
  readonly from: PlanetRef;
  readonly to: PlanetRef;
  readonly aspect: AspectId;
  readonly exactAngleDeg: number;
  readonly separationDeg: number;
  readonly orbDeg: number;
  readonly allowedOrbDeg: number;
  readonly ruleSetVersion: 0;
}

const aspectIds = Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[];

/** v0 display defaults. Each major aspect can be overridden independently. */
export function createAspectRuleSet(overrides: Partial<Record<AspectId, number>> = {}): AspectRuleSetV0 {
  const orbsDeg = { conjunction: 8, sextile: 4, square: 6, trine: 6, opposition: 8 };
  for (const aspect of aspectIds) {
    const orb = overrides[aspect];
    if (orb === undefined) continue;
    if (!Number.isFinite(orb) || orb < 0 || orb > 180) {
      throw new RangeError(`Invalid ${aspect} orb.`);
    }
    orbsDeg[aspect] = orb;
  }
  return { version: 0, orbsDeg };
}

export function angularSeparation(first: number, second: number): number {
  if (!Number.isFinite(first) || !Number.isFinite(second)) throw new RangeError('Longitudes must be finite.');
  const difference = Math.abs(first % 360 - second % 360) % 360;
  return Math.min(difference, 360 - difference);
}

function pointKey(point: PlanetRef) {
  return JSON.stringify([point.chartId, point.planetId]);
}

export function aspectFactId(first: PlanetRef, second: PlanetRef, aspect: AspectId): string {
  const [from, to] = pointKey(first) <= pointKey(second) ? [first, second] : [second, first];
  return JSON.stringify([from.chartId, from.planetId, to.chartId, to.planetId, aspect]);
}

export function calculateAspects(
  points: readonly (PlanetRef & { readonly longitudeDeg: number })[],
  ruleSet: AspectRuleSetV0 = createAspectRuleSet(),
): readonly AspectFact[] {
  if (ruleSet.version !== 0) throw new RangeError('Unsupported aspect rule set.');
  const { orbsDeg } = createAspectRuleSet(ruleSet.orbsDeg);
  if (points.some(point => !Number.isFinite(point.longitudeDeg))) throw new RangeError('Longitudes must be finite.');
  const sorted = points.map(point => ({ point, key: pointKey(point) }));
  const keys = new Set(sorted.map(({ key }) => key));
  if (keys.size !== sorted.length) throw new Error('Aspect points must be unique by chart and planet.');
  sorted.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const facts: AspectFact[] = [];
  for (const [index, { point: first }] of sorted.entries()) {
    for (const { point: second } of sorted.slice(index + 1)) {
      const separationDeg = angularSeparation(first.longitudeDeg, second.longitudeDeg);
      // When configured orbs overlap, keep the closest exact angle. The v0 order breaks a tie.
      let closest: AspectId | undefined;
      let orbDeg = Infinity;
      for (const aspect of aspectIds) {
        const distance = Math.abs(separationDeg - MAJOR_ASPECT_ANGLES[aspect]);
        if (distance <= orbsDeg[aspect] && distance < orbDeg) {
          closest = aspect;
          orbDeg = distance;
        }
      }
      if (closest === undefined) continue;
      const from = { chartId: first.chartId, planetId: first.planetId };
      const to = { chartId: second.chartId, planetId: second.planetId };
      facts.push({
        id: aspectFactId(from, to, closest),
        from, to, aspect: closest, exactAngleDeg: MAJOR_ASPECT_ANGLES[closest],
        separationDeg, orbDeg, allowedOrbDeg: orbsDeg[closest], ruleSetVersion: 0,
      });
    }
  }
  return facts;
}
