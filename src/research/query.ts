import { createAspectRuleSet } from '../domain/aspects';
import type { AspectId, AspectRuleSetV0 } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { Chart, HouseId, PlanetId } from '../domain/chart';
import {
  ALL_ASPECT_IDS,
  ALL_HOUSE_IDS,
  ALL_RESEARCH_ANGLES,
  createThemeRegistry,
} from '../knowledge/research-themes';
import type { ResearchAngleId, ResearchThemePreset, ThemeRegistry } from '../knowledge/research-themes';
import type { FixedNatalPoint } from '../search/events';
import { MAX_GENERAL_RANGE_DAYS, MAX_SLOW_RANGE_DAYS, rangeRulesForBody } from '../search/range';
import type { EventRangeSearchRequest, RangeAngleId, RangeEvent, RangeOrbPolicy } from '../search/range';
import { isSlowBody, SLOW_PLANET_IDS } from '../search/series';
import type { ChartFactors, RulershipPolicy } from './chart-factors';

export type ResearchMode = 'everything' | 'themes' | 'custom';
export type RangePresetId = '30d' | '90d' | '12m' | '2y' | '5y' | '10y-slow' | 'custom';
export type RangeEventKind = RangeEvent['kind'];
export type QueryFetchScope = 'broad' | 'strict';

export const ALL_RANGE_EVENT_KINDS: readonly RangeEventKind[] = Object.freeze([
  'aspect-window',
  'angle-aspect-window',
  'house-ingress',
  'station',
]);

export const SUN_TO_PLUTO_BODIES: readonly PlanetId[] = Object.freeze(
  PLANET_IDS.filter(body => body !== 'moon'),
);

export interface ResearchQueryRange {
  readonly startDate: string; // YYYY-MM-DD (UTC midnight)
  readonly endDate: string;   // YYYY-MM-DD (UTC midnight)
  readonly preset: RangePresetId;
}

export interface ResearchQueryComputation {
  readonly transitingBodies: readonly PlanetId[];
  readonly orbPolicy: RangeOrbPolicy;
  readonly customOrbsDeg?: AspectRuleSetV0['orbsDeg'];
  readonly includeAngles: boolean;
  readonly includeHouseIngresses: boolean;
  readonly includeStations: boolean;
  /**
   * 'broad' fetches the full astronomical set for the range and bodies so theme/house tweaks
   * happen client-side and broader context is never discarded. 'strict' narrows U6A targets
   * to the resolved focus for lean custom computations.
   */
  readonly fetchScope: QueryFetchScope;
}

export interface ResearchQueryFocus {
  readonly activeThemeIds: readonly string[];
  readonly includeHouses: readonly HouseId[];
  readonly excludeHouses: readonly HouseId[];
  readonly includeRulers: boolean;
  readonly rulershipPolicy: RulershipPolicy;
  readonly includeHouseOccupants: boolean;
  readonly includeNatalPlanets: readonly PlanetId[];
  readonly excludeNatalPlanets: readonly PlanetId[];
  readonly excludeTransitingBodies: readonly PlanetId[];
  readonly includeAngles: readonly ResearchAngleId[];
  readonly excludeAngles: readonly ResearchAngleId[];
  readonly includeAspects: readonly AspectId[];
  readonly includeEventKinds: readonly RangeEventKind[];
  readonly exactOnly: boolean;
}

export interface ResearchContextPolicy {
  readonly retainBroaderContext: boolean;
  readonly highlightSlowContext: boolean;
}

export interface ResearchQuery {
  readonly version: 1;
  readonly mode: ResearchMode;
  readonly range: ResearchQueryRange;
  readonly computation: ResearchQueryComputation;
  readonly focus: ResearchQueryFocus;
  readonly contextPolicy: ResearchContextPolicy;
}

export type FocusDegradationMode = 'none' | 'planetary-significators-only' | 'stations-only';

export type DegradationNoticeCode =
  | 'unknown-birth-time-stations-only'
  | 'houses-unavailable-planetary-fallback'
  | 'requested-houses-or-angles-unavailable'
  | 'polar-house-fallback-active'
  | 'unknown-theme-id-ignored';

export interface DegradationNotice {
  readonly code: DegradationNoticeCode;
  readonly message: string;
}

export interface ResolvedResearchFocus {
  readonly mode: ResearchMode;
  readonly hasNarrowedFocus: boolean;
  /** True when the user requested house/angle focus that cannot be resolved on this chart and no fallback target resolved. */
  readonly unavailableFocus: boolean;
  readonly degradedMode: FocusDegradationMode;
  readonly notices: readonly DegradationNotice[];
  readonly activeThemes: readonly ResearchThemePreset[];
  readonly activeHouses: readonly HouseId[];
  readonly excludedHouses: readonly HouseId[];
  readonly houseToThemes: ReadonlyMap<HouseId, readonly string[]>;
  readonly occupantPlanets: readonly PlanetId[];
  readonly occupantToHouses: ReadonlyMap<PlanetId, readonly HouseId[]>;
  readonly traditionalRulerPlanets: readonly PlanetId[];
  readonly traditionalRulerToHouses: ReadonlyMap<PlanetId, readonly HouseId[]>;
  readonly modernCoRulerPlanets: readonly PlanetId[];
  readonly modernCoRulerToHouses: ReadonlyMap<PlanetId, readonly HouseId[]>;
  readonly naturalSignificatorToThemes: ReadonlyMap<PlanetId, readonly string[]>;
  readonly explicitNatalPlanets: readonly PlanetId[];
  readonly excludedNatalPlanets: readonly PlanetId[];
  readonly effectiveNatalPlanets: readonly PlanetId[];
  readonly excludedTransitingBodies: readonly PlanetId[];
  readonly effectiveTransitingBodies: readonly PlanetId[];
  readonly activeAngles: readonly ResearchAngleId[];
  readonly excludedAngles: readonly ResearchAngleId[];
  readonly angleToThemes: ReadonlyMap<ResearchAngleId, readonly string[]>;
  readonly activeAspects: readonly AspectId[];
  readonly activeEventKinds: readonly RangeEventKind[];
  readonly exactOnly: boolean;
}

export interface RangeSpanValidation {
  readonly ok: boolean;
  readonly slowBodiesOnly: boolean;
  readonly spanDays: number;
  readonly maxAllowedDays: number;
  readonly reason?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DUAL_ASPECT_PAIRS: readonly (readonly [AspectId, AspectId])[] = [
  ['conjunction', 'opposition'],
  ['sextile', 'trine'],
];

/**
 * Returns true if any requested body has differing orb allowances between opposite/dual aspects
 * (conjunction vs. opposition or sextile vs. trine), meaning DSC/IC windows must be solved directly
 * by U6A rather than projected from ASC/MC windows.
 */
export function hasAsymmetricDualOrbs(
  bodies: readonly PlanetId[],
  orbPolicy: RangeOrbPolicy,
  customOrbsDeg?: AspectRuleSetV0['orbsDeg'],
): boolean {
  const customRules = customOrbsDeg ? createAspectRuleSet(customOrbsDeg) : undefined;
  for (const body of bodies) {
    const rules = rangeRulesForBody(body, orbPolicy, customRules);
    for (const [a, b] of DUAL_ASPECT_PAIRS) {
      if (Math.abs(rules.orbsDeg[a] - rules.orbsDeg[b]) > 1e-9) {
        return true;
      }
    }
  }
  return false;
}

function dedupeOrdered<T>(values: readonly T[], canonical: readonly T[], name: string): readonly T[] {
  const seen = new Set<T>();
  for (const v of values) {
    if (!canonical.includes(v)) throw new RangeError(`Invalid ${name}: ${String(v)}.`);
    seen.add(v);
  }
  return Object.freeze(canonical.filter(v => seen.has(v)));
}

function validateDateString(date: string, label: string): string {
  if (!ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new RangeError(`Invalid ${label} date: ${date}. Expected YYYY-MM-DD.`);
  }
  return date;
}

export function validateQueryRangeSpan(
  transitingBodies: readonly PlanetId[],
  startTt: number,
  endTt: number,
): RangeSpanValidation {
  const slowBodiesOnly = transitingBodies.length > 0 && transitingBodies.every(isSlowBody);
  const maxAllowedDays = slowBodiesOnly ? MAX_SLOW_RANGE_DAYS : MAX_GENERAL_RANGE_DAYS;
  const spanDays = endTt - startTt;
  if (!Number.isFinite(startTt) || !Number.isFinite(endTt) || spanDays <= 0) {
    return { ok: false, slowBodiesOnly, spanDays, maxAllowedDays, reason: 'End date must be after start date.' };
  }
  if (!transitingBodies.length) {
    return { ok: false, slowBodiesOnly: false, spanDays, maxAllowedDays, reason: 'Select at least one transiting planet.' };
  }
  if (spanDays > maxAllowedDays + 1e-4) {
    return {
      ok: false,
      slowBodiesOnly,
      spanDays,
      maxAllowedDays,
      reason: slowBodiesOnly
        ? `Slow-planet range search supports at most ${MAX_SLOW_RANGE_DAYS} days (10 years).`
        : `General range search supports at most ${MAX_GENERAL_RANGE_DAYS} days (5 years). Restrict to Jupiter–Pluto for up to 10 years.`,
    };
  }
  return { ok: true, slowBodiesOnly, spanDays, maxAllowedDays };
}

export interface CreateResearchQueryInput {
  readonly mode: ResearchMode;
  readonly startDate: string;
  readonly endDate: string;
  readonly preset?: RangePresetId;
  readonly transitingBodies?: readonly PlanetId[];
  readonly includeMoon?: boolean;
  readonly orbPolicy?: RangeOrbPolicy;
  readonly customOrbsDeg?: Partial<Record<AspectId, number>>;
  readonly includeAngles?: boolean;
  readonly includeHouseIngresses?: boolean;
  readonly includeStations?: boolean;
  readonly fetchScope?: QueryFetchScope;
  readonly activeThemeIds?: readonly string[];
  readonly includeHouses?: readonly HouseId[];
  readonly excludeHouses?: readonly HouseId[];
  readonly includeRulers?: boolean;
  readonly rulershipPolicy?: RulershipPolicy;
  readonly includeHouseOccupants?: boolean;
  readonly includeNatalPlanets?: readonly PlanetId[];
  readonly excludeNatalPlanets?: readonly PlanetId[];
  readonly excludeTransitingBodies?: readonly PlanetId[];
  readonly includeFocusAngles?: readonly ResearchAngleId[];
  readonly excludeFocusAngles?: readonly ResearchAngleId[];
  readonly includeAspects?: readonly AspectId[];
  readonly includeEventKinds?: readonly RangeEventKind[];
  readonly exactOnly?: boolean;
  readonly retainBroaderContext?: boolean;
  readonly highlightSlowContext?: boolean;
}

/** Creates a validated, canonical ResearchQuery for any of the three locked research modes. */
export function createResearchQuery(input: CreateResearchQueryInput): ResearchQuery {
  const startDate = validateDateString(input.startDate, 'start');
  const endDate = validateDateString(input.endDate, 'end');
  if (endDate <= startDate) {
    throw new RangeError('Search end date must be after start date.');
  }

  const preset: RangePresetId = input.preset ?? 'custom';
  const defaultBodies = preset === '10y-slow'
    ? SLOW_PLANET_IDS
    : input.includeMoon === false
      ? SUN_TO_PLUTO_BODIES
      : PLANET_IDS;
  const rawBodies = input.transitingBodies ?? defaultBodies;
  const transitingBodies = dedupeOrdered(rawBodies, PLANET_IDS, 'transiting planet');
  if (!transitingBodies.length) {
    throw new RangeError('Select at least one transiting planet.');
  }

  const orbPolicy: RangeOrbPolicy = input.orbPolicy ?? 'transit-focused';
  const customOrbsDeg = input.customOrbsDeg
    ? createAspectRuleSet(input.customOrbsDeg).orbsDeg
    : undefined;

  const activeThemeIds = Object.freeze(
    [...new Set((input.activeThemeIds ?? []).map(id => id.trim().toLowerCase()).filter(Boolean))],
  );
  const includeHouses = dedupeOrdered(input.includeHouses ?? [], ALL_HOUSE_IDS, 'house');
  const excludeHouses = dedupeOrdered(input.excludeHouses ?? [], ALL_HOUSE_IDS, 'excluded house');
  const includeNatalPlanets = dedupeOrdered(input.includeNatalPlanets ?? [], PLANET_IDS, 'natal planet');
  const excludeNatalPlanets = dedupeOrdered(input.excludeNatalPlanets ?? [], PLANET_IDS, 'excluded natal planet');
  const excludeTransitingBodies = dedupeOrdered(input.excludeTransitingBodies ?? [], PLANET_IDS, 'excluded transiting planet');
  const includeFocusAngles = dedupeOrdered(input.includeFocusAngles ?? [], ALL_RESEARCH_ANGLES, 'angle');
  const excludeFocusAngles = dedupeOrdered(input.excludeFocusAngles ?? [], ALL_RESEARCH_ANGLES, 'excluded angle');
  const includeAnglesComp = input.includeAngles ?? true;
  const includeHouseIngressesComp = input.includeHouseIngresses ?? true;
  const includeStationsComp = input.includeStations ?? true;
  const defaultEventKinds: RangeEventKind[] = [
    'aspect-window',
    ...(includeAnglesComp ? ['angle-aspect-window' as const] : []),
    ...(includeHouseIngressesComp ? ['house-ingress' as const] : []),
    ...(includeStationsComp ? ['station' as const] : []),
  ];

  const includeAspects = dedupeOrdered(input.includeAspects ?? ALL_ASPECT_IDS, ALL_ASPECT_IDS, 'aspect');
  const includeEventKinds = dedupeOrdered(input.includeEventKinds ?? defaultEventKinds, ALL_RANGE_EVENT_KINDS, 'event kind');

  if (!includeAspects.length && includeEventKinds.some(k => k === 'aspect-window' || k === 'angle-aspect-window')) {
    throw new RangeError('Select at least one aspect when aspect windows are enabled.');
  }
  if (!includeEventKinds.length) {
    throw new RangeError('Select at least one event kind.');
  }

  return Object.freeze({
    version: 1 as const,
    mode: input.mode,
    range: Object.freeze({ startDate, endDate, preset }),
    computation: Object.freeze({
      transitingBodies,
      orbPolicy,
      ...(customOrbsDeg ? { customOrbsDeg } : {}),
      includeAngles: includeAnglesComp,
      includeHouseIngresses: includeHouseIngressesComp,
      includeStations: includeStationsComp,
      fetchScope: input.fetchScope ?? 'broad',
    }),
    focus: Object.freeze({
      activeThemeIds,
      includeHouses,
      excludeHouses,
      includeRulers: input.includeRulers ?? true,
      rulershipPolicy: input.rulershipPolicy ?? 'traditional',
      includeHouseOccupants: input.includeHouseOccupants ?? true,
      includeNatalPlanets,
      excludeNatalPlanets,
      excludeTransitingBodies,
      includeAngles: includeFocusAngles,
      excludeAngles: excludeFocusAngles,
      includeAspects,
      includeEventKinds,
      exactOnly: Boolean(input.exactOnly),
    }),
    contextPolicy: Object.freeze({
      retainBroaderContext: input.retainBroaderContext ?? true,
      highlightSlowContext: input.highlightSlowContext ?? true,
    }),
  });
}

export function createEverythingQuery(
  input: Omit<CreateResearchQueryInput, 'mode' | 'activeThemeIds' | 'includeHouses' | 'excludeHouses'>,
): ResearchQuery {
  return createResearchQuery({ ...input, mode: 'everything' });
}

export function createLifeThemesQuery(
  input: Omit<CreateResearchQueryInput, 'mode'>,
): ResearchQuery {
  return createResearchQuery({ ...input, mode: 'themes' });
}

export function createCustomSearchQuery(
  input: Omit<CreateResearchQueryInput, 'mode'>,
): ResearchQuery {
  return createResearchQuery({ ...input, mode: 'custom' });
}

function addMapItem<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const existing = map.get(key);
  if (!existing) map.set(key, [value]);
  else if (!existing.includes(value)) existing.push(value);
}

function freezeListMap<K, V>(map: Map<K, V[]>): ReadonlyMap<K, readonly V[]> {
  return new Map([...map.entries()].map(([k, v]) => [k, Object.freeze([...v])]));
}

/**
 * Expands a canonical ResearchQuery against the active chart's resolved factors and editable
 * ThemeRegistry. Applies explicit exclusions on top of presets and degrades honestly when
 * birth time is unknown or birthplace coordinates are missing.
 */
export function resolveResearchFocus(
  query: ResearchQuery,
  chartFactors: ChartFactors,
  registry: ThemeRegistry = createThemeRegistry(),
): ResolvedResearchFocus {
  const notices: DegradationNotice[] = [];
  const activeThemes: ResearchThemePreset[] = [];

  for (const themeId of query.focus.activeThemeIds) {
    const preset = registry.get(themeId);
    if (preset) activeThemes.push(preset);
    else {
      notices.push({
        code: 'unknown-theme-id-ignored',
        message: `Theme preset “${themeId}” was not found in the active registry and was skipped.`,
      });
    }
  }

  let degradedMode: FocusDegradationMode = 'none';
  if (!chartFactors.availability.natalPositionsAvailable) {
    degradedMode = 'stations-only';
    notices.push({
      code: 'unknown-birth-time-stations-only',
      message:
        'Birth time is unknown: exact transit-to-natal aspect windows, angle contacts and house crossings cannot be calculated. Planetary stations remain available.',
    });
  } else if (!chartFactors.availability.housesAvailable) {
    degradedMode = 'planetary-significators-only';
    notices.push({
      code: 'houses-unavailable-planetary-fallback',
      message:
        'Natal houses and angles are unavailable without birthplace coordinates. Theme links use planetary natural significators and explicit natal planet targets only.',
    });
  } else if (chartFactors.availability.polarHouseFallback) {
    notices.push({
      code: 'polar-house-fallback-active',
      message: 'Placidus houses are undefined at this latitude; house crossings and cusp rulers use Porphyry fallback.',
    });
  }

  const excludedHouseSet = new Set<HouseId>(query.focus.excludeHouses);
  const excludedNatalSet = new Set<PlanetId>(query.focus.excludeNatalPlanets);
  const excludedTransitSet = new Set<PlanetId>(query.focus.excludeTransitingBodies);
  const excludedAngleSet = new Set<ResearchAngleId>(query.focus.excludeAngles);

  const houseToThemes = new Map<HouseId, string[]>();
  const angleToThemes = new Map<ResearchAngleId, string[]>();
  const naturalSignificatorToThemes = new Map<PlanetId, string[]>();

  const candidateHouses = new Set<HouseId>();
  const candidateAngles = new Set<ResearchAngleId>();

  for (const theme of activeThemes) {
    for (const h of theme.houses) {
      if (!excludedHouseSet.has(h)) {
        candidateHouses.add(h);
        addMapItem(houseToThemes, h, theme.id);
      }
    }
    for (const a of theme.angles) {
      if (!excludedAngleSet.has(a)) {
        candidateAngles.add(a);
        addMapItem(angleToThemes, a, theme.id);
      }
    }
    for (const p of theme.naturalSignificators) {
      if (!excludedNatalSet.has(p)) {
        addMapItem(naturalSignificatorToThemes, p, theme.id);
      }
    }
  }

  for (const h of query.focus.includeHouses) {
    if (!excludedHouseSet.has(h)) candidateHouses.add(h);
  }
  for (const a of query.focus.includeAngles) {
    if (!excludedAngleSet.has(a)) candidateAngles.add(a);
  }

  const activeHouses: readonly HouseId[] = chartFactors.availability.housesAvailable
    ? Object.freeze(ALL_HOUSE_IDS.filter(h => candidateHouses.has(h)))
    : Object.freeze([]);

  // Include cardinal angles linked to directly selected houses (H1=ASC, H4=IC, H7=DSC, H10=MC)
  // unless explicitly excluded.
  if (chartFactors.availability.housesAvailable && chartFactors.houses) {
    for (const h of activeHouses) {
      const axis = chartFactors.houses[h - 1]?.axisAngle;
      if (axis && !excludedAngleSet.has(axis)) {
        candidateAngles.add(axis);
        for (const themeId of houseToThemes.get(h) ?? []) {
          addMapItem(angleToThemes, axis, themeId);
        }
      }
    }
  }

  const activeAngles: readonly ResearchAngleId[] = chartFactors.availability.housesAvailable
    ? Object.freeze(ALL_RESEARCH_ANGLES.filter(a => candidateAngles.has(a)))
    : Object.freeze([]);

  const occupantToHouses = new Map<PlanetId, HouseId[]>();
  const traditionalRulerToHouses = new Map<PlanetId, HouseId[]>();
  const modernCoRulerToHouses = new Map<PlanetId, HouseId[]>();

  if (chartFactors.availability.housesAvailable && chartFactors.houses) {
    for (const h of activeHouses) {
      const hf = chartFactors.houses[h - 1];
      if (!hf) continue;
      if (query.focus.includeHouseOccupants) {
        for (const occupant of hf.occupants) {
          if (!excludedNatalSet.has(occupant)) {
            addMapItem(occupantToHouses, occupant, h);
          }
        }
      }
      if (query.focus.includeRulers) {
        if (!excludedNatalSet.has(hf.traditionalRuler)) {
          addMapItem(traditionalRulerToHouses, hf.traditionalRuler, h);
        }
        if (
          query.focus.rulershipPolicy === 'traditional-plus-modern' &&
          hf.modernCoRuler &&
          hf.modernCoRuler !== hf.traditionalRuler &&
          !excludedNatalSet.has(hf.modernCoRuler)
        ) {
          addMapItem(modernCoRulerToHouses, hf.modernCoRuler, h);
        }
      }
    }
  }

  const explicitNatalPlanets = Object.freeze(
    query.focus.includeNatalPlanets.filter(p => !excludedNatalSet.has(p)),
  );

  const effectiveNatalSet = new Set<PlanetId>([
    ...explicitNatalPlanets,
    ...occupantToHouses.keys(),
    ...traditionalRulerToHouses.keys(),
    ...modernCoRulerToHouses.keys(),
  ]);
  // In no-house fallback, natural significators of active themes become primary natal targets too.
  if (degradedMode === 'planetary-significators-only') {
    for (const p of naturalSignificatorToThemes.keys()) effectiveNatalSet.add(p);
  }

  const effectiveNatalPlanets = Object.freeze(PLANET_IDS.filter(p => effectiveNatalSet.has(p)));
  const effectiveTransitingBodies = Object.freeze(
    query.computation.transitingBodies.filter(b => !excludedTransitSet.has(b)),
  );

  const requestedHouseOrAngle =
    query.focus.includeHouses.length > 0 || query.focus.includeAngles.length > 0;
  const unavailableFocus =
    !chartFactors.availability.housesAvailable &&
    requestedHouseOrAngle &&
    activeThemes.length === 0 &&
    explicitNatalPlanets.length === 0;

  if (!chartFactors.availability.housesAvailable && requestedHouseOrAngle) {
    notices.push({
      code: 'requested-houses-or-angles-unavailable',
      message:
        'Selected houses or angles cannot be resolved because natal houses are unavailable. Calculated sky/natal events remain available as broader astronomical context.',
    });
  }

  const hasNarrowedFocus =
    query.mode !== 'everything' ||
    activeThemes.length > 0 ||
    query.focus.includeHouses.length > 0 ||
    query.focus.excludeHouses.length > 0 ||
    query.focus.includeNatalPlanets.length > 0 ||
    query.focus.excludeNatalPlanets.length > 0 ||
    query.focus.excludeTransitingBodies.length > 0 ||
    query.focus.includeAngles.length > 0 ||
    query.focus.excludeAngles.length > 0 ||
    query.focus.includeAspects.length < ALL_ASPECT_IDS.length ||
    query.focus.includeEventKinds.length < ALL_RANGE_EVENT_KINDS.length ||
    query.focus.exactOnly;

  return Object.freeze({
    mode: query.mode,
    hasNarrowedFocus,
    unavailableFocus,
    degradedMode,
    notices: Object.freeze(notices),
    activeThemes: Object.freeze(activeThemes),
    activeHouses,
    excludedHouses: query.focus.excludeHouses,
    houseToThemes: freezeListMap(houseToThemes),
    occupantPlanets: Object.freeze(PLANET_IDS.filter(p => occupantToHouses.has(p))),
    occupantToHouses: freezeListMap(occupantToHouses),
    traditionalRulerPlanets: Object.freeze(PLANET_IDS.filter(p => traditionalRulerToHouses.has(p))),
    traditionalRulerToHouses: freezeListMap(traditionalRulerToHouses),
    modernCoRulerPlanets: Object.freeze(PLANET_IDS.filter(p => modernCoRulerToHouses.has(p))),
    modernCoRulerToHouses: freezeListMap(modernCoRulerToHouses),
    naturalSignificatorToThemes: freezeListMap(naturalSignificatorToThemes),
    explicitNatalPlanets,
    excludedNatalPlanets: query.focus.excludeNatalPlanets,
    effectiveNatalPlanets,
    excludedTransitingBodies: query.focus.excludeTransitingBodies,
    effectiveTransitingBodies,
    activeAngles,
    excludedAngles: query.focus.excludeAngles,
    angleToThemes: freezeListMap(angleToThemes),
    activeAspects: query.focus.includeAspects,
    activeEventKinds: query.focus.includeEventKinds,
    exactOnly: query.focus.exactOnly,
  });
}

export interface BuildRangeRequestOptions {
  readonly startTt: number;
  readonly endTt: number;
  readonly referenceTt: number | null;
  readonly transitChartId?: string;
  readonly chunkDays?: number;
}

/**
 * Translates a canonical ResearchQuery + active Chart into U6A's verified EventRangeSearchRequest.
 * Defaults to broad astronomical fetch so client-side theme/house filtering is instant and
 * broader astronomical context is preserved without a second worker search.
 */
export function buildRangeSearchRequest(
  query: ResearchQuery,
  chart: Chart,
  focus: ResolvedResearchFocus,
  options: BuildRangeRequestOptions,
): EventRangeSearchRequest {
  const transitChartId = options.transitChartId ?? 'transit';
  const bodies = query.computation.fetchScope === 'strict' && focus.effectiveTransitingBodies.length > 0
    ? focus.effectiveTransitingBodies
    : query.computation.transitingBodies;

  const spanCheck = validateQueryRangeSpan(bodies, options.startTt, options.endTt);
  if (!spanCheck.ok) {
    throw new RangeError(spanCheck.reason ?? 'Invalid research search range.');
  }

  const natalPosById = new Map<PlanetId, number | null>(PLANET_IDS.map(p => [p, null]));
  if (chart.planets.status === 'available') {
    for (const fact of chart.planets.value) {
      natalPosById.set(
        fact.planetId,
        fact.position.status === 'available' ? fact.position.value.longitudeDeg : null,
      );
    }
  }

  const strictTargets =
    query.computation.fetchScope === 'strict' &&
    focus.hasNarrowedFocus &&
    focus.effectiveNatalPlanets.length > 0;
  const targetPlanetIds = strictTargets ? focus.effectiveNatalPlanets : PLANET_IDS;
  const targets: readonly FixedNatalPoint[] = targetPlanetIds.map(planetId => ({
    chartId: chart.id,
    planetId,
    longitudeDeg: natalPosById.get(planetId) ?? null,
  }));

  const houses = chart.houses.status === 'available' ? chart.houses.value : null;

  let includeAngles: boolean | readonly RangeAngleId[] = false;
  if (query.computation.includeAngles && houses !== null) {
    if (query.computation.fetchScope === 'strict' && focus.hasNarrowedFocus) {
      includeAngles = focus.activeAngles.length ? [...focus.activeAngles] : false;
    } else if (hasAsymmetricDualOrbs(bodies, query.computation.orbPolicy, query.computation.customOrbsDeg)) {
      includeAngles = [...ALL_RESEARCH_ANGLES];
    } else {
      includeAngles = ['asc', 'mc'];
    }
  }

  const wantsIngresses = query.computation.includeHouseIngresses && houses !== null;
  const targetHouses: readonly HouseId[] | undefined = wantsIngresses
    ? query.computation.fetchScope === 'strict' && focus.hasNarrowedFocus && focus.activeHouses.length > 0
      ? focus.activeHouses
      : ALL_HOUSE_IDS
    : undefined;

  return {
    startTt: options.startTt,
    endTt: options.endTt,
    referenceTt: options.referenceTt,
    transitChartId,
    targetChartId: chart.id,
    bodies,
    targets,
    houses,
    includeAngles,
    includeHouseIngresses: wantsIngresses,
    ...(targetHouses ? { targetHouses } : {}),
    orbPolicy: query.computation.orbPolicy,
    ...(query.computation.customOrbsDeg ? { rules: createAspectRuleSet(query.computation.customOrbsDeg) } : {}),
    ...(options.chunkDays !== undefined ? { chunkDays: options.chunkDays } : {}),
  };
}
