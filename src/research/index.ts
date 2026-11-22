export {
  ALL_ASPECT_IDS,
  ALL_HOUSE_IDS,
  ALL_RESEARCH_ANGLES,
  BUILT_IN_RESEARCH_THEMES,
  createThemeRegistry,
  HOUSE_AREA_DESCRIPTORS,
  houseAreaDescriptor,
  normalizeThemePreset,
  RESEARCH_THEME_RULE_SET_VERSION,
  THEME_CONVENTION_DISCLAIMER,
} from '../knowledge/research-themes';
export type {
  HouseAreaDescriptor,
  ResearchAngleId,
  ResearchThemePreset,
  ThemePresetInput,
  ThemeRegistry,
  ThemeRegistryCustomizations,
} from '../knowledge/research-themes';

export {
  findInterceptedSigns,
  houseFactorOf,
  natalPlanetFactorOf,
  projectAngleAspectAxes,
  resolveChartFactors,
  solverAngleFor,
} from './chart-factors';
export type {
  AngleAspectAxisProjection,
  AngleFactor,
  ChartFactorAvailability,
  ChartFactors,
  HouseFactor,
  NatalPlanetFactor,
  RulershipPolicy,
} from './chart-factors';

export {
  ALL_RANGE_EVENT_KINDS,
  buildRangeSearchRequest,
  createCustomSearchQuery,
  createEverythingQuery,
  createLifeThemesQuery,
  createResearchQuery,
  hasAsymmetricDualOrbs,
  resolveResearchFocus,
  SUN_TO_PLUTO_BODIES,
  validateQueryRangeSpan,
} from './query';
export type {
  BuildRangeRequestOptions,
  CreateResearchQueryInput,
  DegradationNotice,
  DegradationNoticeCode,
  FocusDegradationMode,
  QueryFetchScope,
  RangeEventKind,
  RangePresetId,
  RangeSpanValidation,
  ResearchContextPolicy,
  ResearchMode,
  ResearchQuery,
  ResearchQueryComputation,
  ResearchQueryFocus,
  ResearchQueryRange,
  ResolvedResearchFocus,
} from './query';

export {
  evaluateResearchEvents,
  mergeAxisContacts,
  sortByRelevance,
} from './relevance';
export type {
  AxisCompanion,
  AxisMergeResult,
  EvaluateResearchOptions,
  EvaluatedEvent,
  EvaluatedResearchCounts,
  EvaluatedResearchResult,
  EventRelevance,
  RelevanceCategory,
  RelevanceReason,
  RelevanceReasonCode,
  RelevanceReasonParams,
  RelevanceTier,
} from './relevance';

export {
  canReuseSessionComputation,
  computeChartSignature,
  computeRangeCacheKey,
  createResearchSession,
  isSessionCompatibleWithChart,
  prepareExportHandoff,
  reEvaluateResearchSession,
} from './session';
export type {
  CreateResearchSessionInput,
  ResearchExportHandoff,
  ResearchSession,
} from './session';

export { retimeEvent, retimeRangeResult } from './timing';

export { PERSONAL_IMPACT_BANDS, PERSONAL_IMPACT_MODEL, scoreResearchImpact } from './impact';
export type {
  ImpactEvidence,
  ImpactMissingData,
  ImpactWindowEvidence,
  PersonalImpactResult,
  PersonalImpactScore,
} from './impact';

export { findResearchConvergences } from './convergence';
export type {
  ConvergenceCoincidence,
  ConvergenceMarker,
  ConvergenceOptions,
  ConvergencePeriod,
  ConvergenceResult,
  ConvergenceSegment,
} from './convergence';
