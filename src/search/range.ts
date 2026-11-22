import { createAspectRuleSet, MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectId, AspectRuleSetV0 } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { HouseFacts, HouseId, PlanetId, PlanetRef } from '../domain/chart';
import type { AspectPass, AstrologyEvent, EventMoment, EventTiming } from '../domain/event';
import { EPHEMERA_COVERAGE_TT } from '../engine/ephemera';
import type { EngineWarning, EphemeraEngine, PlanetName } from '../engine/ephemera';
import { transitMaxOrb } from '../interpret/transit-math';
import type { AngleId } from '../interpret/types';
import { ATOMIC_OFFSETS_VERIFIED_BEFORE, utcFromTt } from '../time/atomic-offsets';
import { instantFromTt, instantFromUt, SECONDS_PER_DAY } from '../time/ephemeris-time';
import { natalHouse, orderedCusps } from '../view/chart-data';
import { MAX_SEARCH_DAYS, searchEvents } from './events';
import type { FixedNatalPoint } from './events';
import {
  aspectWindows,
  CONTACT_TOLERANCE_DEG,
  crossings,
  normalize,
  REFINEMENT_SECONDS,
  TIME_EPS,
  uniqueTimes,
} from './geometry';
import type { Sample } from './geometry';
import {
  areWindowsRetrogradeChained,
  areWindowsSeamAdjacent,
  deduplicateStationTts,
  exactBranchLongitude,
  isSeriesOpenAtHorizon,
  isSlowBody,
} from './series';

/** Each underlying searchEvents chunk stays strictly within MAX_SEARCH_DAYS (366 TT days). */
export const RANGE_CHUNK_DAYS = MAX_SEARCH_DAYS;
/** Maximum span for general multi-year searches (5 Gregorian years including up to 2 leap days). */
export const MAX_GENERAL_RANGE_DAYS = 1827;
/** Maximum span for slow-planet-only searches (Jupiter–Pluto; 10 Gregorian years including up to 3 leap days). */
export const MAX_SLOW_RANGE_DAYS = 3653;

const STATION_TOLERANCE = 1e-7;
const GRID_DAYS = 4;
const SEAM_DEDUPE_DAYS = 0.001;
const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86_400_000;
const ASPECT_IDS = Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[];
const DEFAULT_ANGLES: readonly AngleId[] = ['asc', 'mc'];
export type RangeAngleId = AngleId | 'dsc' | 'ic';
const VALID_ANGLES: readonly RangeAngleId[] = ['asc', 'mc', 'dsc', 'ic'];
const ALL_HOUSE_IDS: readonly HouseId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export type RangeOrbPolicy = 'transit-focused' | 'chart-v0' | 'custom';
export type RangeSearchWarning =
  | EngineWarning
  | 'modeled-delta-t'
  | 'future-utc-assumption'
  | 'utc-unavailable'
  | 'interval-clipped';

export interface RangeChunk {
  readonly index: number;
  readonly startTt: number;
  readonly endTt: number;
}

export interface RangeAspectPass extends AspectPass {
  readonly retrograde: boolean | null;
  /** 1-based pass number among exact contacts in the continuous series; null for near misses. */
  readonly passNumberInSeries: number | null;
}

export interface EventSeriesMeta {
  readonly id: string;
  readonly branchLongitudeDeg: number;
  readonly windowIndex: number;
  readonly windowCountInRange: number;
  readonly exactPassCountInRange: number;
  readonly isRetrogradeSeries: boolean;
  /** True when the series window is clipped at the start horizon or remains inside retrograde shadow. */
  readonly clippedStart: boolean;
  /** True when the series window is clipped at the end horizon or remains inside retrograde shadow. */
  readonly clippedEnd: boolean;
  /** True only when both start and end horizons are clear of clipping and retrograde return shadow. */
  readonly complete: boolean;
}

export interface RangeAspectWindowEvent {
  readonly id: string;
  readonly kind: 'aspect-window';
  readonly timing: EventTiming;
  readonly transit: PlanetRef;
  readonly target: PlanetRef;
  readonly aspect: AspectId;
  readonly startsAt: EventMoment | null;
  readonly endsAt: EventMoment | null;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  readonly passes: readonly RangeAspectPass[];
  readonly allowedOrbDeg: number;
  readonly series: EventSeriesMeta;
}

export interface AngleAspectWindowEvent {
  readonly id: string;
  readonly kind: 'angle-aspect-window';
  readonly timing: EventTiming;
  readonly transit: PlanetRef;
  readonly targetChartId: string;
  readonly targetAngle: RangeAngleId;
  readonly aspect: AspectId;
  readonly startsAt: EventMoment | null;
  readonly endsAt: EventMoment | null;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  readonly passes: readonly RangeAspectPass[];
  readonly allowedOrbDeg: number;
  readonly series: EventSeriesMeta;
}

export interface HouseIngressEvent {
  readonly id: string;
  readonly kind: 'house-ingress';
  readonly timing: EventTiming;
  readonly planet: PlanetRef;
  readonly targetChartId: string;
  readonly cuspHouseId: HouseId;
  readonly fromHouse: HouseId;
  readonly toHouse: HouseId;
  readonly at: EventMoment;
  readonly retrograde: boolean;
  readonly houseSystem: string;
}

export interface RangeStationEvent {
  readonly id: string;
  readonly kind: 'station';
  readonly timing: EventTiming;
  readonly planet: PlanetRef;
  readonly at: EventMoment;
  readonly turns: 'direct' | 'retrograde';
  readonly inNatalHouse: HouseId | null;
}

export type RangeEvent =
  | RangeAspectWindowEvent
  | AngleAspectWindowEvent
  | HouseIngressEvent
  | RangeStationEvent;

export interface EventRangeSearchRequest {
  /** Closed interval in TT, derived from the user's resolved civil inputs. */
  readonly startTt: number;
  readonly endTt: number;
  readonly referenceTt: number | null;
  readonly transitChartId: string;
  readonly bodies: readonly PlanetId[];
  readonly targets: readonly FixedNatalPoint[];
  /** Natal houses required for angle contacts and house ingress/egress events. */
  readonly houses?: HouseFacts | null;
  readonly targetChartId?: string;
  /** Search transit contacts to natal angles (true defaults to ASC & MC; array may include asc, mc, dsc, ic). */
  readonly includeAngles?: boolean | readonly RangeAngleId[];
  /** Search transit ingress/egress events across natal house cusps when natal houses are available. */
  readonly includeHouseIngresses?: boolean;
  /** Subset of natal houses (1..12) to monitor for ingress/egress; defaults to all 12. */
  readonly targetHouses?: readonly HouseId[];
  /** Orb policy for aspect windows. Defaults to 'transit-focused'. */
  readonly orbPolicy?: RangeOrbPolicy;
  /** Custom aspect rules used when orbPolicy is 'custom'. */
  readonly rules?: AspectRuleSetV0;
  /** Optional chunk length override (must be > 0 and <= MAX_SEARCH_DAYS). */
  readonly chunkDays?: number;
}

export type RangeUnavailable =
  | { readonly kind: 'natal-position'; readonly point: PlanetRef; readonly reason: string }
  | { readonly kind: 'transit-body'; readonly point: PlanetRef; readonly reason: string }
  | { readonly kind: 'houses'; readonly reason: 'houses-unavailable' };

export interface RangeCoverageMeta {
  readonly requestedStart: EventMoment;
  readonly requestedEnd: EventMoment;
  readonly effectiveStart: EventMoment;
  readonly effectiveEnd: EventMoment;
  readonly requestedDays: number;
  readonly effectiveDays: number;
  readonly chunkCount: number;
  readonly chunkDays: number;
  readonly clippedToCoverage: boolean;
  readonly slowBodiesOnly: boolean;
  readonly maxAllowedDays: number;
}

export interface RangeSearchProgress {
  readonly completed: number;
  readonly total: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
}

export interface EventRangeSearchResult {
  readonly status: 'complete' | 'partial' | 'unavailable';
  readonly settings: {
    readonly startTt: number;
    readonly endTt: number;
    readonly referenceTt: number | null;
    readonly transitChartId: string;
    readonly targetChartId: string;
    readonly bodies: readonly PlanetId[];
    readonly targets: readonly FixedNatalPoint[];
    readonly angles: readonly RangeAngleId[];
    readonly includeHouseIngresses: boolean;
    readonly targetHouses: readonly HouseId[];
    readonly orbPolicy: RangeOrbPolicy;
    readonly chunkDays: number;
  };
  readonly range: RangeCoverageMeta;
  readonly events: readonly RangeEvent[];
  readonly warnings: readonly RangeSearchWarning[];
  readonly unavailable: readonly RangeUnavailable[];
  readonly provenance: {
    readonly engine: ReturnType<EphemeraEngine['position']>['engine'] | null;
    readonly deltaTSource: 'ephemera-model';
    readonly contactToleranceDeg: number;
    readonly refinementSeconds: number;
    readonly stationToleranceDegPerDay: number;
    readonly orbPolicy: RangeOrbPolicy;
  };
  readonly stationResidualsDegPerDay: Readonly<Record<string, number>>;
  readonly reason?: 'outside-coverage' | 'no-calculable-bodies';
}

const planetName = (body: PlanetId) => (body[0].toUpperCase() + body.slice(1)) as PlanetName;
const chartPoint = (chartId: string, planetId: PlanetId): PlanetRef => ({ chartId, planetId });
const orderText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const stableId = (...parts: readonly (string | number)[]) => JSON.stringify(parts);
const epochKey = (tt: number) => Math.round(tt * SECONDS_PER_DAY * 100);

function timingFor(reference: number | null, start: number, end = start): EventTiming {
  if (reference === null) return 'unknown';
  return reference < start - TIME_EPS ? 'future' : reference > end + TIME_EPS ? 'past' : 'present';
}

/**
 * Splits `[startTt, endTt]` into contiguous chunks of at most `chunkDays` TT days.
 * Computes chunk count directly from actual interval length (including leap days)
 * and never silently omits a final partial chunk.
 */
export function computeRangeChunks(
  startTt: number,
  endTt: number,
  chunkDays = RANGE_CHUNK_DAYS,
): readonly RangeChunk[] {
  if (!Number.isFinite(startTt) || !Number.isFinite(endTt) || endTt <= startTt ||
      !Number.isFinite(chunkDays) || chunkDays <= 0 || chunkDays > MAX_SEARCH_DAYS + TIME_EPS) {
    throw new RangeError(`Range chunking requires a positive interval and chunk size up to ${MAX_SEARCH_DAYS} TT days.`);
  }
  const chunks: RangeChunk[] = [];
  let cursor = startTt;
  let index = 0;
  while (cursor < endTt - TIME_EPS) {
    const remaining = endTt - cursor;
    const next = remaining <= chunkDays + TIME_EPS ? endTt : cursor + chunkDays;
    chunks.push({ index, startTt: cursor, endTt: next });
    cursor = next;
    index += 1;
  }
  if (!chunks.length) {
    chunks.push({ index: 0, startTt, endTt });
  }
  return chunks;
}

export function rangeRulesForBody(
  body: PlanetId,
  orbPolicy: RangeOrbPolicy,
  customRules?: AspectRuleSetV0,
): AspectRuleSetV0 {
  if (orbPolicy === 'chart-v0') return createAspectRuleSet();
  if (orbPolicy === 'custom') return createAspectRuleSet(customRules?.orbsDeg);
  return createAspectRuleSet({
    conjunction: transitMaxOrb(body, 'conjunction'),
    sextile: transitMaxOrb(body, 'sextile'),
    square: transitMaxOrb(body, 'square'),
    trine: transitMaxOrb(body, 'trine'),
    opposition: transitMaxOrb(body, 'opposition'),
  });
}

function isValidHouses(houses: HouseFacts | null | undefined): houses is HouseFacts {
  if (!houses) return false;
  const isLon = (v: number) => Number.isFinite(v) && v >= 0 && v < 360;
  return houses.cusps.length === 12
    && houses.cusps.every((c, idx) => c.houseId === idx + 1)
    && orderedCusps(houses.cusps.map(c => c.longitudeDeg))
    && isLon(houses.ascendantDeg)
    && isLon(houses.midheavenDeg);
}

/**
 * Recovers the civil day number (UTC JD when a tabulated/extrapolated UTC offset exists,
 * or modeled UT1 JD in the pre-UTC era) matching resolveBirthTime()'s time-conversion contract.
 * Keeps 5-year (1,827 civil day) and 10-year (3,653 civil day) calendar spans valid across
 * leap seconds and positive historical Delta-T growth without weakening overlong-range rejection.
 */
function civilJdFromTt(jdTt: number, modelDeltaTSeconds: (year: number) => number): number | null {
  const utc = utcFromTt(jdTt);
  if (utc !== null) {
    const isLeap = /:60(?:\.\d{1,3})?Z$/.test(utc);
    const normalized = isLeap ? utc.replace(/:60(?=(?:\.\d{1,3})?Z$)/, ':59') : utc;
    const ms = Date.parse(normalized);
    if (Number.isFinite(ms)) {
      return UNIX_EPOCH_JD + ms / MS_PER_DAY + (isLeap ? 1 / SECONDS_PER_DAY : 0);
    }
  }
  try {
    const ut = instantFromTt(jdTt, modelDeltaTSeconds).jdUt;
    return Number.isFinite(ut) ? ut : null;
  } catch {
    return null;
  }
}

function validateRangeRequest(
  input: EventRangeSearchRequest,
  modelDeltaTSeconds: (year: number) => number,
) {
  if (![input.startTt, input.endTt].every(Number.isFinite) || input.endTt <= input.startTt ||
      (input.referenceTt !== null && !Number.isFinite(input.referenceTt))) {
    throw new RangeError('Select a positive finite range interval.');
  }
  if (!input.transitChartId || !input.bodies.length || input.bodies.length > PLANET_IDS.length ||
      input.bodies.some(body => !PLANET_IDS.includes(body)) ||
      new Set(input.bodies).size !== input.bodies.length) {
    throw new RangeError('Range search requires unique supported transiting bodies.');
  }
  if (input.targets.length > PLANET_IDS.length ||
      input.targets.some(t => !PLANET_IDS.includes(t.planetId) || !t.chartId ||
        t.chartId === input.transitChartId ||
        (t.longitudeDeg !== null && (!Number.isFinite(t.longitudeDeg) || t.longitudeDeg < 0 || t.longitudeDeg >= 360))) ||
      new Set(input.targets.map(t => t.chartId)).size > 1 ||
      new Set(input.targets.map(t => t.planetId)).size !== input.targets.length) {
    throw new RangeError('Range search requires unique fixed points from one natal chart.');
  }

  const bodies = PLANET_IDS.filter(body => input.bodies.includes(body));
  const slowBodiesOnly = bodies.every(isSlowBody);
  const maxAllowedDays = slowBodiesOnly ? MAX_SLOW_RANGE_DAYS : MAX_GENERAL_RANGE_DAYS;
  const spanDays = input.endTt - input.startTt;
  if (spanDays > maxAllowedDays + TIME_EPS) {
    const civilStart = civilJdFromTt(input.startTt, modelDeltaTSeconds);
    const civilEnd = civilJdFromTt(input.endTt, modelDeltaTSeconds);
    const civilSpanDays = civilStart !== null && civilEnd !== null ? civilEnd - civilStart : null;
    if (civilSpanDays === null || civilSpanDays > maxAllowedDays + TIME_EPS) {
      throw new RangeError(
        slowBodiesOnly
          ? `Slow-planet range search supports at most ${MAX_SLOW_RANGE_DAYS} days (10 years).`
          : `General range search supports at most ${MAX_GENERAL_RANGE_DAYS} days (5 years). Restrict to Jupiter–Pluto for up to 10 years.`,
      );
    }
  }

  const chunkDays = input.chunkDays ?? RANGE_CHUNK_DAYS;
  if (!Number.isFinite(chunkDays) || chunkDays <= 0 || chunkDays > MAX_SEARCH_DAYS + TIME_EPS) {
    throw new RangeError(`Chunk size must be positive and at most ${MAX_SEARCH_DAYS} TT days.`);
  }

  const orbPolicy: RangeOrbPolicy = input.orbPolicy ?? 'transit-focused';
  if (orbPolicy !== 'transit-focused' && orbPolicy !== 'chart-v0' && orbPolicy !== 'custom') {
    throw new RangeError('Unsupported orb policy.');
  }
  const customRules = orbPolicy === 'custom'
    ? createAspectRuleSet(input.rules?.orbsDeg)
    : input.rules ? createAspectRuleSet(input.rules.orbsDeg) : undefined;

  let angles: RangeAngleId[] = [];
  if (input.includeAngles === true) {
    angles = [...DEFAULT_ANGLES];
  } else if (Array.isArray(input.includeAngles)) {
    if (input.includeAngles.some(a => !VALID_ANGLES.includes(a)) ||
        new Set(input.includeAngles).size !== input.includeAngles.length) {
      throw new RangeError('Angle targets must be unique supported angles (asc, mc, dsc, ic).');
    }
    angles = VALID_ANGLES.filter(a => (input.includeAngles as readonly RangeAngleId[]).includes(a));
  }

  const includeHouseIngresses = Boolean(input.includeHouseIngresses);
  let targetHouses: readonly HouseId[] = ALL_HOUSE_IDS;
  if (input.targetHouses !== undefined) {
    if (!input.targetHouses.length || input.targetHouses.some(h => !ALL_HOUSE_IDS.includes(h)) ||
        new Set(input.targetHouses).size !== input.targetHouses.length) {
      throw new RangeError('Target houses must be unique house numbers 1..12.');
    }
    targetHouses = ALL_HOUSE_IDS.filter(h => input.targetHouses!.includes(h));
  }

  if (input.houses !== undefined && input.houses !== null && !isValidHouses(input.houses)) {
    throw new RangeError('Supplied natal houses are invalid.');
  }

  const targetChartId = input.targetChartId ?? input.targets[0]?.chartId ?? 'natal';
  if (!targetChartId || targetChartId === input.transitChartId) {
    throw new RangeError('Target chart ID must differ from transit chart ID.');
  }

  return {
    startTt: input.startTt,
    endTt: input.endTt,
    referenceTt: input.referenceTt,
    transitChartId: input.transitChartId,
    targetChartId,
    bodies,
    targets: [...input.targets].sort((a, b) => PLANET_IDS.indexOf(a.planetId) - PLANET_IDS.indexOf(b.planetId)),
    houses: input.houses ?? null,
    angles,
    includeHouseIngresses,
    targetHouses,
    orbPolicy,
    customRules,
    chunkDays,
    slowBodiesOnly,
    maxAllowedDays,
  };
}

interface RawPassRecord {
  readonly tt: number;
  readonly state: AspectPass['state'];
  readonly residualDeg: number | null;
  readonly toleranceDeg: number | null;
}

interface ChunkWindowRecord {
  readonly chunkIndex: number;
  readonly chunkStart: number;
  readonly chunkEnd: number;
  readonly targetKind: 'planet' | 'angle';
  readonly targetId: string; // PlanetId or AngleId
  readonly targetChartId: string;
  readonly targetLon: number;
  readonly aspect: AspectId;
  readonly allowedOrbDeg: number;
  readonly startTt: number;
  readonly endTt: number;
  readonly startsAt: EventMoment | null;
  readonly endsAt: EventMoment | null;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  readonly passes: readonly RawPassRecord[];
  readonly branchLon: number;
  readonly repLon: number | null;
}

interface StitchedWindowRecord {
  readonly firstChunkIndex: number;
  readonly lastChunkIndex: number;
  readonly firstChunkStart: number;
  readonly lastChunkEnd: number;
  readonly targetKind: 'planet' | 'angle';
  readonly targetId: string;
  readonly targetChartId: string;
  readonly targetLon: number;
  readonly aspect: AspectId;
  readonly allowedOrbDeg: number;
  readonly startTt: number;
  readonly endTt: number;
  readonly startsAt: EventMoment | null;
  readonly endsAt: EventMoment | null;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  readonly passes: readonly RawPassRecord[];
  readonly branchLon: number;
  readonly repLon: number | null;
}

interface RawStationRecord {
  readonly tt: number;
  readonly turns: 'direct' | 'retrograde';
  readonly residual: number;
}

interface RawHouseIngressRecord {
  readonly tt: number;
  readonly cuspHouseId: HouseId;
  readonly fromHouse: HouseId;
  readonly toHouse: HouseId;
  readonly retrograde: boolean;
}

function deduplicateRawPasses(passes: readonly RawPassRecord[]): readonly RawPassRecord[] {
  const sorted = [...passes].sort((a, b) => a.tt - b.tt || (a.residualDeg ?? Infinity) - (b.residualDeg ?? Infinity));
  const merged: RawPassRecord[] = [];
  for (const pass of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(pass.tt - prev.tt) <= SEAM_DEDUPE_DAYS) {
      if (prev.state === 'near-miss' && pass.state !== 'near-miss') {
        merged[merged.length - 1] = pass;
      } else if (prev.state === pass.state && (pass.residualDeg ?? Infinity) < (prev.residualDeg ?? Infinity)) {
        merged[merged.length - 1] = pass;
      }
      continue;
    }
    merged.push(pass);
  }
  return merged;
}

function stitchChunkWindows(records: readonly ChunkWindowRecord[]): readonly StitchedWindowRecord[] {
  const sorted = [...records].sort((a, b) => a.chunkIndex - b.chunkIndex || a.startTt - b.startTt || a.endTt - b.endTt);
  const stitched: StitchedWindowRecord[] = [];

  for (const rec of sorted) {
    const prev = stitched[stitched.length - 1];
    if (prev && areWindowsSeamAdjacent(
      { chunkIndex: prev.lastChunkIndex, endTt: prev.endTt, clippedEnd: prev.clippedEnd, branchLon: prev.branchLon },
      { chunkIndex: rec.chunkIndex, startTt: rec.startTt, clippedStart: rec.clippedStart, branchLon: rec.branchLon },
    )) {
      stitched[stitched.length - 1] = {
        ...prev,
        lastChunkIndex: rec.chunkIndex,
        lastChunkEnd: rec.chunkEnd,
        endTt: rec.endTt,
        endsAt: rec.endsAt,
        clippedEnd: rec.clippedEnd,
        passes: deduplicateRawPasses([...prev.passes, ...rec.passes]),
        repLon: prev.repLon ?? rec.repLon,
      };
    } else {
      stitched.push({
        firstChunkIndex: rec.chunkIndex,
        lastChunkIndex: rec.chunkIndex,
        firstChunkStart: rec.chunkStart,
        lastChunkEnd: rec.chunkEnd,
        targetKind: rec.targetKind,
        targetId: rec.targetId,
        targetChartId: rec.targetChartId,
        targetLon: rec.targetLon,
        aspect: rec.aspect,
        allowedOrbDeg: rec.allowedOrbDeg,
        startTt: rec.startTt,
        endTt: rec.endTt,
        startsAt: rec.startsAt,
        endsAt: rec.endsAt,
        clippedStart: rec.clippedStart,
        clippedEnd: rec.clippedEnd,
        passes: deduplicateRawPasses(rec.passes),
        branchLon: rec.branchLon,
        repLon: rec.repLon,
      });
    }
  }

  return stitched;
}

class UnavailableBodyStep extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * Pure worker-side multi-year planetary event range search.
 * Preserves MAX_SEARCH_DAYS = 366 for individual chunks while safely supporting up to
 * 5 years (general) or 10 years (slow planets Jupiter–Pluto), stitching chunk seams,
 * tracking retrograde multi-pass continuity, and solving natal ASC/MC contacts and
 * natal house ingress/egress crossings.
 */
export function searchEventRange(
  engine: EphemeraEngine,
  input: EventRangeSearchRequest,
  report: (progress: RangeSearchProgress) => void = () => {},
): EventRangeSearchResult {
  const settings = validateRangeRequest(input, engine.modelDeltaTSeconds);
  const warnings = new Set<RangeSearchWarning>(['modeled-delta-t']);
  const addWarnings = (values: readonly (EngineWarning | RangeSearchWarning)[]) =>
    values.forEach(w => warnings.add(w));
  const modelDelta = engine.modelDeltaTSeconds;

  const at = (jdTt: number): EventMoment => {
    const utc = utcFromTt(jdTt);
    if (!utc) warnings.add('utc-unavailable');
    else if (utc.slice(0, 10) >= ATOMIC_OFFSETS_VERIFIED_BEFORE) warnings.add('future-utc-assumption');
    return { utc, jdTt, jdUt: instantFromTt(jdTt, modelDelta).jdUt };
  };

  const effectiveStart = Math.max(settings.startTt, EPHEMERA_COVERAGE_TT.start);
  const effectiveEnd = Math.min(settings.endTt, EPHEMERA_COVERAGE_TT.end);
  const clippedToCoverage = effectiveStart !== settings.startTt || effectiveEnd !== settings.endTt;

  const unavailable: RangeUnavailable[] = settings.targets
    .filter(p => p.longitudeDeg === null)
    .map(p => ({ kind: 'natal-position', point: chartPoint(p.chartId, p.planetId), reason: 'position-unavailable' }));

  const wantsHouses = settings.angles.length > 0 || settings.includeHouseIngresses;
  const activeHouses = settings.houses;
  if (wantsHouses && !activeHouses) {
    unavailable.push({ kind: 'houses', reason: 'houses-unavailable' });
  }
  const activeAngles: readonly RangeAngleId[] = activeHouses ? settings.angles : [];
  const activeHouseIngresses = Boolean(activeHouses && settings.includeHouseIngresses);

  const requestedRangeBase = {
    requestedStart: at(settings.startTt),
    requestedEnd: at(settings.endTt),
    requestedDays: settings.endTt - settings.startTt,
    chunkDays: settings.chunkDays,
    clippedToCoverage,
    slowBodiesOnly: settings.slowBodiesOnly,
    maxAllowedDays: settings.maxAllowedDays,
  };

  const provenanceBase = {
    engine: null as ReturnType<EphemeraEngine['position']>['engine'] | null,
    deltaTSource: 'ephemera-model' as const,
    contactToleranceDeg: CONTACT_TOLERANCE_DEG,
    refinementSeconds: REFINEMENT_SECONDS,
    stationToleranceDegPerDay: STATION_TOLERANCE,
    orbPolicy: settings.orbPolicy,
  };

  const publicSettings: EventRangeSearchResult['settings'] = {
    startTt: settings.startTt,
    endTt: settings.endTt,
    referenceTt: settings.referenceTt,
    transitChartId: settings.transitChartId,
    targetChartId: settings.targetChartId,
    bodies: settings.bodies,
    targets: settings.targets,
    angles: settings.angles,
    includeHouseIngresses: settings.includeHouseIngresses,
    targetHouses: settings.targetHouses,
    orbPolicy: settings.orbPolicy,
    chunkDays: settings.chunkDays,
  };

  if (effectiveEnd <= effectiveStart) {
    return {
      status: 'unavailable',
      reason: 'outside-coverage',
      settings: publicSettings,
      range: {
        ...requestedRangeBase,
        effectiveStart: at(effectiveStart),
        effectiveEnd: at(effectiveEnd),
        effectiveDays: 0,
        chunkCount: 0,
      },
      events: [],
      warnings: [...warnings].sort(),
      unavailable,
      provenance: provenanceBase,
      stationResidualsDegPerDay: {},
    };
  }

  if (clippedToCoverage) warnings.add('interval-clipped');

  const chunks = computeRangeChunks(effectiveStart, effectiveEnd, settings.chunkDays);
  const availableTargets = settings.targets.filter(
    (p): p is FixedNatalPoint & { longitudeDeg: number } => p.longitudeDeg !== null,
  );
  const targetLonById = new Map<PlanetId, number>(availableTargets.map(t => [t.planetId, t.longitudeDeg]));

  // Monitored house cusps for ingress/egress: for each target house h, both its entry cusp (h)
  // and exit cusp ((h % 12) + 1) can produce an ingress or egress (direct or retrograde).
  const targetHouseSet = new Set<HouseId>(settings.targetHouses);
  const monitoredCuspHouseIds: HouseId[] = activeHouseIngresses
    ? ALL_HOUSE_IDS.filter(cuspId => {
      const prevHouse = (cuspId === 1 ? 12 : cuspId - 1) as HouseId;
      return targetHouseSet.has(cuspId) || targetHouseSet.has(prevHouse);
    })
    : [];

  const bodyRulesMap = new Map<PlanetId, AspectRuleSetV0>(
    settings.bodies.map(body => [body, rangeRulesForBody(body, settings.orbPolicy, settings.customRules)]),
  );

  const stepsPerBodyChunk = 1 + availableTargets.length + activeAngles.length + (activeHouseIngresses ? 1 : 0);
  const totalSteps = chunks.length * settings.bodies.length * stepsPerBodyChunk;
  let completedSteps = 0;
  let engineInfo = provenanceBase.engine;

  const windowsByBody = new Map<PlanetId, ChunkWindowRecord[]>();
  const stationsByBody = new Map<PlanetId, RawStationRecord[]>();
  const ingressesByBody = new Map<PlanetId, RawHouseIngressRecord[]>();
  const bodySucceededAtLeastOnce = new Set<PlanetId>();
  const bodyFailedReason = new Map<PlanetId, string>();

  for (const body of settings.bodies) {
    windowsByBody.set(body, []);
    stationsByBody.set(body, []);
    ingressesByBody.set(body, []);
  }

  const bodyLonAt = (body: PlanetId, tt: number): number | null => {
    const res = engine.position(planetName(body), instantFromTt(tt, modelDelta));
    engineInfo ??= res.engine;
    addWarnings(res.warnings);
    return res.status === 'ok' ? normalize(res.value.longitude) : null;
  };

  const bodyRetroAt = (body: PlanetId, tt: number): boolean | null => {
    if (body === 'sun' || body === 'moon') return false;
    const res = engine.position(planetName(body), instantFromTt(tt, modelDelta));
    engineInfo ??= res.engine;
    addWarnings(res.warnings);
    return res.status === 'ok' ? res.value.retrograde : null;
  };

  report({ completed: 0, total: totalSteps, chunkIndex: 0, chunkCount: chunks.length });

  for (const chunk of chunks) {
    for (const body of settings.bodies) {
      const bodyStartStep = completedSteps;
      const bodyRules = bodyRulesMap.get(body)!;

      // 1. Run verified single-chunk searchEvents() for planet-to-planet aspects and stations.
      const chunkRes = searchEvents(engine, {
        startTt: chunk.startTt,
        endTt: chunk.endTt,
        referenceTt: settings.referenceTt,
        transitChartId: settings.transitChartId,
        bodies: [body],
        targets: availableTargets,
        rules: bodyRules,
      });
      addWarnings(chunkRes.warnings);
      if (chunkRes.provenance.engine) engineInfo = chunkRes.provenance.engine;

      const failedTransit = chunkRes.unavailable.find(u => u.kind === 'transit-body' && u.point.planetId === body);
      if (failedTransit || chunkRes.status === 'unavailable') {
        if (!bodyFailedReason.has(body)) {
          bodyFailedReason.set(body, failedTransit?.reason ?? chunkRes.reason ?? 'calculation-unavailable');
        }
        completedSteps = bodyStartStep + stepsPerBodyChunk;
        report({ completed: completedSteps, total: totalSteps, chunkIndex: chunk.index, chunkCount: chunks.length });
        continue;
      }

      bodySucceededAtLeastOnce.add(body);
      const chunkEvents: readonly AstrologyEvent[] = chunkRes.context?.events ?? [];
      const chunkStationTts: number[] = [];

      for (const ev of chunkEvents) {
        if (ev.kind === 'station') {
          if (ev.at.jdTt !== null) {
            chunkStationTts.push(ev.at.jdTt);
            stationsByBody.get(body)!.push({
              tt: ev.at.jdTt,
              turns: ev.turns,
              residual: chunkRes.stationResidualsDegPerDay[ev.id] ?? 0,
            });
          }
        } else {
          const targetLon = targetLonById.get(ev.target.planetId);
          if (targetLon === undefined) continue;
          const startTt = ev.startsAt?.jdTt ?? chunk.startTt;
          const endTt = ev.endsAt?.jdTt ?? chunk.endTt;
          const repTt = ev.passes[0]?.at.jdTt ?? (startTt + endTt) / 2;
          const repLon = bodyLonAt(body, repTt);
          const branchLon = exactBranchLongitude(targetLon, ev.aspect, repLon);
          const rawPasses: RawPassRecord[] = ev.passes
            .filter((p): p is AspectPass & { at: { jdTt: number } } => p.at.jdTt !== null)
            .map(p => ({
              tt: p.at.jdTt,
              state: p.state,
              residualDeg: p.residualDeg,
              toleranceDeg: p.toleranceDeg,
            }));
          windowsByBody.get(body)!.push({
            chunkIndex: chunk.index,
            chunkStart: chunk.startTt,
            chunkEnd: chunk.endTt,
            targetKind: 'planet',
            targetId: ev.target.planetId,
            targetChartId: ev.target.chartId,
            targetLon,
            aspect: ev.aspect,
            allowedOrbDeg: ev.allowedOrbDeg,
            startTt,
            endTt,
            startsAt: ev.startsAt,
            endsAt: ev.endsAt,
            clippedStart: ev.clippedStart,
            clippedEnd: ev.clippedEnd,
            passes: rawPasses,
            branchLon,
            repLon,
          });
        }
      }

      completedSteps += 1 + availableTargets.length;
      report({ completed: completedSteps, total: totalSteps, chunkIndex: chunk.index, chunkCount: chunks.length });

      // 2. If angles or house ingresses are enabled, sample the body track once for this chunk
      //    using the already-found station turnaround points.
      if ((activeAngles.length > 0 || activeHouseIngresses) && activeHouses) {
        const samples = new Map<number, Sample>();
        const sample = (tt: number): Sample => {
          const existing = samples.get(tt);
          if (existing) return existing;
          const res = engine.position(planetName(body), instantFromTt(tt, modelDelta));
          engineInfo ??= res.engine;
          addWarnings(res.warnings);
          if (res.status === 'unavailable') throw new UnavailableBodyStep(res.reason);
          const value: Sample = { tt, longitude: res.value.longitude, speed: res.value.longitudeSpeed };
          samples.set(tt, value);
          return value;
        };
        const seed = (longitude: number, a: number, b: number) => {
          const left = instantFromTt(a, modelDelta).jdUt;
          const right = instantFromTt(b, modelDelta).jdUt;
          if (right <= left) return null;
          const res = engine.crossing(planetName(body), longitude, left, { direction: 1, maxDays: right - left });
          addWarnings(res.warnings);
          return res.status === 'ok' ? instantFromUt(res.value.jdUt, modelDelta).jdTt : null;
        };

        try {
          const turns = uniqueTimes(chunkStationTts).filter(
            tt => tt - chunk.startTt > TIME_EPS && chunk.endTt - tt > TIME_EPS,
          );
          const grid = Array.from(
            { length: Math.ceil((chunk.endTt - chunk.startTt) / GRID_DAYS) },
            (_, i) => chunk.startTt + i * GRID_DAYS,
          );
          const track = [
            chunk.startTt,
            ...uniqueTimes([...grid, ...turns]).filter(
              tt => tt - chunk.startTt > TIME_EPS && chunk.endTt - tt > TIME_EPS,
            ),
            chunk.endTt,
          ].map(sample);

          // 2a. Natal angle aspect windows (ASC / MC / DSC / IC)
          for (const angle of activeAngles) {
            const angleLon = angle === 'asc'
              ? activeHouses.ascendantDeg
              : angle === 'mc'
                ? activeHouses.midheavenDeg
                : angle === 'dsc'
                  ? normalize(activeHouses.ascendantDeg + 180)
                  : normalize(activeHouses.midheavenDeg + 180);
            for (const aspect of ASPECT_IDS) {
              const allowedOrbDeg = bodyRules.orbsDeg[aspect];
              const solved = aspectWindows(
                track,
                turns,
                angleLon,
                MAJOR_ASPECT_ANGLES[aspect],
                allowedOrbDeg,
                sample,
                seed,
              );
              for (const w of solved) {
                const repTt = w.passes[0]?.tt ?? (w.start + w.end) / 2;
                const repLon = normalize(sample(repTt).longitude);
                const branchLon = exactBranchLongitude(angleLon, aspect, repLon);
                windowsByBody.get(body)!.push({
                  chunkIndex: chunk.index,
                  chunkStart: chunk.startTt,
                  chunkEnd: chunk.endTt,
                  targetKind: 'angle',
                  targetId: angle,
                  targetChartId: settings.targetChartId,
                  targetLon: angleLon,
                  aspect,
                  allowedOrbDeg,
                  startTt: w.start,
                  endTt: w.end,
                  startsAt: w.clippedStart ? null : at(w.start),
                  endsAt: w.clippedEnd ? null : at(w.end),
                  clippedStart: w.clippedStart,
                  clippedEnd: w.clippedEnd,
                  passes: w.passes.map(p => ({
                    tt: p.tt,
                    state: p.state,
                    residualDeg: p.residual,
                    toleranceDeg: CONTACT_TOLERANCE_DEG,
                  })),
                  branchLon,
                  repLon,
                });
              }
            }
            completedSteps += 1;
            report({ completed: completedSteps, total: totalSteps, chunkIndex: chunk.index, chunkCount: chunks.length });
          }

          // 2b. Natal house cusp ingress / egress crossings (including retrograde re-entries)
          if (activeHouseIngresses) {
            for (const cuspHouseId of monitoredCuspHouseIds) {
              const cuspLon = activeHouses.cusps[cuspHouseId - 1].longitudeDeg;
              const prevHouse = (cuspHouseId === 1 ? 12 : cuspHouseId - 1) as HouseId;
              const hits = crossings(track, [cuspLon], sample, seed);
              for (const hit of hits) {
                const speed = sample(hit.tt).speed;
                let fromHouse: HouseId;
                let toHouse: HouseId;
                let retrograde: boolean;

                if (Math.abs(speed) > STATION_TOLERANCE) {
                  retrograde = speed < 0;
                  fromHouse = retrograde ? cuspHouseId : prevHouse;
                  toHouse = retrograde ? prevHouse : cuspHouseId;
                } else {
                  // Stationary contact on cusp: verify genuine transition vs. tangent graze.
                  const beforeTt = Math.max(chunk.startTt, hit.tt - 0.05);
                  const afterTt = Math.min(chunk.endTt, hit.tt + 0.05);
                  const beforeH = natalHouse(normalize(sample(beforeTt).longitude), activeHouses);
                  const afterH = natalHouse(normalize(sample(afterTt).longitude), activeHouses);
                  if (!beforeH || !afterH || beforeH === afterH) continue;
                  fromHouse = beforeH;
                  toHouse = afterH;
                  retrograde = beforeH === cuspHouseId && afterH === prevHouse;
                }

                if (!targetHouseSet.has(fromHouse) && !targetHouseSet.has(toHouse)) continue;
                ingressesByBody.get(body)!.push({
                  tt: hit.tt,
                  cuspHouseId,
                  fromHouse,
                  toHouse,
                  retrograde,
                });
              }
            }
            completedSteps += 1;
            report({ completed: completedSteps, total: totalSteps, chunkIndex: chunk.index, chunkCount: chunks.length });
          }
        } catch (error) {
          if (!(error instanceof UnavailableBodyStep)) throw error;
          if (!bodyFailedReason.has(body)) bodyFailedReason.set(body, error.reason);
          completedSteps = bodyStartStep + stepsPerBodyChunk;
          report({ completed: completedSteps, total: totalSteps, chunkIndex: chunk.index, chunkCount: chunks.length });
        }
      }
    }
  }

  for (const [body, reason] of bodyFailedReason) {
    unavailable.push({ kind: 'transit-body', point: chartPoint(settings.transitChartId, body), reason });
  }

  const allEvents: { readonly event: RangeEvent; readonly orderTt: number }[] = [];
  const stationResidualsDegPerDay: Record<string, number> = {};

  // Assemble stitched, deduplicated, series-linked events per transiting body.
  for (const body of settings.bodies) {
    if (!bodySucceededAtLeastOnce.has(body)) continue;
    const transit = chartPoint(settings.transitChartId, body);

    // 1. Chronological station deduplication
    const sortedStations = [...stationsByBody.get(body)!].sort((a, b) => a.tt - b.tt || a.residual - b.residual);
    const dedupedStations: RawStationRecord[] = [];
    for (const st of sortedStations) {
      const prev = dedupedStations[dedupedStations.length - 1];
      if (prev && Math.abs(st.tt - prev.tt) <= SEAM_DEDUPE_DAYS && st.turns === prev.turns) {
        if (st.residual < prev.residual) dedupedStations[dedupedStations.length - 1] = st;
        continue;
      }
      dedupedStations.push(st);
    }

    const bodyStationTts = deduplicateStationTts(dedupedStations.map(s => s.tt));

    for (const st of dedupedStations) {
      const id = stableId('station', transit.chartId, body, epochKey(st.tt), st.turns);
      const stLon = activeHouses ? bodyLonAt(body, st.tt) : null;
      const inNatalHouse = activeHouses && stLon !== null ? natalHouse(stLon, activeHouses) : null;
      stationResidualsDegPerDay[id] = st.residual;
      allEvents.push({
        orderTt: st.tt,
        event: {
          kind: 'station',
          id,
          timing: timingFor(settings.referenceTt, st.tt),
          planet: transit,
          at: at(st.tt),
          turns: st.turns,
          inNatalHouse,
        },
      });
    }

    // 2. Chronological house ingress/egress deduplication
    if (activeHouses && activeHouseIngresses) {
      const sortedIngresses = [...ingressesByBody.get(body)!].sort(
        (a, b) => a.tt - b.tt || a.cuspHouseId - b.cuspHouseId,
      );
      const dedupedIngresses: RawHouseIngressRecord[] = [];
      for (const ing of sortedIngresses) {
        const prev = dedupedIngresses[dedupedIngresses.length - 1];
        if (prev && Math.abs(ing.tt - prev.tt) <= SEAM_DEDUPE_DAYS &&
            prev.cuspHouseId === ing.cuspHouseId && prev.fromHouse === ing.fromHouse && prev.toHouse === ing.toHouse) {
          continue;
        }
        dedupedIngresses.push(ing);
      }

      for (const ing of dedupedIngresses) {
        const id = stableId(
          'house-ingress',
          transit.chartId,
          body,
          settings.targetChartId,
          ing.fromHouse,
          ing.toHouse,
          epochKey(ing.tt),
        );
        allEvents.push({
          orderTt: ing.tt,
          event: {
            kind: 'house-ingress',
            id,
            timing: timingFor(settings.referenceTt, ing.tt),
            planet: transit,
            targetChartId: settings.targetChartId,
            cuspHouseId: ing.cuspHouseId,
            fromHouse: ing.fromHouse,
            toHouse: ing.toHouse,
            at: at(ing.tt),
            retrograde: ing.retrograde,
            houseSystem: activeHouses.effectiveSystem,
          },
        });
      }
    }

    // 3. Aspect windows (both planet and angle targets): seam stitching + retrograde series continuity
    const lonAtStart = bodyLonAt(body, effectiveStart);
    const lonAtEnd = bodyLonAt(body, effectiveEnd);

    const grouped = new Map<string, ChunkWindowRecord[]>();
    for (const rec of windowsByBody.get(body)!) {
      const plusBranch = normalize(rec.targetLon + MAJOR_ASPECT_ANGLES[rec.aspect]);
      const branchSide = Math.abs(rec.branchLon - plusBranch) < 0.5 || Math.abs(rec.branchLon - plusBranch) > 359.5
        ? 'plus'
        : 'minus';
      const groupKey = `${rec.targetKind}|${rec.targetChartId}|${rec.targetId}|${rec.aspect}|${branchSide}`;
      const list = grouped.get(groupKey);
      if (list) list.push(rec);
      else grouped.set(groupKey, [rec]);
    }

    for (const records of grouped.values()) {
      const stitched = stitchChunkWindows(records);
      if (!stitched.length) continue;

      // Partition stitched windows into continuous retrograde series on the same aspect branch.
      const chains: StitchedWindowRecord[][] = [];
      for (const win of stitched) {
        const currentChain = chains[chains.length - 1];
        const prevWin = currentChain?.[currentChain.length - 1];
        if (prevWin && areWindowsRetrogradeChained(body, prevWin, win, bodyStationTts)) {
          currentChain.push(win);
        } else {
          chains.push([win]);
        }
      }

      for (const chain of chains) {
        const first = chain[0];
        const last = chain[chain.length - 1];

        // Count exact passes across the whole series and check retrograde motion on each pass.
        const passMetaByWin = chain.map(win =>
          win.passes.map(p => ({
            raw: p,
            retrograde: bodyRetroAt(body, p.tt),
          })),
        );
        const exactPassCountInRange = passMetaByWin.reduce(
          (sum, list) => sum + list.filter(p => p.raw.state !== 'near-miss').length,
          0,
        );
        const anyRetroPass = passMetaByWin.some(list => list.some(p => p.retrograde === true));

        // Honest outer-horizon clipping + retrograde shadow-horizon completeness check.
        const firstDirectClipped = first.clippedStart &&
          (first.startsAt === null || Math.abs(first.firstChunkStart - effectiveStart) <= 1e-4);
        const lastDirectClipped = last.clippedEnd &&
          (last.endsAt === null || Math.abs(last.lastChunkEnd - effectiveEnd) <= 1e-4);

        const shadowClippedStart = !firstDirectClipped && isSeriesOpenAtHorizon(
          body,
          first.branchLon,
          first.allowedOrbDeg,
          lonAtStart,
          bodyStationTts.filter(tt => tt > effectiveStart + 1e-4 && tt < first.startTt - 1e-4).length,
        );
        const shadowClippedEnd = !lastDirectClipped && isSeriesOpenAtHorizon(
          body,
          last.branchLon,
          last.allowedOrbDeg,
          lonAtEnd,
          bodyStationTts.filter(tt => tt > last.endTt + 1e-4 && tt < effectiveEnd - 1e-4).length,
        );

        const seriesClippedStart = firstDirectClipped || shadowClippedStart;
        const seriesClippedEnd = lastDirectClipped || shadowClippedEnd;
        const seriesId = stableId(
          'series',
          transit.chartId,
          body,
          first.targetKind,
          first.targetChartId,
          first.targetId,
          first.aspect,
          epochKey(first.startTt),
        );

        let runningExactPass = 0;
        chain.forEach((win, windowIndex) => {
          const passes: RangeAspectPass[] = passMetaByWin[windowIndex].map(({ raw, retrograde }) => ({
            at: at(raw.tt),
            state: raw.state,
            residualDeg: raw.residualDeg,
            toleranceDeg: raw.toleranceDeg,
            retrograde,
            passNumberInSeries: raw.state === 'near-miss' ? null : ++runningExactPass,
          }));

          const series: EventSeriesMeta = {
            id: seriesId,
            branchLongitudeDeg: win.branchLon,
            windowIndex,
            windowCountInRange: chain.length,
            exactPassCountInRange,
            isRetrogradeSeries: exactPassCountInRange > 1 || anyRetroPass || chain.length > 1,
            clippedStart: seriesClippedStart,
            clippedEnd: seriesClippedEnd,
            complete: !seriesClippedStart && !seriesClippedEnd,
          };

          const winTiming = timingFor(settings.referenceTt, win.startTt, win.endTt);
          if (win.targetKind === 'planet') {
            const target = chartPoint(win.targetChartId, win.targetId as PlanetId);
            const id = stableId('aspect', transit.chartId, body, target.chartId, target.planetId, win.aspect, epochKey(win.startTt));
            allEvents.push({
              orderTt: win.startTt,
              event: {
                kind: 'aspect-window',
                id,
                timing: winTiming,
                transit,
                target,
                aspect: win.aspect,
                startsAt: win.clippedStart ? null : win.startsAt,
                endsAt: win.clippedEnd ? null : win.endsAt,
                clippedStart: win.clippedStart,
                clippedEnd: win.clippedEnd,
                passes,
                allowedOrbDeg: win.allowedOrbDeg,
                series,
              },
            });
          } else {
            const targetAngle = win.targetId as RangeAngleId;
            const id = stableId('angle-aspect', transit.chartId, body, win.targetChartId, targetAngle, win.aspect, epochKey(win.startTt));
            allEvents.push({
              orderTt: win.startTt,
              event: {
                kind: 'angle-aspect-window',
                id,
                timing: winTiming,
                transit,
                targetChartId: win.targetChartId,
                targetAngle,
                aspect: win.aspect,
                startsAt: win.clippedStart ? null : win.startsAt,
                endsAt: win.clippedEnd ? null : win.endsAt,
                clippedStart: win.clippedStart,
                clippedEnd: win.clippedEnd,
                passes,
                allowedOrbDeg: win.allowedOrbDeg,
                series,
              },
            });
          }
        });
      }
    }
  }

  const supportedCount = bodySucceededAtLeastOnce.size;
  const sortedEvents = allEvents
    .sort((a, b) => a.orderTt - b.orderTt || orderText(a.event.id, b.event.id))
    .map(entry => entry.event);

  const status: EventRangeSearchResult['status'] = supportedCount === 0
    ? 'unavailable'
    : unavailable.length || warnings.has('interval-clipped')
      ? 'partial'
      : 'complete';

  return {
    status,
    ...(supportedCount === 0 ? { reason: 'no-calculable-bodies' as const } : {}),
    settings: publicSettings,
    range: {
      ...requestedRangeBase,
      effectiveStart: at(effectiveStart),
      effectiveEnd: at(effectiveEnd),
      effectiveDays: effectiveEnd - effectiveStart,
      chunkCount: chunks.length,
    },
    events: supportedCount === 0 ? [] : sortedEvents,
    warnings: [...warnings].sort(),
    unavailable,
    provenance: { ...provenanceBase, engine: engineInfo },
    stationResidualsDegPerDay,
  };
}
