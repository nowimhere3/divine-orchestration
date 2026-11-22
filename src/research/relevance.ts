import { createAspectRuleSet } from '../domain/aspects';
import type { AspectId } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { HouseId, PlanetId } from '../domain/chart';
import { signMeta } from '../knowledge';
import {
  ALL_HOUSE_IDS,
  createThemeRegistry,
  houseAreaDescriptor,
} from '../knowledge/research-themes';
import type { ResearchAngleId, ThemeRegistry } from '../knowledge/research-themes';
import { rangeRulesForBody } from '../search/range';
import type { EventMoment } from '../domain/event';
import type { RangeAngleId, RangeEvent, RangeEvent as U6ARangeEvent } from '../search/range';
import { planetName, titleCase } from '../view/chart-data';
import { houseFactorOf, natalPlanetFactorOf, projectAngleAspectAxes } from './chart-factors';
import type { AngleAspectAxisProjection, ChartFactors } from './chart-factors';
import type { ResearchQuery, ResolvedResearchFocus } from './query';

export type RelevanceTier = 'primary' | 'secondary' | 'context';
export type RelevanceCategory = 'astronomical' | 'chart-linkage' | 'symbolic-convention';

export type RelevanceReasonCode =
  | 'house-ingress-focus'
  | 'natal-occupant-contact'
  | 'house-ruler-contact'
  | 'modern-coruler-contact'
  | 'angle-axis-contact'
  | 'station-in-focus-house'
  | 'explicit-custom-target'
  | 'multi-theme-convergence'
  | 'natural-significator'
  | 'cycle-tempo-weight'
  | 'contact-precision'
  | 'angular-prominence'
  | 'broader-astronomical-context';

export interface RelevanceReasonParams {
  readonly planetId?: PlanetId;
  readonly targetPlanetId?: PlanetId;
  readonly aspect?: AspectId;
  readonly houseId?: HouseId;
  readonly fromHouse?: HouseId;
  readonly toHouse?: HouseId;
  readonly signIndex?: number;
  readonly angle?: ResearchAngleId;
  readonly oppositeAngle?: ResearchAngleId;
  readonly oppositeAspect?: AspectId;
  readonly turns?: 'direct' | 'retrograde';
  readonly themeIds?: readonly string[];
  readonly convergenceCount?: number;
  readonly exactPassCount?: number;
  readonly isRetrogradeSeries?: boolean;
  readonly tempoGroup?: 'outer' | 'social' | 'personal' | 'lunar';
  readonly isDerivedOpposite?: boolean;
}

export interface RelevanceReason {
  readonly code: RelevanceReasonCode;
  readonly category: RelevanceCategory;
  readonly points: number;
  readonly summary: string;
  readonly params: RelevanceReasonParams;
}

export interface EventRelevance {
  readonly tier: RelevanceTier;
  /** True when the event satisfies the active focus criteria (not merely broader context). */
  readonly inFocus: boolean;
  /** True when the event was explicitly filtered out by a custom inclusion/exclusion rule. */
  readonly excludedByFocus: boolean;
  /** Exact additive sum of all `reasons[i].points` (never hidden or opaque). */
  readonly rawScore: number;
  /** Display score capped at 100 (`Math.min(100, rawScore)`). */
  readonly score: number;
  readonly matchedThemeIds: readonly string[];
  readonly matchedHouses: readonly HouseId[];
  readonly matchedAngles: readonly ResearchAngleId[];
  readonly reasons: readonly RelevanceReason[];
  /** Concise human-readable explanation composed strictly from `reasons`. */
  readonly whyRelevant: string;
}

/**
 * The other end of the same physical axis contact. U6A solves DSC and IC directly whenever opposite
 * aspects have different orb allowances, so one transit crossing ASC (or MC) also appears as its dual
 * on DSC (or IC). The evaluator presents that contact once and keeps the other end's own label and
 * orb boundaries here, so no part of either window is lost.
 */
export interface AxisCompanion {
  readonly eventId: string;
  readonly angle: RangeAngleId;
  readonly aspect: AspectId;
  readonly allowedOrbDeg: number;
  readonly startsAt: EventMoment | null;
  readonly endsAt: EventMoment | null;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
}

export interface EvaluatedEvent {
  readonly event: U6ARangeEvent;
  readonly relevance: EventRelevance;
  /** Other-end angle windows folded into this event (empty unless the axis was solved from both ends). */
  readonly axisCompanions: readonly AxisCompanion[];
}

export interface EvaluatedResearchCounts {
  /** Presented events: one per physical contact, limited to the planets the query covers. */
  readonly total: number;
  /** Events in the underlying calculation, before axis merging and planet-scope filtering. */
  readonly calculatedEvents: number;
  /** DSC/IC windows folded into their ASC/MC counterpart (same physical contact). */
  readonly axisDuplicatesMerged: number;
  /** Calculated events for planets this query does not cover (a reused superset, such as Moon after unticking it). */
  readonly outsideQueryScope: number;
  readonly primary: number;
  readonly secondary: number;
  readonly broaderContext: number;
  readonly moonCount: number;
  readonly nonMoonCount: number;
  readonly multiThemeConvergences: number;
  readonly byKind: Readonly<Record<RangeEvent['kind'], number>>;
  readonly byBody: Readonly<Partial<Record<PlanetId, number>>>;
  readonly byTheme: Readonly<Record<string, number>>;
  readonly byHouse: Readonly<Partial<Record<HouseId, number>>>;
}

export interface EvaluatedResearchResult {
  readonly all: readonly EvaluatedEvent[];
  /** Every folded window, keyed by the presented host ID, including ends outside the display focus. */
  readonly calculatedAxisCompanionIds: ReadonlyMap<string, readonly string[]>;
  readonly relevant: readonly EvaluatedEvent[];
  readonly primary: readonly EvaluatedEvent[];
  readonly secondary: readonly EvaluatedEvent[];
  readonly broaderContext: readonly EvaluatedEvent[];
  readonly convergenceHighlights: readonly EvaluatedEvent[];
  readonly counts: EvaluatedResearchCounts;
}

export interface EvaluateResearchOptions {
  /**
   * Angles directly solved by U6A in the backing EventRangeSearchResult (`rawResult.settings.angles`).
   * Prevents projecting ASC/MC windows onto DSC/IC when DSC/IC were already solved directly with
   * their own exact orb boundaries.
   */
  readonly solvedAngles?: readonly RangeAngleId[];
}

const ANGLE_SHORT: Readonly<Record<ResearchAngleId, string>> = Object.freeze({
  asc: 'ASC',
  mc: 'MC',
  dsc: 'DSC',
  ic: 'IC',
});

const HOUSE_FOR_ANGLE: Readonly<Record<ResearchAngleId, HouseId>> = Object.freeze({
  asc: 1,
  ic: 4,
  dsc: 7,
  mc: 10,
});

function isAngleExcluded(
  angle: ResearchAngleId,
  query: ResearchQuery,
  focus: ResolvedResearchFocus,
): boolean {
  if (focus.excludedAngles.includes(angle)) return true;
  if (focus.excludedHouses.includes(HOUSE_FOR_ANGLE[angle]) && !query.focus.includeAngles.includes(angle)) {
    return true;
  }
  return false;
}

function queryHasTargetFocus(query: ResearchQuery, focus: ResolvedResearchFocus): boolean {
  return (
    query.mode === 'themes' ||
    query.focus.activeThemeIds.length > 0 ||
    query.focus.includeHouses.length > 0 ||
    query.focus.includeNatalPlanets.length > 0 ||
    query.focus.includeAngles.length > 0 ||
    focus.activeThemes.length > 0 ||
    focus.activeHouses.length > 0 ||
    focus.explicitNatalPlanets.length > 0 ||
    focus.activeAngles.length > 0
  );
}

/**
 * Returns valid angle projections for an `angle-aspect-window`, honoring the projected aspect's
 * actual orb policy and never duplicating angles that U6A already solved directly.
 */
function validAngleProjections(
  event: Extract<RangeEvent, { kind: 'angle-aspect-window' }>,
  query: ResearchQuery,
  solvedAngles: ReadonlySet<RangeAngleId>,
  companions: readonly AxisCompanion[] = [],
): readonly AngleAspectAxisProjection[] {
  const [direct, dual] = projectAngleAspectAxes(event.targetAngle, event.aspect);
  const projections: AngleAspectAxisProjection[] = [direct];

  // The opposite end was solved directly and folded into this event: use its own angle and aspect.
  if (companions.length > 0) {
    const seen = new Set<string>();
    for (const companion of companions) {
      const key = `${companion.angle}|${companion.aspect}`;
      if (seen.has(key)) continue;
      seen.add(key);
      projections.push({
        angle: companion.angle,
        aspect: companion.aspect,
        isDerivedOpposite: companion.angle === 'dsc' || companion.angle === 'ic',
        exactDual: true,
      });
    }
    return projections;
  }

  // If the opposite angle was already solved directly by U6A, never project onto it.
  if (solvedAngles.has(dual.angle)) {
    return projections;
  }

  // Enforce the projected aspect's actual orb allowance under the query's orb policy.
  const customRules = query.computation.customOrbsDeg
    ? createAspectRuleSet(query.computation.customOrbsDeg)
    : undefined;
  const bodyRules = rangeRulesForBody(event.transit.planetId, query.computation.orbPolicy, customRules);
  const projectedAllowedOrbDeg = bodyRules.orbsDeg[dual.aspect];

  // Reject projection if the source window's orb exceeds the projected aspect's orb allowance
  // (eliminating false in-orb classifications and oversized window boundaries).
  if (event.allowedOrbDeg > projectedAllowedOrbDeg + 1e-9) {
    return projections;
  }

  // Defense-in-depth: never project a near-miss whose residual exceeds the projected orb.
  if (
    event.passes.length > 0 &&
    event.passes.every(p => p.state === 'near-miss' && (p.residualDeg === null || p.residualDeg > projectedAllowedOrbDeg + 1e-9))
  ) {
    return projections;
  }

  projections.push(dual);
  return projections;
}

const AXIS_DUAL_ASPECT: Readonly<Record<AspectId, AspectId>> = Object.freeze({
  conjunction: 'opposition',
  opposition: 'conjunction',
  sextile: 'trine',
  trine: 'sextile',
  square: 'square',
});
const AXIS_WINDOW_EPS_DAYS = 5e-4;

type AngleWindowEvent = Extract<RangeEvent, { kind: 'angle-aspect-window' }>;

function axisWindowBounds(event: AngleWindowEvent) {
  const lo = event.clippedStart || event.startsAt?.jdTt == null ? -Infinity : event.startsAt.jdTt;
  const hi = event.clippedEnd || event.endsAt?.jdTt == null ? Infinity : event.endsAt.jdTt;
  return { lo, hi };
}

export interface AxisMergeResult {
  /** Every event except the partner windows folded into a host. */
  readonly presented: readonly RangeEvent[];
  /** Raw opposite-end windows folded into each host window (keyed by host event id). */
  readonly partners: ReadonlyMap<string, readonly Extract<RangeEvent, { kind: 'angle-aspect-window' }>[]>;
  readonly merged: number;
}

function axisCompanionOf(event: AngleWindowEvent): AxisCompanion {
  return {
    eventId: event.id,
    angle: event.targetAngle,
    aspect: event.aspect,
    allowedOrbDeg: event.allowedOrbDeg,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    clippedStart: event.clippedStart,
    clippedEnd: event.clippedEnd,
  };
}

/**
 * Folds directly solved DSC/IC windows into the ASC/MC window that describes the same sky position
 * (ASC conjunction = DSC opposition, ASC sextile = DSC trine, and so on). The window with the larger
 * orb allowance is kept as the event, so every portion of either window stays visible; the other end is
 * recorded as a companion with its own aspect label and orb boundaries. A window with no containing
 * partner is left untouched.
 */
export function mergeAxisContacts(events: readonly RangeEvent[]): AxisMergeResult {
  const direct = new Map<string, AngleWindowEvent[]>();
  const opposite = new Map<string, AngleWindowEvent[]>();
  for (const event of events) {
    if (event.kind !== 'angle-aspect-window') continue;
    const isDirect = event.targetAngle === 'asc' || event.targetAngle === 'mc';
    const axis = event.targetAngle === 'asc' || event.targetAngle === 'dsc' ? 'asc' : 'mc';
    const aspectKey = isDirect ? event.aspect : AXIS_DUAL_ASPECT[event.aspect];
    const key = `${event.transit.chartId}|${event.transit.planetId}|${event.targetChartId}|${axis}|${aspectKey}`;
    const bucket = isDirect ? direct : opposite;
    const list = bucket.get(key);
    if (list) list.push(event);
    else bucket.set(key, [event]);
  }

  const hidden = new Set<string>();
  const partnerMap = new Map<string, AngleWindowEvent[]>();
  const attach = (hostId: string, partner: AngleWindowEvent) => {
    const list = partnerMap.get(hostId);
    if (list) list.push(partner);
    else partnerMap.set(hostId, [partner]);
  };

  for (const [key, directList] of direct) {
    const oppositeList = opposite.get(key);
    if (!oppositeList) continue;
    for (const dualEvent of oppositeList) {
      // Windows of one transit/axis/aspect never overlap each other, so containment picks one partner.
      const dualBounds = axisWindowBounds(dualEvent);
      const partner = directList.find(candidate => {
        if (hidden.has(candidate.id)) return false;
        const bounds = axisWindowBounds(candidate);
        const dualInside = dualBounds.lo >= bounds.lo - AXIS_WINDOW_EPS_DAYS && dualBounds.hi <= bounds.hi + AXIS_WINDOW_EPS_DAYS;
        const directInside = bounds.lo >= dualBounds.lo - AXIS_WINDOW_EPS_DAYS && bounds.hi <= dualBounds.hi + AXIS_WINDOW_EPS_DAYS;
        return candidate.allowedOrbDeg >= dualEvent.allowedOrbDeg - 1e-9 ? dualInside : directInside;
      });
      if (!partner) continue;
      if (partner.allowedOrbDeg >= dualEvent.allowedOrbDeg - 1e-9) {
        // The ASC/MC window is at least as wide: it carries the DSC/IC end.
        hidden.add(dualEvent.id);
        attach(partner.id, dualEvent);
      } else {
        // The DSC/IC window is wider: it carries the ASC/MC end.
        hidden.add(partner.id);
        attach(dualEvent.id, partner);
      }
    }
  }

  return {
    presented: events.filter(event => !hidden.has(event.id)),
    partners: partnerMap,
    merged: hidden.size,
  };
}

/** Short note naming each end's own orb when the two ends of an axis contact allow different orbs. */
function axisOrbClause(event: AngleWindowEvent, companions: readonly AxisCompanion[]): string {
  const differing = companions.filter(c => Math.abs(c.allowedOrbDeg - event.allowedOrbDeg) > 1e-9);
  if (!differing.length) return '';
  const own = `${ANGLE_SHORT[event.targetAngle]} ${titleCase(event.aspect)} within ${event.allowedOrbDeg}°`;
  const others = [...new Set(differing.map(c => `${ANGLE_SHORT[c.angle]} ${titleCase(c.aspect)} within ${c.allowedOrbDeg}°`))];
  return ` [orb windows differ: ${own}; ${others.join('; ')}]`;
}

function transitingBodyOf(event: RangeEvent): PlanetId {
  return event.kind === 'station' || event.kind === 'house-ingress'
    ? event.planet.planetId
    : event.transit.planetId;
}

function tempoForBody(planetId: PlanetId): { readonly group: 'outer' | 'social' | 'personal' | 'lunar'; readonly points: number; readonly label: string } {
  if (planetId === 'uranus' || planetId === 'neptune' || planetId === 'pluto') {
    return { group: 'outer', points: 15, label: 'Long-term outer-planet cycle' };
  }
  if (planetId === 'jupiter' || planetId === 'saturn') {
    return { group: 'social', points: 12, label: 'Multi-month social-planet cycle' };
  }
  if (planetId === 'moon') {
    return { group: 'lunar', points: 2, label: 'Brief lunar transit' };
  }
  return { group: 'personal', points: 6, label: 'Personal-planet transit' };
}

function hasExactPass(event: Extract<RangeEvent, { kind: 'aspect-window' | 'angle-aspect-window' }>): boolean {
  return event.passes.some(pass => pass.state !== 'near-miss');
}

function contactPrecisionReason(event: RangeEvent): RelevanceReason {
  if (event.kind === 'station') {
    return {
      code: 'contact-precision',
      category: 'astronomical',
      points: 8,
      summary: `${planetName(event.planet.planetId)} stations ${event.turns} (exact turnaround)`,
      params: { planetId: event.planet.planetId, turns: event.turns },
    };
  }
  if (event.kind === 'house-ingress') {
    return {
      code: 'contact-precision',
      category: 'astronomical',
      points: 8,
      summary: `Exact cusp crossing into House ${event.toHouse}${event.retrograde ? ' (retrograde re-entry)' : ''}`,
      params: {
        planetId: event.planet.planetId,
        fromHouse: event.fromHouse,
        toHouse: event.toHouse,
      },
    };
  }
  const exact = hasExactPass(event);
  if (exact && event.series.isRetrogradeSeries) {
    return {
      code: 'contact-precision',
      category: 'astronomical',
      points: 14,
      summary: `Exact contact in multi-pass retrograde series (${event.series.exactPassCountInRange} exact ${event.series.exactPassCountInRange === 1 ? 'pass' : 'passes'} in range)`,
      params: {
        exactPassCount: event.series.exactPassCountInRange,
        isRetrogradeSeries: true,
      },
    };
  }
  if (exact) {
    return {
      code: 'contact-precision',
      category: 'astronomical',
      points: 8,
      summary: 'Exact aspect contact inside range',
      params: { exactPassCount: event.series.exactPassCountInRange, isRetrogradeSeries: false },
    };
  }
  if (event.passes.length > 0) {
    return {
      code: 'contact-precision',
      category: 'astronomical',
      points: 2,
      summary: 'Near-miss closest approach (no exact contact)',
      params: { exactPassCount: 0, isRetrogradeSeries: event.series.isRetrogradeSeries },
    };
  }
  return {
    code: 'contact-precision',
    category: 'astronomical',
    points: 1,
    summary: 'Within-orb window only (no exact pass in range)',
    params: { exactPassCount: 0, isRetrogradeSeries: event.series.isRetrogradeSeries },
  };
}

function themeNamesList(themeIds: readonly string[], registry: ThemeRegistry): string {
  return themeIds.map(id => registry.get(id)?.label ?? id).join(', ');
}

function eventPassesStructuralFilters(
  event: RangeEvent,
  query: ResearchQuery,
  focus: ResolvedResearchFocus,
  chartFactors: ChartFactors,
  hasTargetFocus: boolean,
  solvedAngles: ReadonlySet<RangeAngleId>,
  companions: readonly AxisCompanion[],
): { readonly allowed: boolean; readonly transitBody: PlanetId } {
  const transitBody = transitingBodyOf(event);
  if (!focus.activeEventKinds.includes(event.kind)) return { allowed: false, transitBody };
  if (
    focus.excludedTransitingBodies.includes(transitBody) ||
    !focus.effectiveTransitingBodies.includes(transitBody)
  ) {
    return { allowed: false, transitBody };
  }

  if (event.kind === 'aspect-window') {
    if (!focus.activeAspects.includes(event.aspect)) return { allowed: false, transitBody };
    if (focus.excludedNatalPlanets.includes(event.target.planetId)) return { allowed: false, transitBody };
    if (focus.exactOnly && !hasExactPass(event)) return { allowed: false, transitBody };
    if (!hasTargetFocus && focus.excludedHouses.length > 0) {
      const targetHouse = natalPlanetFactorOf(chartFactors, event.target.planetId)?.houseId ?? null;
      if (targetHouse !== null && focus.excludedHouses.includes(targetHouse)) {
        return { allowed: false, transitBody };
      }
    }
    return { allowed: true, transitBody };
  }

  if (event.kind === 'angle-aspect-window') {
    const projections = validAngleProjections(event, query, solvedAngles, companions);
    const anyAllowed = projections.some(
      proj => !isAngleExcluded(proj.angle, query, focus) && focus.activeAspects.includes(proj.aspect),
    );
    if (!anyAllowed) return { allowed: false, transitBody };
    if (focus.exactOnly && !hasExactPass(event)) return { allowed: false, transitBody };
    return { allowed: true, transitBody };
  }

  if (event.kind === 'house-ingress') {
    const fromExcluded = focus.excludedHouses.includes(event.fromHouse);
    const toExcluded = focus.excludedHouses.includes(event.toHouse);
    // Entering an excluded house is never an in-focus match; exiting an excluded house only
    // qualifies when entering an explicitly active focus house (never in exclusion-only mode).
    if (toExcluded || (fromExcluded && !focus.activeHouses.includes(event.toHouse))) {
      return { allowed: false, transitBody };
    }
    return { allowed: true, transitBody };
  }

  // Station
  if (event.inNatalHouse !== null && focus.excludedHouses.includes(event.inNatalHouse)) {
    return { allowed: false, transitBody };
  }
  return { allowed: true, transitBody };
}

function evaluateSingleEvent(
  event: RangeEvent,
  query: ResearchQuery,
  focus: ResolvedResearchFocus,
  chartFactors: ChartFactors,
  registry: ThemeRegistry,
  solvedAngles: ReadonlySet<RangeAngleId>,
  companions: readonly AxisCompanion[] = [],
): EvaluatedEvent {
  const hasThemeOrTargetFocus = queryHasTargetFocus(query, focus);
  const { allowed, transitBody } = eventPassesStructuralFilters(
    event,
    query,
    focus,
    chartFactors,
    hasThemeOrTargetFocus,
    solvedAngles,
    companions,
  );
  const tempo = tempoForBody(transitBody);
  const precision = contactPrecisionReason(event);

  const reasons: RelevanceReason[] = [];
  const matchedThemes = new Set<string>();
  const matchedHouses = new Set<HouseId>();
  const matchedAngles = new Set<ResearchAngleId>();

  const addHouseThemes = (houseId: HouseId) => {
    if (focus.excludedHouses.includes(houseId)) return;
    matchedHouses.add(houseId);
    for (const tid of focus.houseToThemes.get(houseId) ?? []) matchedThemes.add(tid);
  };

  // Case A: Explicit structural exclusion (Custom Search / event kind / aspect / excluded body/house)
  if (!allowed) {
    reasons.push(
      {
        code: 'broader-astronomical-context',
        category: 'astronomical',
        points: 0,
        summary: 'Outside active search filters; retained as broader astronomical context',
        params: { planetId: transitBody },
      },
      {
        code: 'cycle-tempo-weight',
        category: 'astronomical',
        points: tempo.points,
        summary: `${tempo.label} (${planetName(transitBody)})`,
        params: { planetId: transitBody, tempoGroup: tempo.group },
      },
      precision,
    );
    const rawScore = reasons.reduce((sum, r) => sum + r.points, 0);
    return Object.freeze({
      event,
      axisCompanions: companions,
      relevance: Object.freeze({
        tier: 'context',
        inFocus: false,
        excludedByFocus: true,
        rawScore,
        score: Math.min(100, rawScore),
        matchedThemeIds: Object.freeze([]),
        matchedHouses: Object.freeze([]),
        matchedAngles: Object.freeze([]),
        reasons: Object.freeze(reasons),
        whyRelevant: reasons.map(r => r.summary).join(' · '),
      }),
    });
  }

  // Case B: Broad or structural-only mode (Explore Everything, or Custom Search narrowing only
  // by aspects / event kinds / transiting bodies / exclusions without targeting specific themes/houses/planets/angles)
  if (!hasThemeOrTargetFocus) {
    if (query.mode === 'custom') {
      reasons.push({
        code: 'explicit-custom-target',
        category: 'chart-linkage',
        points: 10,
        summary: 'Matches custom search criteria',
        params: { planetId: transitBody },
      });
    }
    reasons.push(
      {
        code: 'cycle-tempo-weight',
        category: 'astronomical',
        points: tempo.points,
        summary: `${tempo.label} (${planetName(transitBody)})`,
        params: { planetId: transitBody, tempoGroup: tempo.group },
      },
      precision,
    );

    if (event.kind === 'angle-aspect-window') {
      const projections = validAngleProjections(event, query, solvedAngles, companions).filter(
        proj => !isAngleExcluded(proj.angle, query, focus) && focus.activeAspects.includes(proj.aspect),
      );
      for (const proj of projections) matchedAngles.add(proj.angle);
      if (projections.length === 2) {
        const [direct, dual] = projections;
        reasons.push({
          code: 'angular-prominence',
          category: 'chart-linkage',
          points: 15,
          summary: `Activates cardinal angle axis ${ANGLE_SHORT[direct.angle]} (${titleCase(direct.aspect)}) / ${ANGLE_SHORT[dual.angle]} (${titleCase(dual.aspect)})${axisOrbClause(event, companions)}`,
          params: {
            angle: direct.angle,
            oppositeAngle: dual.angle,
            aspect: direct.aspect,
            oppositeAspect: dual.aspect,
          },
        });
      } else if (projections.length === 1) {
        const [only] = projections;
        reasons.push({
          code: 'angular-prominence',
          category: 'chart-linkage',
          points: 15,
          summary: `Activates cardinal angle ${ANGLE_SHORT[only.angle]} (${titleCase(only.aspect)})${axisOrbClause(event, companions)}`,
          params: { angle: only.angle, aspect: only.aspect },
        });
      }
    } else if (event.kind === 'house-ingress') {
      if (!focus.excludedHouses.includes(event.toHouse)) {
        matchedHouses.add(event.toHouse);
        if (event.toHouse === 1 || event.toHouse === 4 || event.toHouse === 7 || event.toHouse === 10) {
          reasons.push({
            code: 'angular-prominence',
            category: 'chart-linkage',
            points: 12,
            summary: `Crosses into angular House ${event.toHouse} (${houseAreaDescriptor(event.toHouse).tagline})`,
            params: { houseId: event.toHouse, fromHouse: event.fromHouse, toHouse: event.toHouse },
          });
        }
      }
    } else if (event.kind === 'station' && event.inNatalHouse !== null && !focus.excludedHouses.includes(event.inNatalHouse)) {
      matchedHouses.add(event.inNatalHouse);
      if (event.inNatalHouse === 1 || event.inNatalHouse === 4 || event.inNatalHouse === 7 || event.inNatalHouse === 10) {
        reasons.push({
          code: 'angular-prominence',
          category: 'chart-linkage',
          points: 12,
          summary: `Stations inside angular House ${event.inNatalHouse} (${houseAreaDescriptor(event.inNatalHouse).tagline})`,
          params: { houseId: event.inNatalHouse, turns: event.turns },
        });
      }
    }

    const rawScore = reasons.reduce((sum, r) => sum + r.points, 0);
    const isExactOrPoint = event.kind === 'station' || event.kind === 'house-ingress' || hasExactPass(event);
    const tier: RelevanceTier =
      transitBody === 'moon'
        ? 'secondary'
        : isExactOrPoint && rawScore >= 20
          ? 'primary'
          : 'secondary';

    return Object.freeze({
      event,
      axisCompanions: companions,
      relevance: Object.freeze({
        tier,
        inFocus: true,
        excludedByFocus: false,
        rawScore,
        score: Math.min(100, rawScore),
        matchedThemeIds: Object.freeze([]),
        matchedHouses: Object.freeze(ALL_HOUSE_IDS.filter(h => matchedHouses.has(h))),
        matchedAngles: Object.freeze([...matchedAngles]),
        reasons: Object.freeze(reasons),
        whyRelevant: reasons.map(r => r.summary).join(' · '),
      }),
    });
  }

  // Case C: Focused research (Life Themes, Custom Search, or narrowed Explore Everything)
  let hasDirectLinkage = false;
  let hasSymbolicSignificatorLink = false;

  if (event.kind === 'house-ingress') {
    const activeSet = new Set(focus.activeHouses);
    const toMatches = activeSet.has(event.toHouse);
    const fromMatches = activeSet.has(event.fromHouse);
    if (toMatches || fromMatches) {
      hasDirectLinkage = true;
      const focusHouse = toMatches ? event.toHouse : event.fromHouse;
      if (toMatches) addHouseThemes(event.toHouse);
      if (fromMatches) addHouseThemes(event.fromHouse);
      const themesForHouse = [...matchedThemes];
      const themeClause = themesForHouse.length ? ` (${themeNamesList(themesForHouse, registry)})` : '';
      const directionClause = toMatches
        ? `enters House ${event.toHouse}`
        : `exits House ${event.fromHouse} into House ${event.toHouse}`;
      reasons.push({
        code: 'house-ingress-focus',
        category: 'chart-linkage',
        points: 25,
        summary: `Transiting ${planetName(transitBody)} ${directionClause}${themeClause}`,
        params: {
          planetId: transitBody,
          houseId: focusHouse,
          fromHouse: event.fromHouse,
          toHouse: event.toHouse,
          ...(themesForHouse.length ? { themeIds: Object.freeze(themesForHouse) } : {}),
        },
      });
    }
  } else if (event.kind === 'station') {
    if (event.inNatalHouse !== null && focus.activeHouses.includes(event.inNatalHouse)) {
      hasDirectLinkage = true;
      addHouseThemes(event.inNatalHouse);
      const themesForHouse = [...matchedThemes];
      const themeClause = themesForHouse.length ? ` (${themeNamesList(themesForHouse, registry)})` : '';
      reasons.push({
        code: 'station-in-focus-house',
        category: 'chart-linkage',
        points: 24,
        summary: `${planetName(transitBody)} stations ${event.turns} in House ${event.inNatalHouse}${themeClause}`,
        params: {
          planetId: transitBody,
          houseId: event.inNatalHouse,
          turns: event.turns,
          ...(themesForHouse.length ? { themeIds: Object.freeze(themesForHouse) } : {}),
        },
      });
    }
    // In stations-only mode (unknown birth time), stations match natural significators of active themes
    // or explicitly requested transiting bodies.
    if (focus.degradedMode === 'stations-only') {
      const sigThemes = focus.naturalSignificatorToThemes.get(transitBody) ?? [];
      if (sigThemes.length) {
        hasSymbolicSignificatorLink = true;
        for (const tid of sigThemes) matchedThemes.add(tid);
        reasons.push({
          code: 'natural-significator',
          category: 'symbolic-convention',
          points: 22,
          summary: `${planetName(transitBody)} is a natural symbolic significator for ${themeNamesList(sigThemes, registry)} (unknown birth time: house placement unavailable)`,
          params: { planetId: transitBody, themeIds: Object.freeze([...sigThemes]) },
        });
      } else if (query.mode === 'custom' && focus.effectiveTransitingBodies.includes(transitBody)) {
        hasDirectLinkage = true;
        reasons.push({
          code: 'explicit-custom-target',
          category: 'chart-linkage',
          points: 20,
          summary: `Matches selected transiting body ${planetName(transitBody)} station`,
          params: { planetId: transitBody, turns: event.turns },
        });
      }
    }
  } else if (event.kind === 'angle-aspect-window') {
    const projections = validAngleProjections(event, query, solvedAngles, companions);
    const activeAngleSet = new Set(focus.activeAngles);
    const matchedProjs = projections.filter(
      proj =>
        activeAngleSet.has(proj.angle) &&
        focus.activeAspects.includes(proj.aspect) &&
        !isAngleExcluded(proj.angle, query, focus),
    );
    if (matchedProjs.length > 0) {
      hasDirectLinkage = true;
      const combinedAngleThemes = new Set<string>();
      for (const proj of matchedProjs) {
        matchedAngles.add(proj.angle);
        const houseId = HOUSE_FOR_ANGLE[proj.angle];
        if (focus.activeHouses.includes(houseId)) addHouseThemes(houseId);
        for (const tid of focus.angleToThemes.get(proj.angle) ?? []) {
          matchedThemes.add(tid);
          combinedAngleThemes.add(tid);
        }
      }
      const orderedAngleThemes = query.focus.activeThemeIds.filter(id => combinedAngleThemes.has(id));
      const themeClause = orderedAngleThemes.length ? ` (${themeNamesList(orderedAngleThemes, registry)})` : '';

      // Award angle-axis-contact (+25) ONCE per physical axis contact, preserving both angle labels
      // and all applicable theme attributions when both ends of an axis are active.
      if (matchedProjs.length === 2) {
        const [primaryProj, dualProj] = matchedProjs;
        reasons.push({
          code: 'angle-axis-contact',
          category: 'chart-linkage',
          points: 25,
          summary: `Transiting ${planetName(transitBody)} ${primaryProj.aspect} Natal ${ANGLE_SHORT[primaryProj.angle]} / ${dualProj.aspect} Natal ${ANGLE_SHORT[dualProj.angle]}${themeClause}${axisOrbClause(event, companions)}`,
          params: {
            planetId: transitBody,
            angle: primaryProj.angle,
            oppositeAngle: dualProj.angle,
            aspect: primaryProj.aspect,
            oppositeAspect: dualProj.aspect,
            houseId: HOUSE_FOR_ANGLE[primaryProj.angle],
            isDerivedOpposite: false,
            ...(orderedAngleThemes.length ? { themeIds: Object.freeze(orderedAngleThemes) } : {}),
          },
        });
      } else {
        const [proj] = matchedProjs;
        const axisNote = proj.isDerivedOpposite
          ? ` (exact axis dual of ${titleCase(event.aspect)} ${ANGLE_SHORT[event.targetAngle]})`
          : '';
        reasons.push({
          code: 'angle-axis-contact',
          category: 'chart-linkage',
          points: 25,
          summary: `Transiting ${planetName(transitBody)} ${proj.aspect} Natal ${ANGLE_SHORT[proj.angle]}${axisNote}${themeClause}${axisOrbClause(event, companions)}`,
          params: {
            planetId: transitBody,
            angle: proj.angle,
            aspect: proj.aspect,
            houseId: HOUSE_FOR_ANGLE[proj.angle],
            isDerivedOpposite: proj.isDerivedOpposite,
            ...(orderedAngleThemes.length ? { themeIds: Object.freeze(orderedAngleThemes) } : {}),
          },
        });
      }
    }
  } else if (event.kind === 'aspect-window') {
    const targetId = event.target.planetId;

    // 1. Natal occupant of active house(s)
    const occHouses = focus.occupantToHouses.get(targetId) ?? [];
    for (const h of occHouses) {
      hasDirectLinkage = true;
      addHouseThemes(h);
      const themes = focus.houseToThemes.get(h) ?? [];
      const themeClause = themes.length ? ` (${themeNamesList(themes, registry)})` : '';
      reasons.push({
        code: 'natal-occupant-contact',
        category: 'chart-linkage',
        points: 25,
        summary: `Aspects Natal ${planetName(targetId)}, occupant of House ${h}${themeClause}`,
        params: {
          planetId: transitBody,
          targetPlanetId: targetId,
          aspect: event.aspect,
          houseId: h,
          ...(themes.length ? { themeIds: Object.freeze([...themes]) } : {}),
        },
      });
    }

    // 2. Traditional ruler of active house(s)
    const tradHouses = focus.traditionalRulerToHouses.get(targetId) ?? [];
    for (const h of tradHouses) {
      hasDirectLinkage = true;
      addHouseThemes(h);
      const hf = houseFactorOf(chartFactors, h);
      const cuspSign = hf ? signMeta(hf.cuspSignIndex).name : 'unknown sign';
      const themes = focus.houseToThemes.get(h) ?? [];
      const themeClause = themes.length ? ` (${themeNamesList(themes, registry)})` : '';
      reasons.push({
        code: 'house-ruler-contact',
        category: 'chart-linkage',
        points: 22,
        summary: `Aspects Natal ${planetName(targetId)}, traditional ruler of House ${h} (${cuspSign} cusp)${themeClause}`,
        params: {
          planetId: transitBody,
          targetPlanetId: targetId,
          aspect: event.aspect,
          houseId: h,
          ...(hf ? { signIndex: hf.cuspSignIndex } : {}),
          ...(themes.length ? { themeIds: Object.freeze([...themes]) } : {}),
        },
      });
    }

    // 3. Modern co-ruler of active house(s) (only when rulershipPolicy === 'traditional-plus-modern')
    const modHouses = focus.modernCoRulerToHouses.get(targetId) ?? [];
    for (const h of modHouses) {
      hasDirectLinkage = true;
      addHouseThemes(h);
      const hf = houseFactorOf(chartFactors, h);
      const cuspSign = hf ? signMeta(hf.cuspSignIndex).name : 'unknown sign';
      const themes = focus.houseToThemes.get(h) ?? [];
      const themeClause = themes.length ? ` (${themeNamesList(themes, registry)})` : '';
      reasons.push({
        code: 'modern-coruler-contact',
        category: 'symbolic-convention',
        points: 14,
        summary: `Aspects Natal ${planetName(targetId)}, modern co-ruler of House ${h} (${cuspSign} cusp)${themeClause}`,
        params: {
          planetId: transitBody,
          targetPlanetId: targetId,
          aspect: event.aspect,
          houseId: h,
          ...(hf ? { signIndex: hf.cuspSignIndex } : {}),
          ...(themes.length ? { themeIds: Object.freeze([...themes]) } : {}),
        },
      });
    }

    // 4. Explicit Custom Search natal planet target
    if (focus.explicitNatalPlanets.includes(targetId)) {
      hasDirectLinkage = true;
      reasons.push({
        code: 'explicit-custom-target',
        category: 'chart-linkage',
        points: 20,
        summary: `Matches explicitly selected Natal ${planetName(targetId)}`,
        params: { planetId: transitBody, targetPlanetId: targetId, aspect: event.aspect },
      });
    }

    // 5. Natural planetary significator (secondary symbolic convention when houses exist;
    //    elevated primary fallback when houses are unavailable).
    const targetSigThemes = focus.naturalSignificatorToThemes.get(targetId) ?? [];
    const transitSigThemes = focus.naturalSignificatorToThemes.get(transitBody) ?? [];
    const combinedSigThemes = [...new Set([...targetSigThemes, ...transitSigThemes])];
    if (combinedSigThemes.length) {
      hasSymbolicSignificatorLink = true;
      for (const tid of combinedSigThemes) matchedThemes.add(tid);
      const fallbackMode = focus.degradedMode === 'planetary-significators-only';
      const who = targetSigThemes.length && transitSigThemes.length && transitBody !== targetId
        ? `${planetName(transitBody)} & Natal ${planetName(targetId)}`
        : targetSigThemes.length
          ? `Natal ${planetName(targetId)}`
          : `Transiting ${planetName(transitBody)}`;
      reasons.push({
        code: 'natural-significator',
        category: 'symbolic-convention',
        points: fallbackMode ? 22 : 10,
        summary: fallbackMode
          ? `${who} linked by natural symbolic convention to ${themeNamesList(combinedSigThemes, registry)} (houses unavailable)`
          : `${who} carries natural symbolic resonance with ${themeNamesList(combinedSigThemes, registry)}`,
        params: {
          planetId: transitBody,
          targetPlanetId: targetId,
          themeIds: Object.freeze(combinedSigThemes),
        },
      });
    }
  }

  const inFocus = hasDirectLinkage || hasSymbolicSignificatorLink;

  // Multi-theme convergence bonus when 2+ active themes match simultaneously
  if (inFocus && matchedThemes.size >= 2) {
    const extraAreas = matchedThemes.size - 1;
    const convergencePoints = Math.min(24, extraAreas * 12);
    const orderedThemes = query.focus.activeThemeIds.filter(id => matchedThemes.has(id));
    reasons.push({
      code: 'multi-theme-convergence',
      category: 'symbolic-convention',
      points: convergencePoints,
      summary: `Multi-area convergence across ${matchedThemes.size} themes: ${themeNamesList(orderedThemes, registry)}`,
      params: {
        convergenceCount: matchedThemes.size,
        themeIds: Object.freeze(orderedThemes),
      },
    });
  }

  if (!inFocus) {
    reasons.push({
      code: 'broader-astronomical-context',
      category: 'astronomical',
      points: 0,
      summary: focus.unavailableFocus
        ? 'Requested house or angle focus is unavailable for this chart; retained as broader astronomical context'
        : 'Outside active focus areas; retained as broader astronomical context',
      params: { planetId: transitBody },
    });
  }

  reasons.push(
    {
      code: 'cycle-tempo-weight',
      category: 'astronomical',
      points: tempo.points,
      summary: `${tempo.label} (${planetName(transitBody)})`,
      params: { planetId: transitBody, tempoGroup: tempo.group },
    },
    precision,
  );

  const rawScore = reasons.reduce((sum, r) => sum + r.points, 0);
  const isExactOrPoint = event.kind === 'station' || event.kind === 'house-ingress' || hasExactPass(event);

  let tier: RelevanceTier;
  if (!inFocus) {
    tier = 'context';
  } else if (
    hasDirectLinkage &&
    isExactOrPoint &&
    (transitBody !== 'moon' || rawScore >= 40)
  ) {
    tier = 'primary';
  } else if (
    !hasDirectLinkage &&
    hasSymbolicSignificatorLink &&
    focus.degradedMode !== 'none' &&
    isExactOrPoint &&
    transitBody !== 'moon'
  ) {
    tier = 'primary';
  } else {
    tier = 'secondary';
  }

  const orderedMatchedThemes = query.focus.activeThemeIds.filter(id => matchedThemes.has(id));
  const orderedMatchedHouses = ALL_HOUSE_IDS.filter(h => matchedHouses.has(h));
  const orderedMatchedAngles = [...matchedAngles];

  return Object.freeze({
    event,
    axisCompanions: companions,
    relevance: Object.freeze({
      tier,
      inFocus,
      excludedByFocus: false,
      rawScore,
      score: Math.min(100, rawScore),
      matchedThemeIds: Object.freeze(orderedMatchedThemes),
      matchedHouses: Object.freeze(orderedMatchedHouses),
      matchedAngles: Object.freeze(orderedMatchedAngles),
      reasons: Object.freeze(reasons),
      whyRelevant: reasons.map(r => r.summary).join(' · '),
    }),
  });
}

/**
 * Evaluates every U6A RangeEvent deterministically against the resolved research focus,
 * keeping 100% of events intact (relevant + broader astronomical context) with auditable,
 * additive relevance scores and structured "Why relevant" explanations.
 */
export function evaluateResearchEvents(
  events: readonly RangeEvent[],
  query: ResearchQuery,
  focus: ResolvedResearchFocus,
  chartFactors: ChartFactors,
  registry: ThemeRegistry = createThemeRegistry(),
  options: EvaluateResearchOptions = {},
): EvaluatedResearchResult {
  const solvedAngles = new Set<RangeAngleId>(options.solvedAngles ?? []);

  // Calculation coverage: a reused superset may hold planets this query no longer covers (for example the
  // Moon after it is unticked). Those events are not part of the query's results or counts at all. Display-only
  // filters (such as "Show Moon events") are applied later and never change these counts.
  const covered = new Set<PlanetId>(query.computation.transitingBodies);
  const inScope = events.filter(event => covered.has(transitingBodyOf(event)));
  const outsideQueryScope = events.length - inScope.length;

  // One physical axis contact is presented once, however many angle ends U6A solved for it.
  const axis = mergeAxisContacts(inScope);
  const targetFocus = queryHasTargetFocus(query, focus);
  const activeAngleSet = new Set<ResearchAngleId>(focus.activeAngles);
  const endEligible = (end: AngleWindowEvent) =>
    !isAngleExcluded(end.targetAngle, query, focus) &&
    focus.activeAspects.includes(end.aspect) &&
    (!targetFocus || activeAngleSet.has(end.targetAngle));
  const companionsFor = new Map<string, readonly AxisCompanion[]>();
  const calculatedAxisCompanionIds = new Map<string, readonly string[]>();
  const presentedEvents = axis.presented.map((event): RangeEvent => {
    const partners = event.kind === 'angle-aspect-window' ? axis.partners.get(event.id) : undefined;
    if (!partners?.length || event.kind !== 'angle-aspect-window') return event;
    // Present the contact through the ends the query actually asks about, keeping the widest of them as the
    // event so no eligible portion of any window is lost. If no end is eligible the full contact stays as context.
    const ends: AngleWindowEvent[] = [event, ...partners];
    const eligible = ends.filter(endEligible);
    const pool = eligible.length ? eligible : ends;
    const isDirectEnd = (end: AngleWindowEvent) => (end.targetAngle === 'asc' || end.targetAngle === 'mc' ? 0 : 1);
    const ordered = [...pool].sort((a, b) => b.allowedOrbDeg - a.allowedOrbDeg || isDirectEnd(a) - isDirectEnd(b));
    const [host, ...rest] = ordered;
    if (rest.length) companionsFor.set(host.id, Object.freeze(rest.map(axisCompanionOf)));
    calculatedAxisCompanionIds.set(host.id, Object.freeze(ends.filter(end => end !== host).map(end => end.id)));
    return host;
  });
  const all = presentedEvents.map(event =>
    evaluateSingleEvent(event, query, focus, chartFactors, registry, solvedAngles, companionsFor.get(event.id) ?? []));
  const primary: EvaluatedEvent[] = [];
  const secondary: EvaluatedEvent[] = [];
  const broaderContext: EvaluatedEvent[] = [];
  const convergenceHighlights: EvaluatedEvent[] = [];

  const byKind: Record<RangeEvent['kind'], number> = {
    'aspect-window': 0,
    'angle-aspect-window': 0,
    'house-ingress': 0,
    station: 0,
  };
  const byBody: Partial<Record<PlanetId, number>> = {};
  const byTheme: Record<string, number> = {};
  const byHouse: Partial<Record<HouseId, number>> = {};
  let moonCount = 0;

  for (const item of all) {
    byKind[item.event.kind] += 1;
    const body = transitingBodyOf(item.event);
    byBody[body] = (byBody[body] ?? 0) + 1;
    if (body === 'moon') moonCount += 1;

    if (item.relevance.tier === 'primary') primary.push(item);
    else if (item.relevance.tier === 'secondary') secondary.push(item);
    else broaderContext.push(item);

    if (item.relevance.matchedThemeIds.length >= 2) {
      convergenceHighlights.push(item);
    }
    for (const tid of item.relevance.matchedThemeIds) {
      byTheme[tid] = (byTheme[tid] ?? 0) + 1;
    }
    for (const h of item.relevance.matchedHouses) {
      byHouse[h] = (byHouse[h] ?? 0) + 1;
    }
  }

  convergenceHighlights.sort(
    (a, b) =>
      b.relevance.matchedThemeIds.length - a.relevance.matchedThemeIds.length ||
      b.relevance.rawScore - a.relevance.rawScore ||
      a.event.id.localeCompare(b.event.id),
  );

  // Ensure deterministic planet ordering in byBody
  const orderedByBody: Partial<Record<PlanetId, number>> = {};
  for (const p of PLANET_IDS) {
    if (byBody[p] !== undefined) orderedByBody[p] = byBody[p];
  }

  return Object.freeze({
    all: Object.freeze(all),
    calculatedAxisCompanionIds,
    relevant: Object.freeze([...primary, ...secondary]),
    primary: Object.freeze(primary),
    secondary: Object.freeze(secondary),
    broaderContext: Object.freeze(broaderContext),
    convergenceHighlights: Object.freeze(convergenceHighlights),
    counts: Object.freeze({
      total: all.length,
      calculatedEvents: events.length,
      axisDuplicatesMerged: axis.merged,
      outsideQueryScope,
      primary: primary.length,
      secondary: secondary.length,
      broaderContext: broaderContext.length,
      moonCount,
      nonMoonCount: all.length - moonCount,
      multiThemeConvergences: convergenceHighlights.length,
      byKind: Object.freeze(byKind),
      byBody: Object.freeze(orderedByBody),
      byTheme: Object.freeze(byTheme),
      byHouse: Object.freeze(byHouse),
    }),
  });
}

/** Sorts evaluated events by descending relevance score, breaking ties chronologically (input order). */
export function sortByRelevance(events: readonly EvaluatedEvent[]): readonly EvaluatedEvent[] {
  return events
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.relevance.rawScore - a.item.relevance.rawScore || a.index - b.index)
    .map(entry => entry.item);
}
