import { calculateAspects } from '../domain/aspects';
import { createDateOnlyNatalChart, PLANET_IDS } from '../domain/chart';
import type { Chart, HouseFacts, HouseId, PlanetFact, PlanetId, PlanetPosition } from '../domain/chart';
import type { EphemeraEngine, HouseSystemName, Observer, PlanetName } from '../engine/ephemera';
import type { ResolvedInstant, UnknownBirthTime } from '../time/resolve';

const signs = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio',
  'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const;

export const titleCase = <T extends string>(text: T) => (text[0].toUpperCase() + text.slice(1)) as Capitalize<T>;
export const planetName = (id: PlanetId): PlanetName => titleCase(id);
export const wrapDegrees = (value: number) => (value % 360 + 360) % 360;
export const angularDistance = (value: number, origin: number) => wrapDegrees(value - origin);

export function signPosition(longitude: number) {
  const arcMinutes = Math.floor(wrapDegrees(longitude) * 60);
  const inSign = arcMinutes % (30 * 60);
  const sign = signs[Math.floor(arcMinutes / (30 * 60))];
  return `${Math.floor(inSign / 60)}°${String(inSign % 60).padStart(2, '0')}′ ${sign}`;
}

export function orderedCusps(cusps: readonly number[]) {
  if (cusps.length !== 12 || cusps.some(cusp => !Number.isFinite(cusp) || cusp < 0 || cusp >= 360)) return false;
  const arcs = cusps.map((cusp, index) => angularDistance(cusps[(index + 1) % 12], cusp));
  return arcs.every(arc => arc > 0) && Math.abs(arcs.reduce((sum, arc) => sum + arc, 0) - 360) < 1e-7;
}

export function natalHouse(longitude: number, houses: HouseFacts | null) {
  if (!houses) return null;
  const cusps = houses.cusps;
  const index = cusps.findIndex((cusp, i) => angularDistance(longitude, cusp.longitudeDeg) <
    angularDistance(cusps[(i + 1) % 12].longitudeDeg, cusp.longitudeDeg));
  return index === -1 ? null : cusps[index].houseId;
}

export function calculatePositions(engine: EphemeraEngine, time: ResolvedInstant) {
  const warnings = new Set<'near-coverage-edge'>();
  let provenance: ReturnType<EphemeraEngine['position']>['engine'] | null = null;
  const planets = PLANET_IDS.map((planetId): PlanetFact => {
    const result = engine.position(planetName(planetId), time);
    provenance ??= result.engine;
    if (result.warnings.includes('near-coverage-edge')) warnings.add('near-coverage-edge');
    if (result.status === 'unavailable') {
      const reason = result.reason === 'no-event-returned' ? 'calculation-unavailable' : result.reason;
      return { planetId, position: { status: 'unavailable', reason } };
    }
    const { longitude, latitude, distance, longitudeSpeed, latitudeSpeed, distanceSpeed, retrograde } = result.value;
    return { planetId, position: { status: 'available', value: {
      longitudeDeg: wrapDegrees(longitude), latitudeDeg: latitude, distanceAu: distance,
      longitudeSpeedDegPerDay: longitudeSpeed, latitudeSpeedDegPerDay: latitudeSpeed,
      distanceSpeedAuPerDay: distanceSpeed, retrograde,
    } } };
  });
  return { planets, warnings: [...warnings], provenance };
}

export function calculateNatal(engine: EphemeraEngine, time: ResolvedInstant | UnknownBirthTime,
  observer: Observer | null, system: HouseSystemName): Chart {
  const base = { id: 'natal', label: null, settings: { zodiac: 'tropical' as const, requestedHouseSystem: system, observer } };
  if (time.kind === 'unknown-time') return createDateOnlyNatalChart({ ...base, time });
  const { planets, warnings } = calculatePositions(engine, time);
  const result = observer ? engine.houses(time, observer, system) : null;
  const cusps = result?.status === 'ok' ? result.value.cuspsDeg.map(wrapDegrees) : [];
  const houses: Extract<Chart, { kind: 'natal' | 'transit' }>['houses'] =
    result?.status === 'ok' && orderedCusps(cusps)
      ? { status: 'available', value: {
        cusps: cusps.map((longitudeDeg, index) => ({ houseId: (index + 1) as HouseId, longitudeDeg })),
        ascendantDeg: wrapDegrees(result.value.ascendantDeg), midheavenDeg: wrapDegrees(result.value.midheavenDeg),
        effectiveSystem: result.value.effectiveSystem, fallback: result.value.fallback,
      } }
      : { status: 'unavailable', reason: !observer ? 'missing-location'
        : result?.status === 'unavailable' && result.reason === 'outside-coverage' ? 'outside-coverage'
          : 'calculation-unavailable' };
  return { ...base, kind: 'natal', time, planets: { status: 'available', value: planets }, houses,
    warnings: result?.warnings.includes('polar-house-fallback') ? [...warnings, 'polar-house-fallback'] : warnings };
}

export function availablePositions(facts: readonly PlanetFact[]) {
  return new Map(facts.flatMap(({ planetId, position }) =>
    position.status === 'available' ? [[planetId, position.value] as const] : []));
}

export type PositionMap = ReadonlyMap<PlanetId, PlanetPosition>;

export function chartAspects(natal: PositionMap, transit?: PositionMap) {
  const points = (chartId: string, positions: PositionMap) => [...positions].map(([planetId, value]) =>
    ({ chartId, planetId, longitudeDeg: value.longitudeDeg }));
  const natalPoints = points('natal', natal);
  if (!transit) return calculateAspects(natalPoints);
  return calculateAspects([...natalPoints, ...points('transit', transit)])
    .filter(aspect => aspect.from.chartId !== aspect.to.chartId);
}
