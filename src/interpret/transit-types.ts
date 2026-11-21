import type { AspectFact, AspectId } from '../domain/aspects';
import type { Chart, HouseFacts, HouseId, PlanetId } from '../domain/chart';
import type { AspectTone, SourceId } from '../knowledge';
import type { MoonState } from '../lunar';
import type { PositionMap } from '../view/chart-data';
import type { AngleId, DateOnlyNatalFacts, FactCitation, OverviewSection, ReflectionPrompt } from './types';

export type TransitMotionState = 'applying' | 'separating' | 'exact' | 'stationary';
export type TransitBucket = 'long-term' | 'medium-term' | 'lunar-brief';
export type TransitReadingMode = 'complete' | 'no-houses' | 'date-only' | 'unavailable';
export type TransitEnrichmentState = 'idle' | 'loading' | 'ready' | 'partial';
export type TransitTightness = 'peak' | 'tight' | 'active';

export type TransitTargetRef =
  | { readonly kind: 'planet'; readonly planetId: PlanetId }
  | { readonly kind: 'angle'; readonly angle: AngleId };

export interface TransitPassSummary {
  readonly jdTt: number;
  readonly epochMs: number;
  readonly utc: string | null;
  readonly state: 'exact' | 'refined' | 'near-miss';
  readonly residualDeg: number | null;
  readonly retrograde: boolean | null;
  /** 1-based index among exact contacts in this window; null for near misses. */
  readonly passNumber: number | null;
  readonly totalExactPasses: number;
}

export interface TransitWindowEnrichment {
  readonly key: string;
  readonly startsAtEpochMs: number | null;
  readonly endsAtEpochMs: number | null;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  readonly passes: readonly TransitPassSummary[];
  readonly nearestPass: TransitPassSummary | null;
  readonly isRetrogradeSeries: boolean;
}

export interface TransitHouseSpan {
  readonly planetId: PlanetId;
  readonly houseNumber: HouseId;
  readonly enteredAtEpochMs: number | null;
  readonly exitsAtEpochMs: number | null;
  readonly clippedEntry: boolean;
  readonly clippedExit: boolean;
  readonly includesRetrogradeReentry: boolean;
}

export interface NearbyStationInfo {
  readonly planetId: PlanetId;
  readonly turns: 'direct' | 'retrograde';
  readonly epochMs: number;
  readonly jdTt: number;
  readonly daysFromSelected: number;
}

export interface TransitEnrichmentData {
  readonly signature: string;
  readonly status: 'ready' | 'partial';
  readonly windows: Readonly<Record<string, TransitWindowEnrichment>>;
  readonly houseSpans: Readonly<Record<string, TransitHouseSpan>>;
  readonly nearbyStations: readonly NearbyStationInfo[];
}

export interface TransitEnrichmentPair {
  readonly key: string;
  readonly transitId: PlanetId;
  readonly target: TransitTargetRef;
  readonly targetLongitudeDeg: number;
  readonly aspect: AspectId;
  readonly allowedOrbDeg: number;
}

export interface TransitEnrichmentHouseTarget {
  readonly planetId: PlanetId;
  readonly houseNumber: HouseId;
  readonly cuspStartDeg: number;
  readonly cuspEndDeg: number;
}

export interface TransitEnrichmentRequest {
  readonly signature: string;
  readonly selectedTt: number;
  readonly pairs: readonly TransitEnrichmentPair[];
  readonly houseTargets: readonly TransitEnrichmentHouseTarget[];
}

export interface TransitAspectReading {
  readonly id: string;
  readonly windowKey: string;
  readonly selectKey: string;
  readonly transitId: PlanetId;
  readonly target: TransitTargetRef;
  readonly title: string;
  readonly aspect: AspectId;
  readonly tone: AspectTone;
  readonly motion: TransitMotionState;
  readonly motionLabel: string;
  readonly bucket: TransitBucket;
  readonly orbDeg: number;
  readonly maxOrbDeg: number;
  readonly tightness: TransitTightness;
  readonly salience: number;
  readonly retrograde: boolean;
  readonly isAngleContact: boolean;
  readonly approximateDateOnly: boolean;
  readonly transitHouse: HouseId | null;
  readonly targetHouse: HouseId | null;
  readonly factLine: string;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly enrichment: TransitWindowEnrichment | null;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface TransitHouseReading {
  readonly planetId: PlanetId;
  readonly selectKey: string;
  readonly houseNumber: HouseId;
  readonly signIndex: number;
  readonly formattedPosition: string;
  readonly retrograde: boolean;
  readonly bucket: TransitBucket;
  readonly factLine: string;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly span: TransitHouseSpan | null;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export type TransitThemeKind =
  | 'convergence-target'
  | 'convergence-house'
  | 'retrograde-station'
  | 'lunar-context'
  | 'date-only';

export interface TransitTheme {
  readonly id: string;
  readonly kind: TransitThemeKind;
  readonly title: string;
  readonly factsSummary: string;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface TransitLunarTieIn {
  readonly factLine: string;
  readonly phaseLabel: string;
  readonly illuminationText: string;
  readonly transitMoonHouse: HouseId | null;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface TransitReading {
  readonly mode: TransitReadingMode;
  readonly isDemo: boolean;
  readonly profileLabel: string | null;
  readonly birthSummary: string;
  readonly momentLabel: string;
  readonly displayZone: string;
  readonly selectedTt: number | null;
  readonly houseSystemLabel: string | null;
  readonly omittedNotes: readonly string[];
  readonly overview: OverviewSection;
  readonly themes: readonly TransitTheme[];
  readonly buckets: {
    readonly longTerm: readonly TransitAspectReading[];
    readonly mediumTerm: readonly TransitAspectReading[];
    readonly lunarBrief: readonly TransitAspectReading[];
  };
  readonly allAspects: readonly TransitAspectReading[];
  readonly wideChartAspectsCount: number;
  readonly houseTransits: readonly TransitHouseReading[];
  readonly lunarTieIn: TransitLunarTieIn | null;
  readonly enrichmentState: TransitEnrichmentState;
  readonly nearbyStations: readonly NearbyStationInfo[];
  readonly reflections: readonly ReflectionPrompt[];
  readonly sources: readonly SourceId[];
}

export interface TransitInterpretationInput {
  readonly natalChart: Chart;
  readonly natalPositions: PositionMap;
  readonly transitPositions: PositionMap;
  readonly transitAspects: readonly AspectFact[];
  readonly houses: HouseFacts | null;
  readonly chartRulerId?: PlanetId | null;
  readonly dateOnlyNatalFacts?: DateOnlyNatalFacts | null;
  readonly transitMoonState: MoonState | null;
  readonly selectedTt: number | null;
  readonly momentLabel: string;
  readonly displayZone: string;
  readonly isDemo: boolean;
  readonly birthSummary: string;
  readonly enrichment?: TransitEnrichmentData | null;
  readonly enrichmentState?: TransitEnrichmentState;
}
