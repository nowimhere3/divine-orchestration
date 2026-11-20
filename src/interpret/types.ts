import type { AspectFact, AspectId } from '../domain/aspects';
import type { Chart, HouseFacts, HouseId, PlanetId } from '../domain/chart';
import type { EphemeraEngine } from '../engine/ephemera';
import type { AspectTone, SourceId, ZodiacElement, ZodiacMode } from '../knowledge';
import type { DateOnlyMoonSummary, LunarPhaseId, MoonState } from '../lunar';
import type { PositionMap } from '../view/chart-data';

export type NatalReadingMode = 'complete' | 'no-houses' | 'date-only' | 'unavailable';
export type TightnessTier = 'tight' | 'moderate' | 'wide';
export type AngleId = 'asc' | 'mc';

export interface FactCitation {
  readonly label: string;
  /** Wheel / Inspector selection key (e.g. `natal/sun`, `sign/9`, `house/10`, `angle/asc`, or an AspectFact id). */
  readonly selectKey: string | null;
}

export interface AngleAspectFact {
  readonly id: string;
  readonly planetId: PlanetId;
  readonly angle: AngleId;
  readonly aspect: AspectId;
  readonly exactAngleDeg: number;
  readonly separationDeg: number;
  readonly orbDeg: number;
  readonly allowedOrbDeg: number;
}

export interface DateOnlyPlanetFact {
  readonly planetId: PlanetId;
  readonly status: 'confirmed' | 'boundary-day' | 'unavailable';
  readonly startSignIndex: number | null;
  readonly endSignIndex: number | null;
  /** Signs in chronological order, including a repeated sign after a reversal. */
  readonly visitedSignIndices: readonly number[];
  readonly startLongitudeDeg: number | null;
  readonly endLongitudeDeg: number | null;
  readonly minLongitudeDeg: number | null;
  readonly maxLongitudeDeg: number | null;
  readonly startFormatted: string | null;
  readonly endFormatted: string | null;
  readonly minFormatted: string | null;
  readonly maxFormatted: string | null;
  readonly retrogradeStart: boolean | null;
  readonly retrogradeEnd: boolean | null;
  readonly stationedDuringDay: boolean;
}

export interface DateOnlyAspectFact {
  readonly id: string;
  readonly from: PlanetId;
  readonly to: PlanetId;
  readonly aspect: AspectId;
  readonly exactAngleDeg: number;
  readonly minOrbDeg: number;
  readonly maxOrbDeg: number;
  readonly allowedOrbDeg: number;
}

export type DateOnlyUnavailableReason = 'skipped-civil-date' | 'invalid-input' | 'outside-coverage';

export interface DateOnlyNatalFacts {
  readonly status: 'ok' | 'unavailable';
  readonly unavailableReason?: DateOnlyUnavailableReason;
  readonly birthDate: string;
  readonly zoneLabel: string;
  readonly planets: readonly DateOnlyPlanetFact[];
  readonly confirmedAspects: readonly DateOnlyAspectFact[];
  readonly moonSummary: DateOnlyMoonSummary;
  readonly moonPhases: readonly LunarPhaseId[];
  readonly moonPhaseChanged: boolean;
}

export interface BalanceBucket {
  readonly weight: number;
  readonly count: number;
  readonly bodies: readonly string[];
}

export interface BalanceBreakdown {
  readonly elements: Readonly<Record<ZodiacElement, BalanceBucket>>;
  readonly modes: Readonly<Record<ZodiacMode, BalanceBucket>>;
  readonly dominantElement: ZodiacElement | null;
  readonly sparseElements: readonly ZodiacElement[];
  readonly dominantMode: ZodiacMode | null;
  readonly sparseModes: readonly ZodiacMode[];
  readonly totalWeight: number;
  readonly includesAngles: boolean;
}

export type ThemeKind =
  | 'chart-ruler'
  | 'balance'
  | 'stellium'
  | 'angular'
  | 'pattern'
  | 'retrograde'
  | 'hemisphere'
  | 'lunar'
  | 'date-only';

export interface ChartTheme {
  readonly id: string;
  readonly kind: ThemeKind;
  readonly title: string;
  readonly factsSummary: string;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface PlacementReading {
  readonly planetId: PlanetId;
  readonly selectKey: string | null;
  readonly title: string;
  readonly status: 'exact' | 'confirmed-sign' | 'boundary-day' | 'unavailable';
  readonly factLine: string;
  readonly signIndex: number | null;
  readonly houseNumber: HouseId | null;
  readonly retrograde: boolean;
  readonly isGenerationalSign: boolean;
  readonly sensitivityNote: string | null;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly aspectCount: number;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface AngleReading {
  readonly angle: AngleId;
  readonly selectKey: string;
  readonly title: string;
  readonly factLine: string;
  readonly signIndex: number;
  readonly oppositeLabel: string;
  readonly inHouse: HouseId | null;
  readonly sensitivityNote: string | null;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly aspects: readonly AngleAspectFact[];
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface ChartRulerReading {
  readonly ascSignIndex: number;
  readonly rulerId: PlanetId;
  readonly modernCoRulerId: PlanetId | null;
  readonly rulerSignIndex: number | null;
  readonly rulerHouse: HouseId | null;
  readonly factLine: string;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface NatalMoonPhaseReading {
  readonly factLine: string;
  readonly phaseLabel: string;
  readonly illuminationText: string;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface CoreTrioReading {
  readonly sun: PlacementReading | null;
  readonly moon: PlacementReading | null;
  readonly ascendant: AngleReading | null;
  readonly midheaven: AngleReading | null;
  readonly chartRuler: ChartRulerReading | null;
  readonly natalMoonPhase: NatalMoonPhaseReading | null;
}

export interface NatalAspectReading {
  readonly id: string;
  readonly selectKey: string | null;
  readonly title: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly aspect: AspectId;
  readonly tone: AspectTone;
  readonly tightness: TightnessTier;
  readonly orbDeg: number;
  readonly allowedOrbDeg: number;
  readonly orbText: string;
  readonly factLine: string;
  readonly symbolismBasis: string;
  readonly synthesis: string;
  readonly reflection: string;
  readonly priority: number;
  readonly isAngleAspect: boolean;
  readonly citations: readonly FactCitation[];
  readonly sources: readonly SourceId[];
}

export interface OverviewSection {
  readonly headline: string;
  readonly factsSummary: string;
  readonly symbolismDisclaimer: string;
  readonly synthesis: string;
  readonly citations: readonly FactCitation[];
}

export interface ReflectionPrompt {
  readonly id: string;
  readonly topic: string;
  readonly question: string;
}

export interface NatalReading {
  readonly mode: NatalReadingMode;
  readonly isDemo: boolean;
  readonly profileLabel: string | null;
  readonly birthSummary: string;
  readonly houseSystemLabel: string | null;
  readonly sensitivityNotes: readonly string[];
  readonly omittedNotes: readonly string[];
  readonly overview: OverviewSection;
  readonly coreTrio: CoreTrioReading;
  readonly balance: BalanceBreakdown | null;
  readonly themes: readonly ChartTheme[];
  readonly placements: readonly PlacementReading[];
  readonly aspects: readonly NatalAspectReading[];
  readonly angleAspects: readonly AngleAspectFact[];
  readonly reflections: readonly ReflectionPrompt[];
  readonly sources: readonly SourceId[];
  readonly dateOnlyFacts: DateOnlyNatalFacts | null;
}

export interface NatalInterpretationInput {
  readonly chart: Chart;
  readonly positions: PositionMap;
  readonly aspects: readonly AspectFact[];
  readonly houses: HouseFacts | null;
  readonly natalMoonState: MoonState | null;
  readonly dateOnlyMoonSummary: DateOnlyMoonSummary | null;
  readonly engine?: EphemeraEngine;
  readonly isDemo: boolean;
  readonly birthSummary: string;
}

export interface InspectorPersonalNote {
  readonly heading: string;
  readonly factBadge: string;
  readonly symbolismNote: string;
  readonly synthesis: string;
  readonly sensitivityNote: string | null;
  readonly reflection: string | null;
  readonly citations: readonly FactCitation[];
}
