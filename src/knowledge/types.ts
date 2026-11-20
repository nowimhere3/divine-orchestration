/**
 * The local astrology knowledge library. It is plain data with no DOM or chart dependencies, so the
 * Inspector uses it today and a future Learn/Glossary view can reuse it unchanged.
 *
 * Every entry keeps three kinds of statement apart, because they have different standing:
 *  - `facts`      astronomical or definitional statements that can be checked;
 *  - `symbolism`  traditional astrological associations, which are cultural convention, not measurement;
 *  - `reading`    how to hold the element in mind when looking at a chart (guidance, not prediction).
 */
export type EntryKind = 'body' | 'sign' | 'house' | 'aspect' | 'angle' | 'concept';

export type SourceId =
  | 'nasa-planets' | 'wiki-planets-astrology' | 'wiki-sign' | 'wiki-tropical' | 'wiki-house' | 'wiki-aspect'
  | 'wiki-retrograde' | 'wiki-ecliptic' | 'wiki-ascendant' | 'wiki-midheaven' | 'wiki-horoscope'
  | 'wiki-triplicity' | 'wiki-symbols' | 'ptolemy' | 'lilly' | 'britannica-astrology' | 'iau-2006';

export interface Source {
  readonly id: SourceId;
  readonly title: string;
  readonly author: string;
  /** What the entry text drew on this source for. */
  readonly used: string;
  readonly url?: string;
}

export interface Entry {
  /** Stable identifier, for example `body/saturn`, `sign/9`, `house/7`, `aspect/trine`, `angle/mc`, `concept/orb`. */
  readonly id: string;
  readonly kind: EntryKind;
  /** The short name used in labels, such as "Saturn", "Capricorn", "House 7" or "MC". */
  readonly name: string;
  /** The full name where it differs, such as "Ascendant" for ASC. */
  readonly longName?: string;
  readonly symbol?: string;
  /** Text after the name in a hover label: "Saturn · Structure and responsibility". */
  readonly tagline: string;
  /** What the thing is, in plain language. */
  readonly summary: string;
  readonly facts: readonly string[];
  readonly symbolism: readonly string[];
  readonly reading: string;
  readonly reflection?: string;
  readonly sources: readonly SourceId[];
  /** Concept entries worth opening next. */
  readonly see?: readonly string[];
}
