import { aspectFactId, calculateAspects, createAspectRuleSet } from '../domain/aspects';
import type { AspectFact, AspectRuleSetV0 } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { Chart, ChartWarning, PlanetRef } from '../domain/chart';
import type { AstrologyEvent, EventMoment, SymbolicMeaning } from '../domain/event';
import { isLocalEphemeraEngine } from '../engine/ephemera';
import type { EphemeraEngine } from '../engine/ephemera';
import { interpretNatalChart, natalSymbolicMeanings } from '../interpret/natal';
import { availablePositions, orderedCusps } from '../view/chart-data';

export interface SnapshotContext {
  readonly selectedAt: EventMoment | null;
  readonly referenceAt: EventMoment | null;
  /** A null result means event search has not supplied any data. */
  readonly eventSearch: {
    readonly start: EventMoment;
    readonly end: EventMoment;
    readonly events: readonly AstrologyEvent[];
  } | null;
  readonly eventSummary?: {
    readonly status: 'complete' | 'partial' | 'unavailable';
    readonly daysBefore: number;
    readonly daysAfter: number;
    readonly timing: string;
    readonly filter: string;
    readonly limit: number;
    readonly totalEvents: number;
    readonly includedEvents: number;
    readonly warnings: readonly string[];
    readonly unavailableReasons: readonly string[];
    readonly contactToleranceDeg: number;
    readonly refinementSeconds: number;
    readonly stationToleranceDegPerDay: number;
    readonly stationResidualsDegPerDay: readonly (number | null)[];
  };
}

interface EngineProvenance {
  readonly name: string;
  readonly version: string;
  readonly dataMode: string;
  readonly frame: string;
}

interface SnapshotChart extends Omit<Chart, 'time'> {
  readonly timeStatus: Chart['time']['kind'];
  readonly time: Chart['time'] | null;
}

export interface SnapshotV0 {
  readonly schema: 'divine-orchestration/snapshot';
  readonly schemaVersion: 0;
  readonly privacy: 'full' | 'birth-details-redacted';
  readonly engine: EngineProvenance | null;
  readonly aspectRules: AspectRuleSetV0;
  readonly charts: readonly SnapshotChart[];
  readonly aspects: readonly AspectFact[];
  readonly context: SnapshotContext;
  readonly interpretations: readonly SymbolicMeaning[];
}

export interface SnapshotInput {
  readonly engine: EngineProvenance | null;
  readonly aspectRules: AspectRuleSetV0;
  readonly charts: readonly Chart[];
  readonly aspects: readonly AspectFact[];
  readonly context: SnapshotContext;
  /** Caller-provided meanings are accepted in full exports only. */
  readonly interpretations?: readonly SymbolicMeaning[];
}

interface SnapshotOptions {
  readonly redactBirthDetails?: boolean;
  readonly includeRedactedNatalSynthesis?: boolean;
  readonly dateOnlyEngine?: EphemeraEngine;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().flatMap(key =>
      record[key] === undefined ? [] : [[key, canonicalJson(record[key])]],
    ));
  }
  throw new TypeError('Snapshot values must be JSON data with finite numbers.');
}

const hiddenMoment: EventMoment = { utc: null, jdUt: null, jdTt: null };

function redactEvent(event: AstrologyEvent, id: string, ref: (point: PlanetRef) => PlanetRef): AstrologyEvent {
  if (event.kind === 'station') {
    return { kind: event.kind, id, timing: event.timing, planet: ref(event.planet), at: hiddenMoment, turns: event.turns };
  }
  return {
    kind: event.kind, id, timing: event.timing,
    transit: ref(event.transit), target: ref(event.target), aspect: event.aspect,
    startsAt: null, endsAt: null, clippedStart: event.clippedStart, clippedEnd: event.clippedEnd,
    allowedOrbDeg: event.allowedOrbDeg,
    passes: event.passes.map(({ state, residualDeg, toleranceDeg }) =>
      ({ at: hiddenMoment, state, residualDeg, toleranceDeg })),
  };
}

/** Derive every exported meaning from captured geometry and the built-in natal templates. */
function redactedNatalMeanings(
  chart: Chart,
  safeChartId: string,
  capturedAspects: readonly AspectFact[],
  rules: AspectRuleSetV0,
  engine: EphemeraEngine | undefined,
): readonly SymbolicMeaning[] {
  if (chart.time.kind === 'unknown-time' && !isLocalEphemeraEngine(engine)) return [];
  const isLongitude = (value: number) => Number.isFinite(value) && value >= 0 && value < 360;
  const available = availablePositions(chart.planets.status === 'available' ? chart.planets.value : []);
  const positions = new Map(PLANET_IDS.flatMap(planetId => {
    const point = available.get(planetId);
    return point && isLongitude(point.longitudeDeg) && typeof point.retrograde === 'boolean'
      ? [[planetId, point] as const] : [];
  }));
  const candidate = chart.houses.status === 'available' ? chart.houses.value : null;
  const houses = candidate && ['WholeSign', 'Placidus', 'Porphyry'].includes(candidate.effectiveSystem)
    && candidate.cusps.every((cusp, index) => cusp.houseId === index + 1)
    && orderedCusps(candidate.cusps.map(cusp => cusp.longitudeDeg))
    && isLongitude(candidate.ascendantDeg) && isLongitude(candidate.midheavenDeg)
    ? candidate : null;

  const chartId = 'natal';
  const capturedById = new Map(capturedAspects.map(fact => [fact.id, fact]));
  const aspects = calculateAspects([...positions].map(([planetId, point]) =>
    ({ chartId, planetId, longitudeDeg: point.longitudeDeg })), rules).filter(expected => {
    const id = aspectFactId(
      { chartId: safeChartId, planetId: expected.from.planetId },
      { chartId: safeChartId, planetId: expected.to.planetId },
      expected.aspect,
    );
    const captured = capturedById.get(id);
    return captured && captured.separationDeg === expected.separationDeg && captured.orbDeg === expected.orbDeg
      && captured.allowedOrbDeg === expected.allowedOrbDeg && captured.exactAngleDeg === expected.exactAngleDeg
      && captured.ruleSetVersion === expected.ruleSetVersion;
  });

  const reading = interpretNatalChart({
    chart: { ...chart, id: chartId, label: null, settings: { zodiac: 'tropical', requestedHouseSystem: null, observer: null } },
    positions, houses, aspects, engine,
    natalMoonState: null, dateOnlyMoonSummary: null, isDemo: false, birthSummary: '',
  });
  return natalSymbolicMeanings(reading, safeChartId);
}

/** Redaction omits exact epochs, birth inputs, chart labels, location and application IDs. */
export function createSnapshotV0(input: SnapshotInput, {
  redactBirthDetails = false, includeRedactedNatalSynthesis = false, dateOnlyEngine,
}: SnapshotOptions = {}): SnapshotV0 {
  if (input.aspectRules.version !== 0) throw new RangeError('Unsupported snapshot aspect rule set.');
  const idMap = new Map(input.charts.map((chart, index) =>
    [chart.id, redactBirthDetails ? `chart-${index + 1}` : chart.id] as const,
  ));
  if (idMap.size !== input.charts.length) throw new Error('Snapshot chart IDs must be unique.');
  const ref = ({ chartId, planetId }: PlanetRef): PlanetRef => {
    const id = idMap.get(chartId);
    if (id === undefined) throw new Error('Snapshot contains a reference to an unknown chart.');
    return { chartId: id, planetId };
  };

  const charts = input.charts.map((chart): SnapshotChart => {
    const { id, kind, label, time, settings, planets, houses } = chart;
    const warnings: ChartWarning[] = [...new Set([
      ...chart.warnings, ...(time.kind === 'resolved' ? time.warnings : []),
    ])].sort();
    return {
      id: idMap.get(id)!, kind,
      label: redactBirthDetails ? null : label,
      timeStatus: time.kind,
      time: redactBirthDetails ? null : time,
      settings: {
        zodiac: settings.zodiac,
        requestedHouseSystem: settings.requestedHouseSystem,
        observer: redactBirthDetails ? null : settings.observer,
      },
      planets, houses, warnings,
    };
  });

  const aspects = input.aspects.map((fact): AspectFact => {
    const from = ref(fact.from);
    const to = ref(fact.to);
    const { aspect, exactAngleDeg, separationDeg, orbDeg, allowedOrbDeg, ruleSetVersion } = fact;
    return {
      id: redactBirthDetails ? aspectFactId(from, to, aspect) : fact.id,
      from, to, aspect, exactAngleDeg, separationDeg, orbDeg, allowedOrbDeg, ruleSetVersion,
    };
  });
  const search = input.context.eventSearch;
  const context: SnapshotContext = {
    selectedAt: redactBirthDetails ? null : input.context.selectedAt,
    referenceAt: redactBirthDetails ? null : input.context.referenceAt,
    ...(input.context.eventSummary ? { eventSummary: input.context.eventSummary } : {}),
    eventSearch: search === null ? null : {
      start: redactBirthDetails ? hiddenMoment : search.start,
      end: redactBirthDetails ? hiddenMoment : search.end,
      events: search.events.map((event, index) => {
        if (redactBirthDetails) return redactEvent(event, `event-${index + 1}`, ref);
        if (event.kind === 'station') return { ...event, planet: ref(event.planet) };
        return { ...event, transit: ref(event.transit), target: ref(event.target) };
      }),
    },
  };
  const natal = redactBirthDetails && includeRedactedNatalSynthesis
    ? input.charts.find(chart => chart.kind === 'natal') : undefined;
  const interpretations = redactBirthDetails
    ? natal ? redactedNatalMeanings(natal, idMap.get(natal.id)!, aspects, input.aspectRules, dateOnlyEngine) : []
    : (input.interpretations ?? []).map(({ factId, tradition, ruleSetVersion, description, sources }) =>
      ({ factId, tradition, ruleSetVersion, description, sources: [...sources] }));

  const snapshot: SnapshotV0 = {
    schema: 'divine-orchestration/snapshot', schemaVersion: 0,
    privacy: redactBirthDetails ? 'birth-details-redacted' : 'full',
    engine: input.engine,
    aspectRules: createAspectRuleSet(input.aspectRules.orbsDeg),
    charts, aspects, context, interpretations,
  };
  // Copy so later edits to the source profile cannot change a captured export.
  return canonicalJson(snapshot) as unknown as SnapshotV0;
}

export function serializeSnapshot(snapshot: SnapshotV0): string {
  return JSON.stringify(canonicalJson(snapshot), null, 2) + '\n';
}

function escapeMarkdown(text: string) {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_\[\]|~]/g, '\\$&');
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    jdUt: 'JD UT1', jdTt: 'JD TT', utc: 'UTC', id: 'ID',
    chartId: 'Chart ID', planetId: 'Planet ID', houseId: 'House ID',
    deltaTYear: 'Delta-T year', deltaTSeconds: 'Delta-T seconds', deltaTSource: 'Delta-T source',
    taiMinusUtcSeconds: 'TAI minus UTC seconds', historicalUt1Iso: 'Historical UT1 approximation',
  };
  if (Object.hasOwn(labels, key)) return labels[key];
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced[0].toUpperCase() + spaced.slice(1);
}

function renderField(value: Json, depth: number, label?: string): string[] {
  const lead = `${'  '.repeat(depth)}- `;
  const prefix = label ? label + ' — ' : '';
  if (Array.isArray(value)) {
    return value.length ? [
      ...(label ? [lead + label] : []),
      ...value.flatMap((item, index) => renderField(item, depth + Number(Boolean(label)), String(index + 1))),
    ] : [lead + prefix + 'None'];
  }
  if (value !== null && typeof value === 'object') {
    return [
      ...(label ? [lead + label] : []),
      ...Object.entries(value).flatMap(([key, item]) => renderField(item, depth + Number(Boolean(label)), fieldLabel(key))),
    ];
  }
  return [lead + prefix + (value === null ? 'Unavailable' : escapeMarkdown(String(value)))];
}

export function renderSnapshotMarkdown(snapshot: SnapshotV0): string {
  const section = (heading: string, value: unknown) =>
    [`## ${heading}`, '', ...renderField(canonicalJson(value), 0), ''];
  return [
    '# Divine Orchestration snapshot',
    '',
    `- Schema — ${snapshot.schema}, version ${snapshot.schemaVersion}`,
    `- Privacy — ${snapshot.privacy}`,
    '',
    ...section('Selected dates and events', snapshot.context),
    ...section('Calculation provenance', snapshot.engine),
    ...section('Aspect rules', snapshot.aspectRules),
    ...section('Charts and calculated positions', snapshot.charts),
    ...section('Calculated aspects', snapshot.aspects),
    ...section('Symbolic interpretations', snapshot.interpretations),
  ].join('\n');
}
