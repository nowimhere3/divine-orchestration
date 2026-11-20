import { createAspectRuleSet, MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectId, AspectRuleSetV0 } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { PlanetId, PlanetRef } from '../domain/chart';
import type { AstrologyEvent, EventMoment, EventTiming } from '../domain/event';
import { EPHEMERA_COVERAGE_TT } from '../engine/ephemera';
import type { EngineWarning, EphemeraEngine, PlanetName } from '../engine/ephemera';
import type { SnapshotContext } from '../export/snapshot';
import { ATOMIC_OFFSETS_VERIFIED_BEFORE, utcFromTt } from '../time/atomic-offsets';
import { instantFromTt, instantFromUt, SECONDS_PER_DAY } from '../time/ephemeris-time';
import { aspectWindows, CONTACT_TOLERANCE_DEG, REFINEMENT_SECONDS, TIME_EPS, uniqueTimes } from './geometry';
import type { Sample } from './geometry';

export const MAX_SEARCH_DAYS = 366;
const STATION_TOLERANCE = 1e-7; // degrees per day
const aspectIds = Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[];
const gridDays = 4; // Even the Moon travels well under half a revolution between samples.

export interface FixedNatalPoint extends PlanetRef {
  readonly longitudeDeg: number | null;
}

export interface EventSearchRequest {
  /** Closed interval in TT, derived from the user's resolved civil inputs. */
  readonly startTt: number;
  readonly endTt: number;
  readonly referenceTt: number | null;
  readonly transitChartId: string;
  readonly bodies: readonly PlanetId[];
  readonly targets: readonly FixedNatalPoint[];
  readonly rules: AspectRuleSetV0;
}

type SearchWarning = EngineWarning | 'modeled-delta-t' | 'future-utc-assumption' | 'utc-unavailable' | 'interval-clipped';
type Unavailable = {
  readonly kind: 'natal-position' | 'transit-body';
  readonly point: PlanetRef;
  readonly reason: string;
};

export interface EventSearchResult {
  readonly status: 'complete' | 'partial' | 'unavailable';
  readonly settings: EventSearchRequest;
  readonly context: SnapshotContext['eventSearch'];
  readonly warnings: readonly SearchWarning[];
  readonly unavailable: readonly Unavailable[];
  readonly provenance: {
    readonly engine: ReturnType<EphemeraEngine['position']>['engine'] | null;
    readonly deltaTSource: 'ephemera-model';
    readonly contactToleranceDeg: number;
    readonly refinementSeconds: number;
    readonly stationToleranceDegPerDay: number;
  };
  readonly stationResidualsDegPerDay: Readonly<Record<string, number>>;
  readonly reason?: 'outside-coverage' | 'no-calculable-bodies';
}

export interface SearchProgress {
  readonly completed: number;
  readonly total: number;
}

const planetName = (body: PlanetId) => (body[0].toUpperCase() + body.slice(1)) as PlanetName;
const chartPoint = (chartId: string, planetId: PlanetId): PlanetRef => ({ chartId, planetId });
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function validate(request: EventSearchRequest) {
  if (![request.startTt, request.endTt].every(Number.isFinite) || request.endTt <= request.startTt ||
      request.endTt - request.startTt > MAX_SEARCH_DAYS + TIME_EPS ||
      (request.referenceTt !== null && !Number.isFinite(request.referenceTt))) {
    throw new RangeError(`Select a positive interval of at most ${MAX_SEARCH_DAYS} TT days.`);
  }
  if (!request.transitChartId || !request.bodies.length || request.bodies.length > PLANET_IDS.length ||
      request.bodies.some(body => !PLANET_IDS.includes(body)) || request.targets.length > PLANET_IDS.length ||
      new Set(request.bodies).size !== request.bodies.length ||
      request.targets.some(target => !PLANET_IDS.includes(target.planetId) || !target.chartId ||
        target.chartId === request.transitChartId ||
        (target.longitudeDeg !== null && (!Number.isFinite(target.longitudeDeg) || target.longitudeDeg < 0 || target.longitudeDeg >= 360))) ||
      new Set(request.targets.map(target => target.chartId)).size > 1 ||
      new Set(request.targets.map(target => target.planetId)).size !== request.targets.length) {
    throw new RangeError('Search requires unique supported transiting bodies and fixed points from one natal chart.');
  }
  if (request.rules.version !== 0) throw new RangeError('Unsupported aspect rules.');
  const rules = createAspectRuleSet(request.rules.orbsDeg);
  return {
    ...request, rules,
    bodies: PLANET_IDS.filter(body => request.bodies.includes(body)),
    targets: [...request.targets].sort((a, b) => PLANET_IDS.indexOf(a.planetId) - PLANET_IDS.indexOf(b.planetId)),
  };
}

class UnavailableCalculation extends Error {
  constructor(readonly reason: string) { super(reason); }
}

interface Station {
  readonly tt: number;
  readonly turns: 'retrograde' | 'direct';
  readonly residual: number;
}

function stationsInRange(
  engine: EphemeraEngine, body: PlanetId, start: number, end: number, sample: (tt: number) => Sample,
  addWarnings: (warnings: readonly EngineWarning[]) => void,
): readonly Station[] {
  if (body === 'sun' || body === 'moon') return [];
  const stations: Station[] = [];
  const find = (from: number, to: number) => {
    const result = engine.station(planetName(body), from, { direction: 1, maxDays: to - from });
    addWarnings(result.warnings);
    if (result.status === 'ok') return { tt: result.value.jdTt, turns: result.value.turns };
    if (result.reason !== 'no-event-returned') throw new UnavailableCalculation(result.reason);
    return null;
  };
  const add = (event: { tt: number; turns: Station['turns'] }) => {
    if (stations.some(station => Math.abs(station.tt - event.tt) <= TIME_EPS)) return;
    const residual = Math.abs(sample(event.tt).speed);
    if (residual > STATION_TOLERANCE) throw new UnavailableCalculation('station-residual-outside-tolerance');
    stations.push({ ...event, residual });
  };
  // The native solver skips a root at its seed. Probe both closed interval endpoints.
  for (const bound of [start, end]) {
    if (Math.abs(sample(bound).speed) > STATION_TOLERANCE) continue;
    const event = find(Math.max(EPHEMERA_COVERAGE_TT.start, bound - 0.001),
      Math.min(EPHEMERA_COVERAGE_TT.end, bound + 0.001));
    if (event && Math.abs(event.tt - bound) <= TIME_EPS) add({ ...event, tt: bound });
  }
  for (let cursor = start; cursor < end;) {
    const bound = Math.min(end, cursor + 32);
    const event = find(cursor, bound);
    if (event) {
      add(event);
      // Resume just past the root to avoid returning it again.
      cursor = event.tt + 0.00001;
    } else cursor = bound;
  }
  return stations.sort((a, b) => a.tt - b.tt);
}

function timing(reference: number | null, start: number, end = start): EventTiming {
  if (reference === null) return 'unknown';
  return reference < start - TIME_EPS ? 'future' : reference > end + TIME_EPS ? 'past' : 'present';
}

const stableId = (...parts: readonly (string | number)[]) => JSON.stringify(parts);
const epochKey = (tt: number) => Math.round(tt * SECONDS_PER_DAY * 100);

/** Pure worker-side search, with no browser, storage or UI dependencies. */
export function searchEvents(
  engine: EphemeraEngine, input: EventSearchRequest, report: (progress: SearchProgress) => void = () => {},
): EventSearchResult {
  const settings = validate(input);
  const start = Math.max(settings.startTt, EPHEMERA_COVERAGE_TT.start);
  const end = Math.min(settings.endTt, EPHEMERA_COVERAGE_TT.end);
  const warnings = new Set<SearchWarning>(['modeled-delta-t']);
  const unavailable: Unavailable[] = settings.targets.filter(point => point.longitudeDeg === null)
    .map(point => ({ kind: 'natal-position', point: chartPoint(point.chartId, point.planetId), reason: 'position-unavailable' }));
  const provenance: EventSearchResult['provenance'] = {
    engine: null, deltaTSource: 'ephemera-model', contactToleranceDeg: CONTACT_TOLERANCE_DEG,
    refinementSeconds: REFINEMENT_SECONDS, stationToleranceDegPerDay: STATION_TOLERANCE,
  };
  if (end <= start) return {
    status: 'unavailable', settings, provenance, context: null, unavailable,
    warnings: [...warnings], reason: 'outside-coverage', stationResidualsDegPerDay: {},
  };
  if (start !== settings.startTt || end !== settings.endTt) warnings.add('interval-clipped');
  const targets = settings.targets.filter((point): point is FixedNatalPoint & { longitudeDeg: number } => point.longitudeDeg !== null);
  const addWarnings = (values: readonly EngineWarning[]) => values.forEach(warning => warnings.add(warning));
  const modelDelta = engine.modelDeltaTSeconds;
  const at = (jdTt: number): EventMoment => {
    const utc = utcFromTt(jdTt);
    if (!utc) warnings.add('utc-unavailable');
    else if (utc.slice(0, 10) >= ATOMIC_OFFSETS_VERIFIED_BEFORE) warnings.add('future-utc-assumption');
    return { utc, jdTt, jdUt: instantFromTt(jdTt, modelDelta).jdUt };
  };
  const events: { event: AstrologyEvent; orderTt: number }[] = [];
  const stationResidualsDegPerDay: Record<string, number> = {};
  const total = settings.bodies.length * (1 + targets.length);
  let completed = 0;
  let engineInfo = provenance.engine;
  let supported = 0;
  report({ completed, total });

  for (const body of settings.bodies) {
    const transit = chartPoint(settings.transitChartId, body);
    const bodyEvents: typeof events = [];
    const samples = new Map<number, Sample>();
    const sample = (tt: number): Sample => {
      const existing = samples.get(tt);
      if (existing) return existing;
      const result = engine.position(planetName(body), instantFromTt(tt, modelDelta));
      engineInfo = result.engine;
      addWarnings(result.warnings);
      if (result.status === 'unavailable') throw new UnavailableCalculation(result.reason);
      const value = { tt, longitude: result.value.longitude, speed: result.value.longitudeSpeed };
      samples.set(tt, value);
      return value;
    };
    const seed = (longitude: number, a: number, b: number) => {
      const left = instantFromTt(a, modelDelta).jdUt;
      const right = instantFromTt(b, modelDelta).jdUt;
      if (right <= left) return null;
      const result = engine.crossing(planetName(body), longitude, left, { direction: 1, maxDays: right - left });
      addWarnings(result.warnings);
      // A native null cannot distinguish absence from a failed solve. Refine the TT bracket either way.
      return result.status === 'ok' ? instantFromUt(result.value.jdUt, modelDelta).jdTt : null;
    };
    const completionAtBodyEnd = completed + 1 + targets.length;
    try {
      sample(start);
      sample(end);
      const stations = stationsInRange(engine, body, start, end, sample, addWarnings);
      // Split at known reversals as well as the grid, so two passes on either side
      // of a station remain independently bracketed even in a single grid cell.
      const grid = Array.from({ length: Math.ceil((end - start) / gridDays) }, (_, i) => start + i * gridDays);
      const turns = stations.map(station => station.tt);
      const track = [start, ...uniqueTimes([...grid, ...turns])
        .filter(tt => tt - start > TIME_EPS && end - tt > TIME_EPS), end].map(sample);
      report({ completed: ++completed, total });
      for (const target of targets) {
        for (const aspect of aspectIds) {
          const allowedOrbDeg = settings.rules.orbsDeg[aspect];
          const windows = aspectWindows(track, turns, target.longitudeDeg, MAJOR_ASPECT_ANGLES[aspect], allowedOrbDeg, sample, seed);
          for (const window of windows) {
            const orderTt = window.start;
            const event: AstrologyEvent = {
              kind: 'aspect-window',
              id: stableId('aspect', transit.chartId, body, target.chartId, target.planetId, aspect, epochKey(orderTt)),
              timing: timing(settings.referenceTt, window.start, window.end),
              transit, target: chartPoint(target.chartId, target.planetId), aspect, allowedOrbDeg,
              startsAt: window.clippedStart ? null : at(window.start),
              endsAt: window.clippedEnd ? null : at(window.end),
              clippedStart: window.clippedStart, clippedEnd: window.clippedEnd,
              passes: window.passes.map(pass => ({
                at: at(pass.tt), state: pass.state, residualDeg: pass.residual, toleranceDeg: CONTACT_TOLERANCE_DEG,
              })),
            };
            bodyEvents.push({ event, orderTt });
          }
        }
        report({ completed: ++completed, total });
      }
      for (const station of stations) {
        const id = stableId('station', transit.chartId, body, epochKey(station.tt), station.turns);
        bodyEvents.push({ orderTt: station.tt, event: {
          kind: 'station', id, planet: transit, turns: station.turns,
          at: at(station.tt), timing: timing(settings.referenceTt, station.tt),
        } });
        stationResidualsDegPerDay[id] = station.residual;
      }
      events.push(...bodyEvents);
      supported++;
    } catch (error) {
      if (!(error instanceof UnavailableCalculation)) throw error;
      unavailable.push({ kind: 'transit-body', point: transit, reason: error.reason });
      completed = completionAtBodyEnd;
      report({ completed, total });
    }
  }

  const context = supported ? {
    start: at(start), end: at(end),
    events: events.sort((a, b) => a.orderTt - b.orderTt || order(a.event.id, b.event.id)).map(({ event }) => event),
  } : null;
  return {
    status: supported === 0 ? 'unavailable' : unavailable.length || warnings.has('interval-clipped') ? 'partial' : 'complete',
    settings, context, warnings: [...warnings].sort(), unavailable, provenance: { ...provenance, engine: engineInfo },
    stationResidualsDegPerDay, ...(supported ? {} : { reason: 'no-calculable-bodies' as const }),
  };
}
