import type { AspectId } from '../domain/aspects';
import type { HouseId, PlanetId } from '../domain/chart';
import type { EventMoment } from '../domain/event';
import type { EventRangeSearchResult, RangeEvent } from '../search/range';
import { natalPlanetFactorOf } from './chart-factors';
import type { ChartFactors } from './chart-factors';
import type { ResearchSession } from './session';

export const PERSONAL_IMPACT_MODEL = 'impact-v1' as const;
export const PERSONAL_IMPACT_BANDS = Object.freeze({ notable: 65, high: 80 });

const CYCLE_POINTS: Readonly<Record<PlanetId, number>> = {
  moon: 0, sun: 7, mercury: 7, venus: 7, mars: 12,
  jupiter: 20, saturn: 20, uranus: 25, neptune: 25, pluto: 25,
};
const ASPECT_POINTS: Readonly<Record<AspectId, number>> = {
  conjunction: 15, opposition: 15, square: 13, trine: 10, sextile: 7,
};
const AXIS_ASPECT_POINTS: Readonly<Record<AspectId, number>> = {
  conjunction: 15, opposition: 15, square: 13, trine: 9, sextile: 9,
};
const ANGULAR_HOUSES: readonly HouseId[] = [1, 4, 7, 10];
const TRADITIONAL_RULERS: readonly PlanetId[] = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];

type AspectWindow = Extract<RangeEvent, { kind: 'aspect-window' | 'angle-aspect-window' }>;
type PointEvent = Exclude<RangeEvent, AspectWindow>;
type WithoutTiming<T extends RangeEvent> = T extends RangeEvent ? Omit<T, 'timing'> : never;
export type ImpactMissingData =
  | 'natal-planet-factor-unavailable'
  | 'natal-house-placement-unavailable'
  | 'traditional-angular-rulership-unavailable'
  | 'traditional-chart-ruler-unavailable'
  | 'station-natal-house-unavailable'
  | 'closest-approach-unobserved'
  | 'closest-approach-may-be-clipped'
  | 'point-time-unavailable';

interface ImpactComponent<Reason extends string> {
  readonly points: number;
  readonly possiblePoints: number;
  readonly reason: Reason;
  readonly missing: readonly ImpactMissingData[];
}

type ConnectionReason =
  | 'natal-planet' | 'natal-luminary' | 'traditional-chart-ruler'
  | 'traditional-angular-house-ruler' | 'natal-angular-house-placement'
  | 'natal-axis' | 'angular-cusp-crossing' | 'other-cusp-crossing'
  | 'station-in-angular-house' | 'station-in-other-house' | 'station-house-unavailable';
type PrecisionReason = 'exact' | 'refined' | 'near-miss' | 'unobserved' | 'resolved-point' | 'unresolved-point';

export interface ImpactWindowEvidence {
  /** Original calculated window facts, with reference-relative timing omitted. */
  readonly facts: WithoutTiming<AspectWindow>;
  readonly observedStartTt: number | null;
  readonly observedEndTt: number | null;
  readonly observedDays: number | null;
  readonly durationIsMinimum: boolean;
  /** Count for this record only. Axis partners must not be added together. */
  readonly exactPassCountInWindow: number;
}

export type ImpactEvidence =
  | {
    readonly kind: 'aspect-window' | 'angle-aspect-window';
    readonly windows: readonly ImpactWindowEvidence[];
    readonly bestPass: { readonly eventId: string; readonly passIndex: number } | null;
  }
  | {
    readonly kind: 'house-ingress' | 'station';
    readonly facts: WithoutTiming<PointEvent>;
    readonly stationResidualDegPerDay: number | null;
  };

export interface PersonalImpactScore {
  readonly modelVersion: typeof PERSONAL_IMPACT_MODEL;
  /** Local key (sorted raw event indices), stable across host changes in the same calculation. */
  readonly contactKey: string;
  readonly calculatedEventIds: readonly string[];
  readonly transitingBody: PlanetId;
  /** Supported score, rounded once after summing all four components. */
  readonly total: number;
  readonly possibleUpperBound: number;
  readonly band: 'background' | 'notable' | 'high';
  readonly components: {
    readonly natalConnection: ImpactComponent<ConnectionReason>;
    readonly planetaryCycle: ImpactComponent<PlanetId>;
    readonly precision: ImpactComponent<PrecisionReason>;
    readonly contactType: ImpactComponent<RangeEvent['kind'] | AspectId>;
  };
  readonly missingData: readonly ImpactMissingData[];
  readonly natalPlanetEvidence: {
    readonly planetId: PlanetId;
    readonly houseId: HouseId | null;
    /** Null means rulership was unavailable. An empty list with available houses is verified. */
    readonly traditionalAngularHousesRuled: readonly HouseId[] | null;
    readonly isTraditionalChartRuler: boolean | null;
  } | null;
  readonly evidence: ImpactEvidence;
}

export interface PersonalImpactResult {
  readonly modelVersion: typeof PERSONAL_IMPACT_MODEL;
  /** One entry per U6 presented physical result, ordered by first raw source index. */
  readonly scores: readonly PersonalImpactScore[];
  /** Both the current host and its actual calculated companions resolve to the same entry. */
  readonly byEventId: ReadonlyMap<string, PersonalImpactScore>;
  readonly chartAvailability: ChartFactors['availability'];
  readonly coverage: Pick<EventRangeSearchResult, 'status' | 'range' | 'warnings' | 'unavailable' | 'reason'>;
}

function component<Reason extends string>(
  reason: Reason, points: number, possiblePoints = points, missing: readonly ImpactMissingData[] = [],
): ImpactComponent<Reason> {
  return { reason, points, possiblePoints, missing };
}

function natalPlanetEvidence(event: RangeEvent, factors: ChartFactors): PersonalImpactScore['natalPlanetEvidence'] {
  if (event.kind !== 'aspect-window') return null;
  const { planetId } = event.target;
  const natal = natalPlanetFactorOf(factors, planetId);
  return {
    planetId,
    houseId: natal?.houseId ?? null,
    traditionalAngularHousesRuled: factors.houses?.filter(house =>
      house.traditionalRuler === planetId && ANGULAR_HOUSES.includes(house.houseId),
    ).map(house => house.houseId) ?? null,
    isTraditionalChartRuler: factors.chartRuler === null ? null : factors.chartRuler.traditional === planetId,
  };
}

function natalConnection(
  event: RangeEvent, factors: ChartFactors, targetEvidence: PersonalImpactScore['natalPlanetEvidence'],
): ImpactComponent<ConnectionReason> {
  if (event.kind === 'angle-aspect-window') return component('natal-axis', 40);
  if (event.kind === 'house-ingress') {
    return ANGULAR_HOUSES.includes(event.cuspHouseId)
      ? component('angular-cusp-crossing', 32) : component('other-cusp-crossing', 24);
  }
  if (event.kind === 'station') {
    if (event.inNatalHouse === null) {
      return component('station-house-unavailable', 0, 22, ['station-natal-house-unavailable']);
    }
    return ANGULAR_HOUSES.includes(event.inNatalHouse)
      ? component('station-in-angular-house', 22) : component('station-in-other-house', 14);
  }

  const target = event.target.planetId;
  const natal = natalPlanetFactorOf(factors, target);
  const missing: ImpactMissingData[] = [];
  const canRuleTraditionally = TRADITIONAL_RULERS.includes(target);
  if (natal === null) missing.push('natal-planet-factor-unavailable');
  if (natal?.houseId == null) missing.push('natal-house-placement-unavailable');
  if (canRuleTraditionally && factors.houses === null) missing.push('traditional-angular-rulership-unavailable');
  if (canRuleTraditionally && factors.chartRuler === null) missing.push('traditional-chart-ruler-unavailable');

  // The solved contact establishes the target. Each stronger connection replaces the previous one.
  let best: ImpactComponent<ConnectionReason> = component('natal-planet', 20);
  if (targetEvidence?.traditionalAngularHousesRuled?.length) {
    best = component('traditional-angular-house-ruler', 29);
  }
  if (natal?.houseId != null && ANGULAR_HOUSES.includes(natal.houseId)) {
    best = component('natal-angular-house-placement', 31);
  }
  if (target === 'sun' || target === 'moon') best = component('natal-luminary', 35);
  if (factors.chartRuler?.traditional === target) best = component('traditional-chart-ruler', 38);

  const possiblePoints = Math.max(
    best.points,
    natal?.houseId == null ? 31 : 0,
    canRuleTraditionally && factors.houses === null ? 29 : 0,
    canRuleTraditionally && factors.chartRuler === null ? 38 : 0,
  );
  return { ...best, possiblePoints, missing };
}

function isWindow(event: RangeEvent): event is AspectWindow {
  return event.kind === 'aspect-window' || event.kind === 'angle-aspect-window';
}

function tt(moment: EventMoment | null): number | null {
  return moment?.jdTt != null && Number.isFinite(moment.jdTt) ? moment.jdTt : null;
}

function windowEvidence(event: AspectWindow, range: EventRangeSearchResult['range']): ImpactWindowEvidence {
  const { timing: _timing, ...facts } = event;
  const start = event.clippedStart ? tt(range.effectiveStart) : tt(event.startsAt);
  const end = event.clippedEnd ? tt(range.effectiveEnd) : tt(event.endsAt);
  return {
    facts,
    observedStartTt: start,
    observedEndTt: end,
    observedDays: start !== null && end !== null && end >= start ? end - start : null,
    durationIsMinimum: event.clippedStart || event.clippedEnd,
    exactPassCountInWindow: event.passes.filter(pass => pass.state !== 'near-miss').length,
  };
}

function windowPrecision(windows: readonly ImpactWindowEvidence[]) {
  let best: { eventId: string; passIndex: number; points: number; reason: PrecisionReason } | null = null;
  for (const { facts } of windows) {
    const orb = facts.allowedOrbDeg;
    for (const [passIndex, pass] of facts.passes.entries()) {
      let points = 20;
      if (pass.state === 'near-miss') {
        if (pass.residualDeg === null || !Number.isFinite(pass.residualDeg) || !Number.isFinite(orb) || orb <= 0) continue;
        // Use the transit reading's curve with this calculated window's own orb.
        points *= Math.max(0, 1 - Math.pow(Math.abs(pass.residualDeg) / orb, 1.3));
      }
      const verifiedExact = pass.state !== 'near-miss';
      if (best === null || points > best.points || (verifiedExact && best.reason === 'near-miss' && points === best.points)) {
        best = { eventId: facts.id, passIndex, points, reason: pass.state };
      }
    }
  }
  const points = best?.points ?? 0;
  const missing: ImpactMissingData[] = [];
  if (best === null) missing.push('closest-approach-unobserved');
  if (points < 20 && windows.some(window => window.durationIsMinimum)) missing.push('closest-approach-may-be-clipped');
  return {
    precision: component(best?.reason ?? 'unobserved', points, missing.length ? 20 : points, missing),
    bestPass: best === null ? null : { eventId: best.eventId, passIndex: best.passIndex },
  };
}

function contactType(event: RangeEvent): ImpactComponent<RangeEvent['kind'] | AspectId> {
  switch (event.kind) {
    case 'station': return component('station', 12);
    case 'house-ingress': return component('house-ingress', 9);
    case 'aspect-window': return component(event.aspect, ASPECT_POINTS[event.aspect]);
    case 'angle-aspect-window': return component(event.aspect, AXIS_ASPECT_POINTS[event.aspect]);
  }
}

interface CalculatedRecord {
  readonly event: RangeEvent;
  readonly index: number;
}

function scoreContact(records: readonly CalculatedRecord[], session: ResearchSession): PersonalImpactScore {
  const event = records[0].event;
  const body = isWindow(event) ? event.transit.planetId : event.planet.planetId;
  const targetEvidence = natalPlanetEvidence(event, session.chartFactors);
  const natal = natalConnection(event, session.chartFactors, targetEvidence);
  let precision: ImpactComponent<PrecisionReason>;
  let evidence: ImpactEvidence;
  if (isWindow(event)) {
    const windows = records.map(({ event: source }) => {
      if (!isWindow(source)) throw new Error('A folded impact contact contains a non-window record.');
      return windowEvidence(source, session.rawResult.range);
    });
    const measured = windowPrecision(windows);
    precision = measured.precision;
    evidence = { kind: event.kind, windows, bestPass: measured.bestPass };
  } else {
    const { timing: _timing, ...facts } = event;
    precision = tt(event.at) !== null
      ? component('resolved-point', 20) : component('unresolved-point', 0, 20, ['point-time-unavailable']);
    evidence = {
      kind: event.kind,
      facts,
      stationResidualDegPerDay: event.kind === 'station' ? session.rawResult.stationResidualsDegPerDay[event.id] ?? null : null,
    };
  }
  const components = { natalConnection: natal, planetaryCycle: component(body, CYCLE_POINTS[body]), precision, contactType: contactType(event) };
  const contributions = Object.values(components);
  const total = Math.round(contributions.reduce((sum, value) => sum + value.points, 0));
  const possibleUpperBound = Math.round(contributions.reduce((sum, value) => sum + value.possiblePoints, 0));
  return {
    modelVersion: PERSONAL_IMPACT_MODEL,
    contactKey: records.map(record => record.index).join(':'),
    calculatedEventIds: records.map(record => record.event.id),
    transitingBody: body,
    total, possibleUpperBound,
    band: total >= PERSONAL_IMPACT_BANDS.high ? 'high' : total >= PERSONAL_IMPACT_BANDS.notable ? 'notable' : 'background',
    components,
    missingData: contributions.flatMap(value => value.missing),
    natalPlanetEvidence: targetEvidence,
    evidence,
  };
}

/**
 * Score the U6 evaluated pool before any view filtering, from the bound calculation only.
 * Consumers can select their own eligible hosts by ID using the existing U6 scope rules.
 * Internal contact keys and original evidence require privacy projection before export.
 */
export function scoreResearchImpact(session: ResearchSession): PersonalImpactResult {
  const raw = session.rawResult;
  const calculated = new Map(raw.events.map((event, index) => [event.id, { event, index }]));
  const byEventId = new Map<string, PersonalImpactScore>();
  const entries = session.evaluated.all.map(({ event }) => {
    const companions = session.evaluated.calculatedAxisCompanionIds.get(event.id) ?? [];
    const records = [event.id, ...companions].map(id => {
      const record = calculated.get(id);
      if (!record) throw new Error('Impact contact is missing from the bound calculation.');
      return record;
    }).sort((a, b) => a.index - b.index);
    return { index: records[0].index, score: scoreContact(records, session) };
  }).sort((a, b) => a.index - b.index);
  const scores = entries.map(({ score }) => {
    for (const id of score.calculatedEventIds) {
      if (byEventId.has(id)) throw new Error('A calculated event belongs to multiple impact contacts.');
      byEventId.set(id, score);
    }
    return score;
  });
  return {
    modelVersion: PERSONAL_IMPACT_MODEL,
    scores, byEventId,
    chartAvailability: session.chartFactors.availability,
    coverage: { status: raw.status, range: raw.range, warnings: raw.warnings, unavailable: raw.unavailable, reason: raw.reason },
  };
}
