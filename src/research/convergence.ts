import { PLANET_IDS } from '../domain/chart';
import type { PlanetId } from '../domain/chart';
import type { EventMoment } from '../domain/event';
import type { RangeAspectPass, RangeEvent } from '../search/range';
import { SECONDS_PER_DAY } from '../time/ephemeris-time';
import { solverAngleFor } from './chart-factors';
import { PERSONAL_IMPACT_BANDS, scoreResearchImpact } from './impact';
import type { ImpactWindowEvidence, PersonalImpactResult, PersonalImpactScore } from './impact';
import type { ResearchSession } from './session';

export interface ConvergenceOptions {
  /** Minimum supported Impact Score for participating contacts. */
  readonly minimumImpact?: number;
  readonly includeMoonMarkers?: boolean;
  /** Project overlap evidence from only these selected physical results. */
  readonly selectedEventIds?: ReadonlySet<string>;
}

type TimedMoment = EventMoment & { readonly jdTt: number };

export interface ConvergenceSegment {
  readonly start: TimedMoment;
  readonly end: TimedMoment;
  readonly bodies: readonly PlanetId[];
  /** Resolves against the period's contacts. */
  readonly contactKeys: readonly string[];
}

export type ConvergenceMarker = {
  readonly at: TimedMoment;
  readonly transitingBody: PlanetId;
  readonly contactKey: string;
  readonly impact: PersonalImpactScore;
} & (
  | { readonly kind: 'exact-pass'; readonly passes: readonly { readonly eventId: string; readonly pass: RangeAspectPass }[] }
  | { readonly kind: 'station'; readonly eventId: string; readonly turns: 'direct' | 'retrograde' }
  | { readonly kind: 'house-ingress'; readonly eventId: string }
);

export interface ConvergencePeriod {
  readonly start: TimedMoment;
  readonly end: TimedMoment;
  readonly observedDays: number;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  /** Completeness of the observed period, separately from each contact's series completeness. */
  readonly complete: boolean;
  readonly bodies: readonly PlanetId[];
  readonly peakConcurrentBodies: number;
  /** Includes original window and series references. */
  readonly contacts: readonly PersonalImpactScore[];
  readonly segments: readonly ConvergenceSegment[];
  readonly markers: readonly ConvergenceMarker[];
}

export interface ConvergenceCoincidence {
  readonly at: TimedMoment;
  readonly endingBody: PlanetId;
  readonly startingBody: PlanetId;
  readonly endingContacts: readonly PersonalImpactScore[];
  readonly startingContacts: readonly PersonalImpactScore[];
}

export interface ConvergenceResult {
  readonly impactModelVersion: PersonalImpactResult['modelVersion'];
  readonly minimumImpact: number;
  readonly includeMoonMarkers: boolean;
  readonly coverage: PersonalImpactResult['coverage'];
  readonly periods: readonly ConvergencePeriod[];
  readonly coincidences: readonly ConvergenceCoincidence[];
  readonly omittedWindows: readonly {
    readonly eventId: string;
    readonly contactKey: string;
    readonly reason: 'missing-boundary' | 'reversed-boundaries' | 'outside-effective-coverage' | 'zero-duration';
  }[];
}

interface SolvedInterval {
  readonly start: TimedMoment;
  readonly end: TimedMoment;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  readonly contact: PersonalImpactScore;
  readonly order: number;
}

interface Endpoint {
  readonly at: TimedMoment;
  readonly starts: SolvedInterval[];
  readonly ends: SolvedInterval[];
}

function timed(moment: EventMoment | null): moment is TimedMoment {
  return moment?.jdTt != null && Number.isFinite(moment.jdTt);
}

/** The broad query's physical scope is independent of its theme tiers and view filters. */
type QueryEvent = ImpactWindowEvidence['facts'] | Pick<Extract<RangeEvent, { kind: 'station' }>, 'kind' | 'planet'> |
  Pick<Extract<RangeEvent, { kind: 'house-ingress' }>, 'kind' | 'planet' | 'cuspHouseId'>;

function queryIncludes(event: QueryEvent, session: ResearchSession): boolean {
  const { computation } = session.query;
  const { focus, rawResult } = session;
  const body = 'transit' in event ? event.transit.planetId : event.planet.planetId;
  if (!focus.effectiveTransitingBodies.includes(body) || !rawResult.settings.bodies.includes(body)) return false;
  const strictFocus = computation.fetchScope === 'strict' && focus.hasNarrowedFocus;
  switch (event.kind) {
    case 'station': return computation.includeStations;
    case 'house-ingress':
      return computation.includeHouseIngresses &&
        (!strictFocus || !focus.activeHouses.length || focus.activeHouses.includes(event.cuspHouseId));
    case 'aspect-window':
      return !strictFocus || !focus.effectiveNatalPlanets.length || focus.effectiveNatalPlanets.includes(event.target.planetId);
    case 'angle-aspect-window':
      return computation.includeAngles && (!strictFocus || focus.activeAngles.some(angle =>
        angle === event.targetAngle ||
        (!rawResult.settings.angles.includes(angle) && solverAngleFor(angle) === event.targetAngle),
      ));
  }
}

function solvedInterval(
  window: ImpactWindowEvidence, horizon: { start: TimedMoment; end: TimedMoment },
): Omit<SolvedInterval, 'contact' | 'order'> | ConvergenceResult['omittedWindows'][number]['reason'] {
  const facts = window.facts;
  const start = facts.clippedStart ? horizon.start : facts.startsAt;
  const end = facts.clippedEnd ? horizon.end : facts.endsAt;
  if (!timed(start) || !timed(end)) return 'missing-boundary';
  if (end.jdTt < start.jdTt) return 'reversed-boundaries';
  if (end.jdTt < horizon.start.jdTt || start.jdTt > horizon.end.jdTt) return 'outside-effective-coverage';
  const clippedStart = facts.clippedStart || start.jdTt < horizon.start.jdTt;
  const clippedEnd = facts.clippedEnd || end.jdTt > horizon.end.jdTt;
  const observedStart = clippedStart ? horizon.start : start;
  const observedEnd = clippedEnd ? horizon.end : end;
  if (observedStart.jdTt === observedEnd.jdTt) return 'zero-duration';
  return { start: observedStart, end: observedEnd, clippedStart, clippedEnd };
}

function sortedBodies(bodies: ReadonlySet<PlanetId>): PlanetId[] {
  return PLANET_IDS.filter(body => bodies.has(body));
}

function windowMarkers(
  contact: PersonalImpactScore, windows: readonly ImpactWindowEvidence[], toleranceDays: number,
): ConvergenceMarker[] {
  const ordered = windows.flatMap(({ facts }) => facts.passes.flatMap(pass =>
    pass.state !== 'near-miss' && timed(pass.at) ? [{ eventId: facts.id, pass, at: pass.at }] : [],
  )).sort((a, b) => a.at.jdTt - b.at.jdTt);
  const groups: { at: TimedMoment; passes: typeof ordered }[] = [];
  for (const item of ordered) {
    const last = groups[groups.length - 1];
    // Only combine measurements from different representations of the same physical contact.
    if (last && item.at.jdTt - last.at.jdTt <= toleranceDays &&
        last.passes.every(source => source.eventId !== item.eventId)) {
      last.passes.push(item);
    } else {
      groups.push({ at: item.at, passes: [item] });
    }
  }
  return groups.map(({ at, passes }) => ({
    kind: 'exact-pass', at, transitingBody: contact.transitingBody, contactKey: contact.contactKey, impact: contact,
    passes: passes.map(({ eventId, pass }) => ({ eventId, pass })),
  }));
}

interface PeriodDraft {
  readonly segments: ConvergenceSegment[];
  readonly contacts: Map<PersonalImpactScore, number>;
  readonly bodies: Set<PlanetId>;
  readonly clippedStart: boolean;
  clippedEnd: boolean;
  peakConcurrentBodies: number;
}

function byBody(intervals: readonly SolvedInterval[]): Map<PlanetId, Set<PersonalImpactScore>> {
  const grouped = new Map<PlanetId, Set<PersonalImpactScore>>();
  for (const { contact } of intervals) {
    const body = contact.transitingBody;
    const contacts = grouped.get(body);
    if (contacts) contacts.add(contact);
    else grouped.set(body, new Set([contact]));
  }
  return grouped;
}

function sweep(intervals: readonly SolvedInterval[]) {
  const endpoints = new Map<number, Endpoint>();
  function endpoint(at: TimedMoment): Endpoint {
    const existing = endpoints.get(at.jdTt);
    if (existing) return existing;
    const created: Endpoint = { at, starts: [], ends: [] };
    endpoints.set(at.jdTt, created);
    return created;
  }
  for (const interval of intervals) {
    endpoint(interval.start).starts.push(interval);
    endpoint(interval.end).ends.push(interval);
  }

  const ordered = [...endpoints.values()].sort((a, b) => a.at.jdTt - b.at.jdTt);
  const periods: PeriodDraft[] = [];
  const coincidences: ConvergenceCoincidence[] = [];
  const active = new Set<SolvedInterval>();
  const activeBodyCounts = new Map<PlanetId, number>();
  let period: PeriodDraft | undefined;
  for (const [index, point] of ordered.entries()) {
    // At an endpoint, remove ending intervals first. Open spans never contain endpoint-only contacts.
    for (const interval of point.ends) {
      active.delete(interval);
      const body = interval.contact.transitingBody;
      const count = activeBodyCounts.get(body) ?? 0;
      if (count <= 1) activeBodyCounts.delete(body);
      else activeBodyCounts.set(body, count - 1);
    }
    if (point.ends.length && point.starts.length) {
      const ending = byBody(point.ends);
      const starting = byBody(point.starts);
      for (const [endingBody, endingContacts] of ending) {
        if (activeBodyCounts.has(endingBody) || starting.has(endingBody)) continue;
        for (const [startingBody, startingContacts] of starting) {
          if (activeBodyCounts.has(startingBody) || ending.has(startingBody)) continue;
          coincidences.push({
            at: point.at, endingBody, startingBody, endingContacts: [...endingContacts], startingContacts: [...startingContacts],
          });
        }
      }
    }
    for (const interval of point.starts) {
      active.add(interval);
      const body = interval.contact.transitingBody;
      activeBodyCounts.set(body, (activeBodyCounts.get(body) ?? 0) + 1);
    }

    const next = ordered[index + 1];
    if (!next) break;
    if (activeBodyCounts.size < 2) {
      period = undefined;
      continue;
    }
    const bodies = PLANET_IDS.filter(body => activeBodyCounts.has(body));
    const contacts = new Map([...active].map(interval => [interval.contact, interval.order] as const));
    let previous = period?.segments.at(-1);
    if (!period || !previous || previous.bodies.filter(body => activeBodyCounts.has(body)).length < 2) {
      period = {
        segments: [], contacts: new Map(), bodies: new Set(),
        clippedStart: point.starts.some(interval => interval.clippedStart),
        clippedEnd: false, peakConcurrentBodies: 0,
      };
      periods.push(period);
      previous = undefined;
    }
    const contactKeys = [...contacts].sort((a, b) => a[1] - b[1]).map(([contact]) => contact.contactKey);
    // An internal boundary between axis ends changes no physical membership.
    if (previous && previous.contactKeys.length === contactKeys.length &&
        previous.contactKeys.every((key, i) => key === contactKeys[i])) {
      period.segments[period.segments.length - 1] = { ...previous, end: next.at };
    } else {
      period.segments.push({ start: point.at, end: next.at, bodies, contactKeys });
    }
    for (const [contact, order] of contacts) period.contacts.set(contact, order);
    for (const body of bodies) period.bodies.add(body);
    period.peakConcurrentBodies = Math.max(period.peakConcurrentBodies, bodies.length);
    period.clippedEnd = next.ends.some(interval => interval.clippedEnd);
  }
  return { periods, coincidences };
}

/**
 * Derive overlapping transits and timing markers from a bound U6 result and its impact-v1 evidence.
 * Times, contact keys and source references are local research data and require privacy projection for export.
 */
export function findResearchConvergences(session: ResearchSession, options: ConvergenceOptions = {}): ConvergenceResult {
  const { minimumImpact = PERSONAL_IMPACT_BANDS.notable, includeMoonMarkers = false, selectedEventIds } = options;
  if (!Number.isFinite(minimumImpact) || minimumImpact < 0 || minimumImpact > 100) {
    throw new RangeError('Minimum impact must be between 0 and 100.');
  }
  const impact = scoreResearchImpact(session);
  const { coverage } = impact;
  const omittedWindows: ConvergenceResult['omittedWindows'][number][] = [];
  const result = { impactModelVersion: impact.modelVersion, minimumImpact, includeMoonMarkers, coverage, omittedWindows };
  const { effectiveStart: start, effectiveEnd: end } = coverage.range;
  if (coverage.status === 'unavailable' || !timed(start) || !timed(end) || end.jdTt <= start.jdTt) {
    return { ...result, periods: [], coincidences: [] };
  }
  const intervals: SolvedInterval[] = [];
  const markers: ConvergenceMarker[] = [];
  const tolerance = session.rawResult.provenance.refinementSeconds / SECONDS_PER_DAY;
  for (const [order, contact] of impact.scores.entries()) {
    if (selectedEventIds && !contact.calculatedEventIds.some(id => selectedEventIds.has(id))) continue;
    const moon = contact.transitingBody === 'moon';
    if (moon && !includeMoonMarkers) continue;
    if ('windows' in contact.evidence) {
      const windows = contact.evidence.windows.filter(window => queryIncludes(window.facts, session));
      if (!windows.length) continue;
      for (const marker of windowMarkers(contact, windows, tolerance)) markers.push(marker);
      if (moon || contact.total < minimumImpact) continue;
      for (const window of windows) {
        const observed = solvedInterval(window, { start, end });
        if (typeof observed === 'string') {
          omittedWindows.push({ eventId: window.facts.id, contactKey: contact.contactKey, reason: observed });
        } else {
          intervals.push({ ...observed, contact, order });
        }
      }
    } else {
      const { facts } = contact.evidence;
      if (!queryIncludes(facts, session) || !timed(facts.at)) continue;
      const base = { at: facts.at, transitingBody: contact.transitingBody, contactKey: contact.contactKey, impact: contact, eventId: facts.id };
      markers.push(facts.kind === 'station' ? { ...base, kind: 'station', turns: facts.turns } : { ...base, kind: 'house-ingress' });
    }
  }

  const { periods, coincidences } = sweep(intervals);
  const completeEvidence = coverage.status === 'complete' &&
    omittedWindows.every(window => window.reason !== 'missing-boundary' && window.reason !== 'reversed-boundaries');
  const orderedMarkers = markers.sort((a, b) => a.at.jdTt - b.at.jdTt);
  let markerIndex = 0;
  return {
    ...result, coincidences,
    periods: periods.map(period => {
      const from = period.segments[0].start;
      const to = period.segments[period.segments.length - 1].end;
      while (markerIndex < orderedMarkers.length && orderedMarkers[markerIndex].at.jdTt < from.jdTt) markerIndex += 1;
      let last = markerIndex;
      // A marker at a shared boundary belongs to both adjoining periods.
      while (last < orderedMarkers.length && orderedMarkers[last].at.jdTt <= to.jdTt) last += 1;
      const periodMarkers = orderedMarkers.slice(markerIndex, last);
      return {
        start: from, end: to, observedDays: to.jdTt - from.jdTt,
        clippedStart: period.clippedStart, clippedEnd: period.clippedEnd,
        complete: completeEvidence && !period.clippedStart && !period.clippedEnd,
        bodies: sortedBodies(period.bodies), peakConcurrentBodies: period.peakConcurrentBodies,
        contacts: [...period.contacts].sort((a, b) => a[1] - b[1]).map(([contact]) => contact),
        segments: period.segments, markers: periodMarkers,
      };
    }),
  };
}
