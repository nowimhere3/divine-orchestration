import type { ResolvedInstant, TimeWarning, UnknownBirthTime } from '../time/resolve';

export const PLANET_IDS = [
  'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto',
] as const;
export type PlanetId = typeof PLANET_IDS[number];
export type HouseId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface PlanetRef {
  readonly chartId: string;
  readonly planetId: PlanetId;
}

export type Unavailable = {
  readonly status: 'unavailable';
  readonly reason:
    | 'unknown-birth-time' | 'missing-location' | 'invalid-input'
    | 'outside-coverage' | 'unsupported-body' | 'calculation-unavailable';
};

export type Fact<Value> = { readonly status: 'available'; readonly value: Value } | Unavailable;

export interface PlanetPosition {
  readonly longitudeDeg: number;
  readonly latitudeDeg: number;
  readonly distanceAu: number;
  readonly longitudeSpeedDegPerDay: number;
  readonly latitudeSpeedDegPerDay: number;
  readonly distanceSpeedAuPerDay: number;
  readonly retrograde: boolean;
}

export interface PlanetFact {
  readonly planetId: PlanetId;
  readonly position: Fact<PlanetPosition>;
}

export interface HouseFacts {
  readonly cusps: readonly { readonly houseId: HouseId; readonly longitudeDeg: number }[];
  readonly ascendantDeg: number;
  readonly midheavenDeg: number;
  readonly effectiveSystem: string;
  readonly fallback: boolean;
}

export type ChartWarning = TimeWarning | 'near-coverage-edge' | 'polar-house-fallback';

interface ChartBase {
  readonly id: string; // Stable application-assigned identifier.
  readonly label: string | null;
  readonly settings: {
    readonly zodiac: 'tropical';
    readonly requestedHouseSystem: string | null;
    readonly observer: { readonly latitudeDeg: number; readonly longitudeDeg: number } | null;
  };
  readonly warnings: readonly ChartWarning[];
}

export type TimedChart = ChartBase & {
  readonly kind: 'natal' | 'transit';
  readonly time: ResolvedInstant;
  readonly planets: Fact<readonly PlanetFact[]>;
  readonly houses: Fact<HouseFacts>;
};

export type DateOnlyNatalChart = ChartBase & {
  readonly kind: 'natal';
  readonly time: UnknownBirthTime;
  readonly planets: Unavailable & { readonly reason: 'unknown-birth-time' };
  readonly houses: Unavailable & { readonly reason: 'unknown-birth-time' };
};

export type Chart = TimedChart | DateOnlyNatalChart;

export function createDateOnlyNatalChart(
  input: Pick<DateOnlyNatalChart, 'id' | 'label' | 'time' | 'settings'>,
): DateOnlyNatalChart {
  return {
    ...input,
    kind: 'natal',
    planets: { status: 'unavailable', reason: 'unknown-birth-time' },
    houses: { status: 'unavailable', reason: 'unknown-birth-time' },
    warnings: [],
  };
}
