import { ANGLES } from './angles';
import { ASPECT_META, ASPECTS } from './aspects';
import { BODY_META, BODIES } from './bodies';
import { CONCEPTS } from './concepts';
import { HOUSE_META, HOUSES } from './houses';
import { SIGN_META, SIGNS } from './signs';
import type { AspectId } from '../domain/aspects';
import type { HouseId, PlanetId } from '../domain/chart';
import type { Entry, EntryKind } from './types';

export type { Entry, EntryKind, Source, SourceId } from './types';
export type { AspectMeta, AspectTone } from './aspects';
export type { BodyMeta, BodyTier } from './bodies';
export type { HouseGroup, HouseMeta } from './houses';
export type { SignMeta, ZodiacElement, ZodiacMode } from './signs';
export { ASPECT_META, BODY_META, HOUSE_META, SIGN_META };
export { SOURCES, sourcesFor } from './sources';

export const bodyMeta = (planetId: PlanetId) => BODY_META[planetId];
export const signMeta = (index: number) => SIGN_META[((index % 12) + 12) % 12];
export const houseMeta = (number: HouseId) => HOUSE_META[number - 1];
export const aspectMeta = (aspect: AspectId) => ASPECT_META[aspect];

/** What a selectable key refers to, beyond planets and aspect facts which the chart layer already names. */
export type ElementRef =
  | { readonly type: 'sign'; readonly index: number }
  | { readonly type: 'house'; readonly number: number }
  | { readonly type: 'angle'; readonly which: 'asc' | 'mc' }
  | { readonly type: 'aspect'; readonly aspect: string }
  | { readonly type: 'concept'; readonly id: string };

export const signKey = (index: number) => `sign/${index}`;
export const houseKey = (number: number) => `house/${number}`;
export const angleKey = (which: 'asc' | 'mc') => `angle/${which}`;
export const aspectTypeKey = (aspect: string) => `aspect/${aspect}`;
export const conceptKey = (id: string) => `concept/${id}`;

/** Parses `sign/9`, `house/7`, `angle/mc`, `aspect/trine` and `concept/orb`. Anything else (planets, aspect facts) is null. */
export function parseElementKey(key: string): ElementRef | null {
  const [type, value, extra] = key.split('/');
  if (extra !== undefined || value === undefined) return null;
  if (type === 'sign' && /^(?:[0-9]|1[01])$/.test(value)) return { type, index: Number(value) };
  if (type === 'house' && /^(?:[1-9]|1[0-2])$/.test(value)) return { type, number: Number(value) };
  if (type === 'angle' && (value === 'asc' || value === 'mc')) return { type, which: value };
  if (type === 'aspect' && Object.hasOwn(ASPECTS, value)) return { type, aspect: value };
  if (type === 'concept' && Object.hasOwn(CONCEPTS, value)) return { type, id: value };
  return null;
}

export const bodyEntry = (planetId: string): Entry | undefined => BODIES[planetId];
export const signEntry = (index: number): Entry | undefined => SIGNS[index];
export const houseEntry = (number: number): Entry | undefined => HOUSES[number - 1];
export const aspectEntry = (aspect: string): Entry | undefined => ASPECTS[aspect];
export const angleEntry = (which: string): Entry | undefined => ANGLES[which];
export const conceptEntry = (id: string): Entry | undefined => CONCEPTS[id];

export function entryForRef(ref: ElementRef): Entry | undefined {
  switch (ref.type) {
    case 'sign': return signEntry(ref.index);
    case 'house': return houseEntry(ref.number);
    case 'angle': return angleEntry(ref.which);
    case 'aspect': return aspectEntry(ref.aspect);
    case 'concept': return conceptEntry(ref.id);
  }
}

/** Every entry in a stable reading order: for the Inspector index today and a Learn view later. */
export function allEntries(): readonly Entry[] {
  return [
    ...Object.values(BODIES), ...SIGNS, ...HOUSES, ...Object.values(ASPECTS), ...Object.values(ANGLES), ...Object.values(CONCEPTS),
  ];
}

export const entriesOfKind = (kind: EntryKind) => allEntries().filter(entry => entry.kind === kind);
export const entryById = (id: string) => allEntries().find(entry => entry.id === id);

/** The one-line hover label: "Saturn · Structure and responsibility". */
export const tipText = (entry: Entry) => `${entry.name} · ${entry.tagline}`;
