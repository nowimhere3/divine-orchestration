import type { AspectId } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { Chart, HouseFacts, HouseId, PlanetId, Unavailable } from '../domain/chart';
import type { AngleId } from '../interpret/types';
import { ALL_HOUSE_IDS } from '../knowledge/research-themes';
import type { ResearchAngleId } from '../knowledge/research-themes';
import { signMeta } from '../knowledge';
import { angularDistance, availablePositions, natalHouse, orderedCusps, planetName, signPosition, wrapDegrees } from '../view/chart-data';

export type RulershipPolicy = 'traditional' | 'traditional-plus-modern';

export interface AngleFactor {
  readonly angle: ResearchAngleId;
  readonly label: string;
  readonly longitudeDeg: number;
  readonly signIndex: number;
  readonly signName: string;
  readonly formattedPosition: string;
  readonly houseId: HouseId;
  readonly oppositeAngle: ResearchAngleId;
  /** Underlying U6A solver angle (`asc` or `mc`) whose aspect sweep contains this angle. */
  readonly solverAngle: AngleId;
  /** True for DSC (ASC + 180°) and IC (MC + 180°). */
  readonly isDerivedOpposite: boolean;
}

export interface HouseFactor {
  readonly houseId: HouseId;
  readonly cuspLongitudeDeg: number;
  readonly cuspSignIndex: number;
  readonly cuspSignName: string;
  readonly formattedCusp: string;
  /** Zodiac signs wholly contained inside this house without falling on a cusp (possible in Placidus/Porphyry). */
  readonly interceptedSignIndices: readonly number[];
  readonly traditionalRuler: PlanetId;
  readonly modernCoRuler: PlanetId | null;
  /** Active rulers under the selected `rulershipPolicy` (deduped). */
  readonly activeRulers: readonly PlanetId[];
  /** Natal planets placed inside this house. */
  readonly occupants: readonly PlanetId[];
  /** Associated cardinal angle when applicable (H1=ASC, H4=IC, H7=DSC, H10=MC). */
  readonly axisAngle: ResearchAngleId | null;
}

export interface NatalPlanetFactor {
  readonly planetId: PlanetId;
  readonly longitudeDeg: number;
  readonly signIndex: number;
  readonly signName: string;
  readonly formattedPosition: string;
  readonly retrograde: boolean;
  readonly houseId: HouseId | null;
  readonly rulesHousesTraditional: readonly HouseId[];
  readonly rulesHousesModern: readonly HouseId[];
}

export interface ChartFactorAvailability {
  readonly natalPositionsAvailable: boolean;
  readonly natalUnavailableReason: Unavailable['reason'] | null;
  readonly housesAvailable: boolean;
  readonly housesUnavailableReason: Unavailable['reason'] | null;
  readonly effectiveHouseSystem: string | null;
  readonly polarHouseFallback: boolean;
  readonly timeStatus: Chart['time']['kind'];
}

export interface ChartFactors {
  readonly chartId: string;
  readonly rulershipPolicy: RulershipPolicy;
  readonly availability: ChartFactorAvailability;
  readonly houses: readonly HouseFactor[] | null;
  readonly angles: Readonly<Record<ResearchAngleId, AngleFactor>> | null;
  readonly chartRuler: {
    readonly traditional: PlanetId;
    readonly modernCoRuler: PlanetId | null;
    readonly ascSignIndex: number;
  } | null;
  readonly natalPlanets: readonly NatalPlanetFactor[];
  readonly sensitivityNotes: readonly string[];
}

export interface AngleAspectAxisProjection {
  readonly angle: ResearchAngleId;
  readonly aspect: AspectId;
  readonly isDerivedOpposite: boolean;
  /** True when the aspect is mathematically opposite the solver angle (`conjunction↔opposition`, `sextile↔trine`). */
  readonly exactDual: boolean;
}

const DUAL_ASPECT: Readonly<Record<AspectId, AspectId>> = Object.freeze({
  conjunction: 'opposition',
  opposition: 'conjunction',
  sextile: 'trine',
  trine: 'sextile',
  square: 'square',
});

const OPPOSITE_ANGLE: Readonly<Record<ResearchAngleId, ResearchAngleId>> = Object.freeze({
  asc: 'dsc',
  dsc: 'asc',
  mc: 'ic',
  ic: 'mc',
});

const ANGLE_LABELS: Readonly<Record<ResearchAngleId, string>> = Object.freeze({
  asc: 'Ascendant (ASC)',
  mc: 'Midheaven (MC)',
  dsc: 'Descendant (DSC)',
  ic: 'Imum Coeli (IC)',
});

const HOUSE_AXIS_ANGLE: Readonly<Partial<Record<HouseId, ResearchAngleId>>> = Object.freeze({
  1: 'asc',
  4: 'ic',
  7: 'dsc',
  10: 'mc',
});

const EPS = 1e-7;

function signIndexOf(longitudeDeg: number): number {
  return Math.floor(wrapDegrees(longitudeDeg) / 30) % 12;
}

function isValidLon(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < 360;
}

function validHousesOf(chart: Chart): HouseFacts | null {
  if (chart.houses.status !== 'available') return null;
  const h = chart.houses.value;
  if (h.cusps.length !== 12) return null;
  if (!h.cusps.every((c, idx) => c.houseId === idx + 1)) return null;
  if (!orderedCusps(h.cusps.map(c => c.longitudeDeg))) return null;
  if (!isValidLon(h.ascendantDeg) || !isValidLon(h.midheavenDeg)) return null;
  return h;
}

/**
 * Finds zodiac signs wholly contained strictly inside house `houseId` between its cusp
 * and the following house cusp. Always empty in Whole Sign; accurately detects single or
 * double interceptions in Placidus and Porphyry.
 */
export function findInterceptedSigns(houses: HouseFacts, houseId: HouseId): readonly number[] {
  const startLon = wrapDegrees(houses.cusps[houseId - 1].longitudeDeg);
  const nextLon = wrapDegrees(houses.cusps[houseId % 12].longitudeDeg);
  const span = angularDistance(nextLon, startLon);
  if (span <= 30) return Object.freeze([]);
  const intercepted: number[] = [];
  for (let s = 0; s < 12; s += 1) {
    const dStart = angularDistance(s * 30, startLon);
    if (dStart > EPS && dStart + 30 <= span + EPS) {
      intercepted.push(s);
    }
  }
  return Object.freeze(intercepted);
}

/**
 * Maps a U6A angle aspect on ASC, MC, DSC or IC to both its direct angle and exact 180°-opposite
 * axis counterpart (ASC↔DSC, MC↔IC). Callers must verify orb parity before projecting across
 * aspects whose orb limits differ (e.g. sextile vs. trine or asymmetric custom orbs).
 */
export function projectAngleAspectAxes(
  angle: ResearchAngleId,
  aspect: AspectId,
): readonly [AngleAspectAxisProjection, AngleAspectAxisProjection] {
  const opposite = OPPOSITE_ANGLE[angle];
  return [
    { angle, aspect, isDerivedOpposite: false, exactDual: false },
    { angle: opposite, aspect: DUAL_ASPECT[aspect], isDerivedOpposite: true, exactDual: true },
  ];
}

/** Maps a requested ResearchAngleId (`asc|mc|dsc|ic`) to the underlying U6A solver angle (`asc|mc`). */
export function solverAngleFor(angle: ResearchAngleId): AngleId {
  return angle === 'asc' || angle === 'dsc' ? 'asc' : 'mc';
}

function buildAngleFactor(angle: ResearchAngleId, longitudeDeg: number): AngleFactor {
  const lon = wrapDegrees(longitudeDeg);
  const signIndex = signIndexOf(lon);
  const meta = signMeta(signIndex);
  const houseId: HouseId = angle === 'asc' ? 1 : angle === 'mc' ? 10 : angle === 'dsc' ? 7 : 4;
  const oppositeAngle: ResearchAngleId =
    angle === 'asc' ? 'dsc' : angle === 'dsc' ? 'asc' : angle === 'mc' ? 'ic' : 'mc';
  const solverAngle: AngleId = angle === 'asc' || angle === 'dsc' ? 'asc' : 'mc';
  return Object.freeze({
    angle,
    label: ANGLE_LABELS[angle],
    longitudeDeg: lon,
    signIndex,
    signName: meta.name,
    formattedPosition: signPosition(lon),
    houseId,
    oppositeAngle,
    solverAngle,
    isDerivedOpposite: angle === 'dsc' || angle === 'ic',
  });
}

function collectSensitivityNotes(
  chart: Chart,
  houses: HouseFacts | null,
  positions: ReadonlyMap<PlanetId, { readonly longitudeDeg: number }>,
): readonly string[] {
  const notes: string[] = [];
  const allWarnings = new Set<string>([
    ...chart.warnings,
    ...(chart.time.kind === 'resolved' ? chart.time.warnings : []),
  ]);

  if (allWarnings.has('polar-house-fallback') || houses?.fallback) {
    notes.push('Placidus houses are undefined at this latitude; house cusps and rulers use Porphyry fallback.');
  }
  if (allWarnings.has('historical-zone-offset-uncertain')) {
    notes.push('Historical time-zone offset uncertainty applies; house cusps and angles are sensitive to offset precision.');
  }
  if (allWarnings.has('pre-utc-ut1-approximation')) {
    notes.push('Birth date predates modern UTC records; UT1 and exact house cusps are approximate.');
  }

  if (houses) {
    const ascDeg = wrapDegrees(houses.ascendantDeg) % 30;
    if (ascDeg < 2 || ascDeg > 28) {
      notes.push(`Ascendant (${signPosition(houses.ascendantDeg)}) sits within 2° of a sign boundary; small birth-time shifts can change house rulers.`);
    }
    const mcDeg = wrapDegrees(houses.midheavenDeg) % 30;
    if (mcDeg < 2 || mcDeg > 28) {
      notes.push(`Midheaven (${signPosition(houses.midheavenDeg)}) sits within 2° of a sign boundary and is sensitive to birth-time precision.`);
    }
    if (houses.effectiveSystem !== 'WholeSign') {
      const nearCusp: string[] = [];
      for (const id of PLANET_IDS) {
        const pos = positions.get(id);
        if (!pos) continue;
        const h = natalHouse(pos.longitudeDeg, houses);
        if (!h) continue;
        const nextCusp = houses.cusps[h % 12].longitudeDeg;
        const toNext = angularDistance(nextCusp, pos.longitudeDeg);
        if (toNext > 0 && toNext < 1.5) {
          nearCusp.push(`${planetName(id)} (within ${toNext.toFixed(1)}° of House ${(h % 12) + 1})`);
        }
      }
      if (nearCusp.length) {
        notes.push(
          `Under ${houses.effectiveSystem} houses, ${nearCusp.join(', ')} sit close to the next cusp and are sensitive to birth-time precision.`,
        );
      }
    }
  }

  return Object.freeze(notes);
}

/**
 * Resolves chart-specific house cusp signs, intercepted signs, traditional & modern rulers,
 * natal house occupants, and ASC/MC/DSC/IC relationships directly from the calculated chart.
 * Degrades honestly when coordinates are missing or birth time is unknown.
 */
export function resolveChartFactors(
  chart: Chart,
  options: { readonly rulershipPolicy?: RulershipPolicy } = {},
): ChartFactors {
  const rulershipPolicy: RulershipPolicy = options.rulershipPolicy ?? 'traditional';
  const rawPositions = chart.planets.status === 'available'
    ? availablePositions(chart.planets.value)
    : new Map();
  const validPositions = new Map(
    PLANET_IDS.flatMap(id => {
      const p = rawPositions.get(id);
      return p && isValidLon(p.longitudeDeg) ? [[id, p] as const] : [];
    }),
  );

  const housesFacts = validHousesOf(chart);
  const natalPositionsAvailable = validPositions.size > 0;
  const natalUnavailableReason: Unavailable['reason'] | null =
    chart.planets.status === 'unavailable'
      ? chart.planets.reason
      : natalPositionsAvailable
        ? null
        : 'calculation-unavailable';

  const housesAvailable = housesFacts !== null;
  const housesUnavailableReason: Unavailable['reason'] | null =
    housesAvailable
      ? null
      : chart.houses.status === 'unavailable'
        ? chart.houses.reason
        : 'calculation-unavailable';

  const occupantsByHouse = new Map<HouseId, PlanetId[]>(ALL_HOUSE_IDS.map(h => [h, []]));
  const planetHouseMap = new Map<PlanetId, HouseId>();
  if (housesFacts) {
    for (const planetId of PLANET_IDS) {
      const pos = validPositions.get(planetId);
      if (!pos) continue;
      const h = natalHouse(pos.longitudeDeg, housesFacts);
      if (h !== null) {
        occupantsByHouse.get(h)!.push(planetId);
        planetHouseMap.set(planetId, h);
      }
    }
  }

  const traditionalRulesByPlanet = new Map<PlanetId, HouseId[]>(PLANET_IDS.map(p => [p, []]));
  const modernRulesByPlanet = new Map<PlanetId, HouseId[]>(PLANET_IDS.map(p => [p, []]));

  let houses: readonly HouseFactor[] | null = null;
  let angles: Readonly<Record<ResearchAngleId, AngleFactor>> | null = null;
  let chartRuler: ChartFactors['chartRuler'] = null;

  if (housesFacts) {
    houses = Object.freeze(
      ALL_HOUSE_IDS.map((houseId): HouseFactor => {
        const cuspLon = wrapDegrees(housesFacts.cusps[houseId - 1].longitudeDeg);
        const cuspSignIndex = signIndexOf(cuspLon);
        const meta = signMeta(cuspSignIndex);
        const traditionalRuler = meta.traditionalRuler;
        const modernCoRuler = meta.modernRuler;
        traditionalRulesByPlanet.get(traditionalRuler)!.push(houseId);
        if (modernCoRuler) modernRulesByPlanet.get(modernCoRuler)!.push(houseId);

        const activeRulers: PlanetId[] =
          rulershipPolicy === 'traditional-plus-modern' && modernCoRuler && modernCoRuler !== traditionalRuler
            ? [traditionalRuler, modernCoRuler]
            : [traditionalRuler];

        return Object.freeze({
          houseId,
          cuspLongitudeDeg: cuspLon,
          cuspSignIndex,
          cuspSignName: meta.name,
          formattedCusp: signPosition(cuspLon),
          interceptedSignIndices: findInterceptedSigns(housesFacts, houseId),
          traditionalRuler,
          modernCoRuler,
          activeRulers: Object.freeze(activeRulers),
          occupants: Object.freeze([...occupantsByHouse.get(houseId)!]),
          axisAngle: HOUSE_AXIS_ANGLE[houseId] ?? null,
        });
      }),
    );

    const asc = buildAngleFactor('asc', housesFacts.ascendantDeg);
    const mc = buildAngleFactor('mc', housesFacts.midheavenDeg);
    const dsc = buildAngleFactor('dsc', housesFacts.ascendantDeg + 180);
    const ic = buildAngleFactor('ic', housesFacts.midheavenDeg + 180);
    angles = Object.freeze({ asc, mc, dsc, ic });

    const ascMeta = signMeta(asc.signIndex);
    chartRuler = Object.freeze({
      traditional: ascMeta.traditionalRuler,
      modernCoRuler: ascMeta.modernRuler,
      ascSignIndex: asc.signIndex,
    });
  }

  const natalPlanets: readonly NatalPlanetFactor[] = Object.freeze(
    PLANET_IDS.flatMap((planetId): NatalPlanetFactor[] => {
      const pos = validPositions.get(planetId);
      if (!pos) return [];
      const lon = wrapDegrees(pos.longitudeDeg);
      const signIndex = signIndexOf(lon);
      return [
        Object.freeze({
          planetId,
          longitudeDeg: lon,
          signIndex,
          signName: signMeta(signIndex).name,
          formattedPosition: signPosition(lon),
          retrograde: Boolean(pos.retrograde),
          houseId: planetHouseMap.get(planetId) ?? null,
          rulesHousesTraditional: Object.freeze([...traditionalRulesByPlanet.get(planetId)!]),
          rulesHousesModern: Object.freeze([...modernRulesByPlanet.get(planetId)!]),
        }),
      ];
    }),
  );

  return Object.freeze({
    chartId: chart.id,
    rulershipPolicy,
    availability: Object.freeze({
      natalPositionsAvailable,
      natalUnavailableReason,
      housesAvailable,
      housesUnavailableReason,
      effectiveHouseSystem: housesFacts?.effectiveSystem ?? null,
      polarHouseFallback: Boolean(housesFacts?.fallback),
      timeStatus: chart.time.kind,
    }),
    houses,
    angles,
    chartRuler,
    natalPlanets,
    sensitivityNotes: collectSensitivityNotes(chart, housesFacts, validPositions),
  });
}

export function houseFactorOf(factors: ChartFactors, houseId: HouseId): HouseFactor | null {
  return factors.houses ? factors.houses[houseId - 1] ?? null : null;
}

export function natalPlanetFactorOf(factors: ChartFactors, planetId: PlanetId): NatalPlanetFactor | null {
  return factors.natalPlanets.find(p => p.planetId === planetId) ?? null;
}
