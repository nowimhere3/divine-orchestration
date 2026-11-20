import type { AspectId } from './aspects';
import type { PlanetRef } from './chart';

export interface EventMoment {
  readonly utc: string | null;
  readonly jdUt: number | null;
  readonly jdTt: number | null;
}

export interface AspectPass {
  readonly at: EventMoment;
  readonly state: 'exact' | 'refined' | 'near-miss';
  readonly residualDeg: number | null;
  readonly toleranceDeg: number | null;
}

export type EventTiming = 'past' | 'present' | 'future' | 'unknown';

export type AstrologyEvent = {
  readonly id: string;
  /** Relative to the snapshot's explicit reference instant. */
  readonly timing: EventTiming;
} & (
  | {
      readonly kind: 'aspect-window';
      readonly transit: PlanetRef;
      readonly target: PlanetRef;
      readonly aspect: AspectId;
      readonly startsAt: EventMoment | null;
      readonly endsAt: EventMoment | null;
      readonly clippedStart: boolean;
      readonly clippedEnd: boolean;
      readonly passes: readonly AspectPass[];
      readonly allowedOrbDeg: number;
    }
  | {
      readonly kind: 'station';
      readonly planet: PlanetRef;
      readonly at: EventMoment;
      readonly turns: 'direct' | 'retrograde';
    }
);

/** Symbolic interpretation belongs to a cited rule set and is separate from calculated facts. */
export interface SymbolicMeaning {
  readonly factId: string;
  readonly tradition: string;
  readonly ruleSetVersion: string;
  readonly description: string;
  readonly sources: readonly string[];
}
