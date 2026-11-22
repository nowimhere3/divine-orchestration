import { calculateAspects, createAspectRuleSet } from '../domain/aspects';
import type { Chart, Fact, HouseFacts, PlanetFact, PlanetPosition, TimedChart, Unavailable } from '../domain/chart';
import type { EphemeraEngine } from '../engine/ephemera';
import { BUILT_IN_RESEARCH_THEMES, RESEARCH_THEME_RULE_SET_VERSION } from '../knowledge/research-themes';
import { resolveChartFactors } from '../research/chart-factors';
import type { ChartFactors, RulershipPolicy } from '../research/chart-factors';
import { ALL_RANGE_EVENT_KINDS } from '../research/query';
import type { ResearchSession } from '../research/session';
import type { EventRangeSearchResult, RangeSearchWarning } from '../search/range';
import { angle, aspect, house, houseSystem, knownValue, planet, projectBirthTime, projectReference } from './research-privacy';
import type { ProjectMoment, ResearchExportPrivacy } from './research-privacy';
import { createSnapshotV0, isSnapshotChartWarning } from './snapshot';
import type { SnapshotInput } from './snapshot';

export interface ResearchInterpretationContext {
  readonly includeNatal?: boolean;
  readonly selectedTransitChart?: TimedChart;
  /** Optional bundled ephemeris for a U5A date-only reading. */
  readonly dateOnlyEngine?: EphemeraEngine;
}

export function themeAliases(session: ResearchSession): ReadonlyMap<string, string> {
  return new Map(session.query.focus.activeThemeIds.map((id, index) => [id, `theme-${index + 1}`]));
}

function unavailableReason(reason: Unavailable['reason'] | null) {
  return knownValue([
    'unknown-birth-time', 'missing-location', 'invalid-input', 'outside-coverage',
    'unsupported-body', 'calculation-unavailable', null,
  ] as const, reason);
}

export function exportChartFactors(factors: ChartFactors, session: ResearchSession, focused: boolean, sensitivityNotes: readonly string[]) {
  const { availability, chartRuler } = factors;
  const narrowed = focused && session.focus.hasNarrowedFocus;
  return {
    chartId: 'chart-1',
    rulershipPolicy: knownValue<RulershipPolicy>(['traditional', 'traditional-plus-modern'], factors.rulershipPolicy),
    availability: {
      natalPositionsAvailable: availability.natalPositionsAvailable,
      natalUnavailableReason: unavailableReason(availability.natalUnavailableReason),
      housesAvailable: availability.housesAvailable,
      housesUnavailableReason: unavailableReason(availability.housesUnavailableReason),
      effectiveHouseSystem: houseSystem(availability.effectiveHouseSystem),
      polarHouseFallback: availability.polarHouseFallback,
      timeStatus: knownValue(['resolved', 'unknown-time'], availability.timeStatus),
    },
    houses: factors.houses?.filter(item => !narrowed || session.focus.activeHouses.includes(item.houseId)).map(item => ({
      houseId: house(item.houseId), cuspLongitudeDeg: item.cuspLongitudeDeg, cuspSignIndex: item.cuspSignIndex,
      interceptedSignIndices: [...item.interceptedSignIndices], traditionalRuler: planet(item.traditionalRuler),
      modernCoRuler: item.modernCoRuler === null ? null : planet(item.modernCoRuler),
      activeRulers: item.activeRulers.map(planet), occupants: item.occupants.map(planet),
      axisAngle: item.axisAngle === null ? null : angle(item.axisAngle),
    })) ?? null,
    angles: factors.angles ? Object.values(factors.angles)
      .filter(item => !narrowed || session.focus.activeAngles.includes(item.angle))
      .map(item => ({
        angle: angle(item.angle), longitudeDeg: item.longitudeDeg, signIndex: item.signIndex,
        houseId: house(item.houseId), oppositeAngle: angle(item.oppositeAngle),
        solverAngle: angle(item.solverAngle), isDerivedOpposite: item.isDerivedOpposite,
      })) : null,
    chartRuler: chartRuler === null ? null : {
      traditional: planet(chartRuler.traditional),
      modernCoRuler: chartRuler.modernCoRuler === null ? null : planet(chartRuler.modernCoRuler),
      ascSignIndex: chartRuler.ascSignIndex,
    },
    natalPlanets: factors.natalPlanets.filter(item => !narrowed ||
      session.focus.effectiveNatalPlanets.includes(item.planetId) ||
      session.focus.naturalSignificatorToThemes.has(item.planetId)).map(item => ({
      planetId: planet(item.planetId), longitudeDeg: item.longitudeDeg, signIndex: item.signIndex,
      retrograde: item.retrograde, houseId: item.houseId === null ? null : house(item.houseId),
      rulesHousesTraditional: item.rulesHousesTraditional.map(house), rulesHousesModern: item.rulesHousesModern.map(house),
    })),
    sensitivityNotes,
  };
}

export function exportQuery(session: ResearchSession, privacy: ResearchExportPrivacy, aliases: ReadonlyMap<string, string>) {
  const { query, focus } = session;
  const { computation } = query;
  const date = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Invalid research query date.');
    return value;
  };
  return {
    version: 1 as const,
    mode: knownValue(['everything', 'themes', 'custom'], query.mode),
    range: {
      preset: knownValue(['30d', '90d', '12m', '2y', '5y', '10y-slow', 'custom'], query.range.preset),
      ...(privacy.eventDates === 'calendar' ? { startDate: date(query.range.startDate), endDate: date(query.range.endDate) } : {}),
    },
    computation: {
      transitingBodies: computation.transitingBodies.map(planet),
      orbPolicy: knownValue(['transit-focused', 'chart-v0', 'custom'], computation.orbPolicy),
      ...(computation.customOrbsDeg ? { customOrbsDeg: createAspectRuleSet(computation.customOrbsDeg).orbsDeg } : {}),
      includeAngles: computation.includeAngles, includeHouseIngresses: computation.includeHouseIngresses,
      includeStations: computation.includeStations, fetchScope: knownValue(['broad', 'strict'], computation.fetchScope),
    },
    focus: {
      activeThemeIds: [...aliases.values()],
      includeHouses: query.focus.includeHouses.map(house), excludeHouses: query.focus.excludeHouses.map(house),
      includeRulers: query.focus.includeRulers,
      rulershipPolicy: knownValue(['traditional', 'traditional-plus-modern'], query.focus.rulershipPolicy),
      includeHouseOccupants: query.focus.includeHouseOccupants,
      includeNatalPlanets: query.focus.includeNatalPlanets.map(planet), excludeNatalPlanets: query.focus.excludeNatalPlanets.map(planet),
      excludeTransitingBodies: query.focus.excludeTransitingBodies.map(planet),
      includeAngles: query.focus.includeAngles.map(angle), excludeAngles: query.focus.excludeAngles.map(angle),
      includeAspects: query.focus.includeAspects.map(aspect), includeEventKinds: query.focus.includeEventKinds.map(k => knownValue(ALL_RANGE_EVENT_KINDS, k)),
      exactOnly: query.focus.exactOnly,
    },
    contextPolicy: {
      retainBroaderContext: query.contextPolicy.retainBroaderContext,
      highlightSlowContext: query.contextPolicy.highlightSlowContext,
    },
    resolvedFocus: {
      hasNarrowedFocus: focus.hasNarrowedFocus, unavailableFocus: focus.unavailableFocus,
      degradedMode: knownValue(['none', 'planetary-significators-only', 'stations-only'], focus.degradedMode),
      notices: focus.notices.map(({ code }) => knownValue([
        'unknown-birth-time-stations-only', 'houses-unavailable-planetary-fallback',
        'requested-houses-or-angles-unavailable', 'polar-house-fallback-active', 'unknown-theme-id-ignored',
      ], code)),
      activeHouses: focus.activeHouses.map(house), activeAngles: focus.activeAngles.map(angle),
      effectiveNatalPlanets: focus.effectiveNatalPlanets.map(planet),
      effectiveTransitingBodies: focus.effectiveTransitingBodies.map(planet),
    },
  };
}

export function exportThemes(session: ResearchSession, aliases: ReadonlyMap<string, string>) {
  return {
    ruleSetVersion: RESEARCH_THEME_RULE_SET_VERSION,
    convention: 'Theme-to-house and planetary groupings are editable astrological conventions.',
    definitions: [...aliases].map(([original, id], index) => {
      const theme = session.themeSnapshot.find(item => item.id === original);
      const builtIn = BUILT_IN_RESEARCH_THEMES.find(item => item.id === original);
      return {
        id, label: builtIn?.label ?? `Theme ${index + 1}`, resolved: theme !== undefined,
        houses: theme?.houses.map(house) ?? [],
        naturalSignificators: theme?.naturalSignificators.map(planet) ?? [],
        angles: theme?.angles.map(angle) ?? [],
        preferredAspects: theme?.preferredAspects?.map(aspect) ?? [],
      };
    }),
  };
}

const RANGE_WARNINGS: readonly RangeSearchWarning[] = [
  'near-coverage-edge', 'polar-house-fallback', 'search-clamped-to-coverage', 'crossing-uses-modeled-delta-t',
  'modeled-delta-t', 'future-utc-assumption', 'utc-unavailable', 'interval-clipped',
];

export function exportCalculation(
  raw: EventRangeSearchResult, moment: ProjectMoment, eventDates: ResearchExportPrivacy['eventDates'],
  engine: SnapshotInput['engine'],
) {
  const { range, settings, provenance } = raw;
  return {
    status: knownValue(['complete', 'partial', 'unavailable'], raw.status),
    reason: knownValue(['outside-coverage', 'no-calculable-bodies', null], raw.reason ?? null),
    coverage: {
      requestedStart: moment(range.requestedStart), requestedEnd: moment(range.requestedEnd),
      effectiveStart: moment(range.effectiveStart), effectiveEnd: moment(range.effectiveEnd),
      reference: projectReference(settings.referenceTt, moment, eventDates),
      requestedDays: range.requestedDays, effectiveDays: range.effectiveDays, chunkCount: range.chunkCount,
      chunkDays: range.chunkDays, clippedToCoverage: range.clippedToCoverage,
      slowBodiesOnly: range.slowBodiesOnly, maxAllowedDays: range.maxAllowedDays,
      coversRequestedInterval: range.effectiveDays > 0 && !range.clippedToCoverage,
    },
    settings: {
      bodies: settings.bodies.map(planet),
      natalTargets: settings.targets.map(item => ({ planetId: planet(item.planetId), longitudeDeg: item.longitudeDeg })),
      angles: settings.angles.map(angle), includeHouseIngresses: settings.includeHouseIngresses,
      targetHouses: settings.targetHouses.map(house), orbPolicy: knownValue(['transit-focused', 'chart-v0', 'custom'], settings.orbPolicy),
    },
    warnings: raw.warnings.filter(warning => RANGE_WARNINGS.includes(warning)),
    unavailable: raw.unavailable.map(item => item.kind === 'houses'
      ? { kind: item.kind, reason: 'houses-unavailable' as const }
      : {
        kind: knownValue(['natal-position', 'transit-body'], item.kind), planetId: planet(item.point.planetId),
        reason: [
          'position-unavailable', 'invalid-input', 'outside-coverage', 'unsupported-body',
          'calculation-unavailable', 'no-event-returned',
        ].find(reason => item.reason === reason) ?? 'calculation-unavailable',
      }),
    provenance: {
      engine, deltaTSource: 'ephemera-model' as const, contactToleranceDeg: provenance.contactToleranceDeg,
      refinementSeconds: provenance.refinementSeconds, stationToleranceDegPerDay: provenance.stationToleranceDegPerDay,
    },
  };
}

function projectFact<T>(fact: Fact<T>, project: (value: T) => T): Fact<T> {
  return fact.status === 'available'
    ? { status: 'available', value: project(fact.value) }
    : { status: 'unavailable', reason: unavailableReason(fact.reason)! };
}

function projectPosition(value: PlanetPosition): PlanetPosition {
  return {
    longitudeDeg: value.longitudeDeg, latitudeDeg: value.latitudeDeg, distanceAu: value.distanceAu,
    longitudeSpeedDegPerDay: value.longitudeSpeedDegPerDay, latitudeSpeedDegPerDay: value.latitudeSpeedDegPerDay,
    distanceSpeedAuPerDay: value.distanceSpeedAuPerDay, retrograde: value.retrograde,
  };
}

function projectHouses(value: HouseFacts): HouseFacts {
  return {
    effectiveSystem: houseSystem(value.effectiveSystem)!,
    cusps: value.cusps.map(item => ({ houseId: house(item.houseId), longitudeDeg: item.longitudeDeg })),
    ascendantDeg: value.ascendantDeg, midheavenDeg: value.midheavenDeg, fallback: value.fallback,
  };
}

function projectChart(chart: Chart, id: string): Chart {
  const { observer } = chart.settings;
  const common = {
    id, label: null, settings: {
      zodiac: 'tropical' as const, requestedHouseSystem: houseSystem(chart.settings.requestedHouseSystem),
      observer: observer === null ? null : { latitudeDeg: observer.latitudeDeg, longitudeDeg: observer.longitudeDeg },
    },
    warnings: chart.warnings.filter(isSnapshotChartWarning),
  };
  const projected = projectBirthTime(chart.time);
  const time = projected.kind === 'resolved'
    ? { ...projected, warnings: projected.warnings.filter(isSnapshotChartWarning) }
    : projected;
  if (time.kind === 'unknown-time') {
    const unavailable = { status: 'unavailable', reason: 'unknown-birth-time' } as const;
    return { ...common, kind: 'natal', time, planets: unavailable, houses: unavailable };
  }
  const planets = projectFact<readonly PlanetFact[]>(chart.planets, facts => facts.map(item => ({
    planetId: planet(item.planetId), position: projectFact(item.position, projectPosition),
  })));
  return {
    ...common, kind: knownValue(['natal', 'transit'], chart.kind), time, planets,
    houses: projectFact(chart.houses, projectHouses),
  };
}

export function exportChartContext(
  chart: Chart, session: ResearchSession, privacy: ResearchExportPrivacy, moment: ProjectMoment,
  context: ResearchInterpretationContext = {},
) {
  const natal = projectChart(chart, 'chart-1');
  const transit = context.selectedTransitChart ? projectChart(context.selectedTransitChart, 'chart-2') : null;
  if (transit && (transit.kind !== 'transit' || transit.time.kind !== 'resolved')) {
    throw new TypeError('Selected-moment interpretation requires a resolved transit chart.');
  }
  const aspectRules = createAspectRuleSet();
  const points = (item: Chart) => item.planets.status === 'available'
    ? item.planets.value.flatMap(fact => fact.position.status === 'available'
      ? [{ chartId: item.id, planetId: fact.planetId, longitudeDeg: fact.position.value.longitudeDeg }] : [])
    : [];
  const base = {
    engine: session.rawResult.provenance.engine, aspectRules, charts: [natal],
    aspects: calculateAspects(points(natal), aspectRules),
    context: { selectedAt: null, referenceAt: null, eventSearch: null },
  };
  const safeNatal = createSnapshotV0(base, {
    redactBirthDetails: true, includeRedactedNatalSynthesis: context.includeNatal,
    dateOnlyEngine: context.dateOnlyEngine,
  });
  const snapshot = privacy.birthDetails === 'redacted' ? safeNatal : createSnapshotV0({
    ...base, engine: safeNatal.engine, interpretations: safeNatal.interpretations,
  });
  const sensitivityNotes = resolveChartFactors(natal, { rulershipPolicy: session.chartFactors.rulershipPolicy }).sensitivityNotes;
  const synthesisStatus: 'not-requested' | 'included' | 'unavailable' = !context.includeNatal
    ? 'not-requested' : snapshot.interpretations.length ? 'included' : 'unavailable';
  if (!transit || transit.time.kind !== 'resolved') {
    return { snapshot, sensitivityNotes, synthesisStatus, selectedMomentTransit: null };
  }
  const aspects = calculateAspects([...points(natal), ...points(transit)], aspectRules)
    .filter(fact => fact.from.chartId !== fact.to.chartId);
  const selected = createSnapshotV0({ ...base, charts: [natal, transit], aspects }, {
    redactBirthDetails: true, includeRedactedTransitSynthesis: true, dateOnlyEngine: context.dateOnlyEngine,
  });
  return {
    snapshot, sensitivityNotes, synthesisStatus,
    selectedMomentTransit: {
      scope: 'selected-moment' as const, status: selected.interpretations.length ? 'included' as const : 'unavailable' as const,
      at: moment(transit.time), transitChartId: 'chart-2',
      interpretations: selected.interpretations,
    },
  };
}
