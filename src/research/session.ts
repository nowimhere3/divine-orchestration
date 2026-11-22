import type { Chart } from '../domain/chart';
import { createThemeRegistry } from '../knowledge/research-themes';
import type { ResearchThemePreset, ThemeRegistry } from '../knowledge/research-themes';
import type { EventRangeSearchRequest, EventRangeSearchResult, RangeAngleId } from '../search/range';
import { resolveChartFactors, solverAngleFor } from './chart-factors';
import type { ChartFactors } from './chart-factors';
import { buildRangeSearchRequest, hasAsymmetricDualOrbs, resolveResearchFocus } from './query';
import type { BuildRangeRequestOptions, ResearchQuery, ResolvedResearchFocus } from './query';
import { evaluateResearchEvents } from './relevance';
import type { EvaluatedResearchResult } from './relevance';
import { retimeRangeResult } from './timing';

export interface ResearchSession {
  readonly sessionId: string;
  readonly chartSignature: string;
  readonly computeCacheKey: string;
  readonly chartFactors: ChartFactors;
  readonly query: ResearchQuery;
  readonly focus: ResolvedResearchFocus;
  readonly rangeRequest: EventRangeSearchRequest;
  /** Exact, immutable U6A range search result (zero truncation). */
  readonly rawResult: EventRangeSearchResult;
  readonly evaluated: EvaluatedResearchResult;
  /** Frozen snapshot of active theme definitions used for this evaluation. */
  readonly themeSnapshot: readonly ResearchThemePreset[];
}

export interface ResearchExportHandoff {
  readonly schema: 'divine-orchestration/research-handoff';
  readonly version: 1;
  readonly sessionId: string;
  readonly chartSignature: string;
  readonly query: ResearchQuery;
  readonly chartFactors: ChartFactors;
  readonly focus: ResolvedResearchFocus;
  readonly rawResult: EventRangeSearchResult;
  readonly evaluated: EvaluatedResearchResult;
  readonly themeSnapshot: readonly ResearchThemePreset[];
  /** Presented events (one per physical contact, limited to the planets the query covers). */
  readonly totalEvents: number;
  /** Events in the underlying calculation before axis merging and planet-scope filtering. */
  readonly calculatedEvents: number;
  readonly reSearchRequired: false;
}

/** Deterministic FNV-1a 64-bit hex digest (synchronous, zero dependencies) for session/cache IDs. */
function fnv1aHex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Computes a deterministic signature of a natal Chart's astronomical identity (birth time,
 * observer coordinates, house system, planetary availability). Any edit that changes chart
 * geometry produces a different signature, preventing stale Events-to-Export handoffs.
 */
export function computeChartSignature(chart: Chart): string {
  const payload = {
    id: chart.id,
    kind: chart.kind,
    timeKind: chart.time.kind,
    timeInput: chart.time.input,
    jdTt: chart.time.kind === 'resolved' ? Number(chart.time.jdTt.toFixed(8)) : null,
    observer: chart.settings.observer,
    requestedHouseSystem: chart.settings.requestedHouseSystem,
    effectiveHouseSystem: chart.houses.status === 'available' ? chart.houses.value.effectiveSystem : null,
    housesStatus: chart.houses.status,
    planetsStatus: chart.planets.status,
  };
  return `chart-${fnv1aHex(JSON.stringify(payload))}`;
}

/**
 * Deterministic cache key covering the U6A astronomical computation parameters. The Time Machine reference
 * moment is deliberately excluded: it only sets past/present/future timing, which `retimeRangeResult`
 * re-derives without recalculating anything.
 * If two ResearchQueries produce the same computeCacheKey, client-side re-evaluation
 * succeeds instantly without re-running the Web Worker.
 */
export function computeRangeCacheKey(
  chartSignature: string,
  request: EventRangeSearchRequest,
): string {
  const payload = {
    chartSignature,
    startTt: Number(request.startTt.toFixed(6)),
    endTt: Number(request.endTt.toFixed(6)),
    transitChartId: request.transitChartId,
    targetChartId: request.targetChartId ?? null,
    bodies: request.bodies,
    targets: request.targets.map(t => [t.chartId, t.planetId, t.longitudeDeg === null ? null : Number(t.longitudeDeg.toFixed(6))]),
    includeAngles: request.includeAngles ?? false,
    includeHouseIngresses: Boolean(request.includeHouseIngresses),
    targetHouses: request.targetHouses ?? null,
    orbPolicy: request.orbPolicy ?? 'transit-focused',
    rules: request.rules?.orbsDeg ?? null,
  };
  return `range-${fnv1aHex(JSON.stringify(payload))}`;
}

export interface CreateResearchSessionInput {
  readonly chart: Chart;
  readonly query: ResearchQuery;
  readonly rangeRequest: EventRangeSearchRequest;
  readonly rawResult: EventRangeSearchResult;
  readonly registry?: ThemeRegistry;
}

/**
 * Assembles an immutable ResearchSession binding a verified U6A EventRangeSearchResult
 * to its resolved chart factors, query, theme snapshot, and deterministic relevance evaluation.
 */
export function createResearchSession(input: CreateResearchSessionInput): ResearchSession {
  const registry = input.registry ?? createThemeRegistry();
  const chartSignature = computeChartSignature(input.chart);
  const chartFactors = resolveChartFactors(input.chart, {
    rulershipPolicy: input.query.focus.rulershipPolicy,
  });
  const focus = resolveResearchFocus(input.query, chartFactors, registry);
  const evaluated = evaluateResearchEvents(
    input.rawResult.events,
    input.query,
    focus,
    chartFactors,
    registry,
    { solvedAngles: input.rawResult.settings.angles },
  );
  const computeCacheKey = computeRangeCacheKey(chartSignature, input.rangeRequest);
  const themeSnapshot = Object.freeze([...focus.activeThemes]);
  const sessionId = `research-${fnv1aHex(JSON.stringify({
    computeCacheKey,
    referenceTt: input.rawResult.settings.referenceTt,
    query: input.query,
    eventCount: input.rawResult.events.length,
    themeIds: themeSnapshot.map(t => [t.id, t.houses, t.naturalSignificators, t.angles]),
  }))}`;

  return Object.freeze({
    sessionId,
    chartSignature,
    computeCacheKey,
    chartFactors,
    query: input.query,
    focus,
    rangeRequest: input.rangeRequest,
    rawResult: input.rawResult,
    evaluated,
    themeSnapshot,
  });
}

/** Returns true iff the session was computed against the exact same natal chart geometry. */
export function isSessionCompatibleWithChart(session: ResearchSession, chart: Chart): boolean {
  return session.chartSignature === computeChartSignature(chart);
}

/**
 * Returns true if changing to `nextQuery` can reuse `session.rawResult` client-side (0 ms)
 * without launching a new U6A Web Worker search.
 */
export function canReuseSessionComputation(
  session: ResearchSession,
  nextQuery: ResearchQuery,
  chart: Chart,
  rangeOptions: BuildRangeRequestOptions,
  registry: ThemeRegistry = createThemeRegistry(),
): boolean {
  if (!isSessionCompatibleWithChart(session, chart)) return false;
  const nextFactors = resolveChartFactors(chart, { rulershipPolicy: nextQuery.focus.rulershipPolicy });
  const nextFocus = resolveResearchFocus(nextQuery, nextFactors, registry);
  const nextRequest = buildRangeSearchRequest(nextQuery, chart, nextFocus, rangeOptions);
  const nextCacheKey = computeRangeCacheKey(session.chartSignature, nextRequest);
  if (nextCacheKey === session.computeCacheKey) return true;

  // Also allow instant reuse when the existing rawResult is a strict superset of nextRequest
  // (same start/end/referenceTt/chart IDs/orbPolicy/rules, subset of bodies/targets/angles/houses).
  const prev = session.rangeRequest;
  if (Math.abs(prev.startTt - nextRequest.startTt) > 1e-6) return false;
  if (Math.abs(prev.endTt - nextRequest.endTt) > 1e-6) return false;
  if (prev.transitChartId !== nextRequest.transitChartId) return false;
  if ((prev.targetChartId ?? null) !== (nextRequest.targetChartId ?? null)) return false;
  if ((prev.orbPolicy ?? 'transit-focused') !== (nextRequest.orbPolicy ?? 'transit-focused')) return false;
  if (JSON.stringify(prev.rules?.orbsDeg ?? null) !== JSON.stringify(nextRequest.rules?.orbsDeg ?? null)) return false;

  const prevBodies = new Set(prev.bodies);
  if (nextRequest.bodies.some(b => !prevBodies.has(b))) return false;

  const prevTargets = new Set(prev.targets.map(t => `${t.chartId}|${t.planetId}`));
  if (nextRequest.targets.some(t => !prevTargets.has(`${t.chartId}|${t.planetId}`))) return false;

  const prevAngles = new Set<RangeAngleId>(
    prev.includeAngles === true
      ? ['asc', 'mc']
      : Array.isArray(prev.includeAngles) ? prev.includeAngles : [],
  );
  const nextAngles: readonly RangeAngleId[] =
    nextRequest.includeAngles === true
      ? ['asc', 'mc']
      : Array.isArray(nextRequest.includeAngles) ? nextRequest.includeAngles : [];
  const asymmetricOrbs = hasAsymmetricDualOrbs(
    nextRequest.bodies,
    nextRequest.orbPolicy ?? 'transit-focused',
    nextRequest.rules?.orbsDeg,
  );
  if (
    nextAngles.some(a =>
      !prevAngles.has(a) && (asymmetricOrbs || !prevAngles.has(solverAngleFor(a))),
    )
  ) {
    return false;
  }

  if (nextRequest.includeHouseIngresses) {
    if (!prev.includeHouseIngresses) return false;
    const prevHouses = new Set(prev.targetHouses ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const nextHouses = nextRequest.targetHouses ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    if (nextHouses.some(h => !prevHouses.has(h))) return false;
  }

  return true;
}

/**
 * Re-evaluates an existing ResearchSession against an updated ResearchQuery or edited
 * ThemeRegistry without re-running the U6A worker. Preserves the exact cached `rawResult`.
 */
export function reEvaluateResearchSession(
  session: ResearchSession,
  nextQuery: ResearchQuery,
  chart: Chart,
  registry: ThemeRegistry = createThemeRegistry(),
  referenceTt?: number | null,
): ResearchSession {
  if (!isSessionCompatibleWithChart(session, chart)) {
    throw new Error('Cannot re-evaluate research session against a different natal chart.');
  }
  // A moved Time Machine only changes past/present/future timing; positions, windows and passes are reused.
  const rawResult = referenceTt === undefined ? session.rawResult : retimeRangeResult(session.rawResult, referenceTt);
  const rangeRequest = rawResult === session.rawResult
    ? session.rangeRequest
    : { ...session.rangeRequest, referenceTt: rawResult.settings.referenceTt };
  return createResearchSession({
    chart,
    query: nextQuery,
    rangeRequest,
    rawResult,
    registry,
  });
}

/**
 * Produces an immutable, exact Events-to-Export handoff payload from a verified ResearchSession.
 * Throws if the active natal chart has diverged since the search ran, preventing mismatched exports.
 */
export function prepareExportHandoff(
  session: ResearchSession,
  activeChart: Chart,
): ResearchExportHandoff {
  if (!isSessionCompatibleWithChart(session, activeChart)) {
    throw new Error('The active natal chart changed after this research search ran. Run a fresh search before exporting.');
  }
  return Object.freeze({
    schema: 'divine-orchestration/research-handoff' as const,
    version: 1 as const,
    sessionId: session.sessionId,
    chartSignature: session.chartSignature,
    query: session.query,
    chartFactors: session.chartFactors,
    focus: session.focus,
    rawResult: session.rawResult,
    evaluated: session.evaluated,
    themeSnapshot: session.themeSnapshot,
    totalEvents: session.evaluated.counts.total,
    calculatedEvents: session.evaluated.counts.calculatedEvents,
    reSearchRequired: false as const,
  });
}
