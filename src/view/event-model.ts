import type { PlanetId } from '../domain/chart';
import type { AspectPass, AstrologyEvent, EventMoment } from '../domain/event';

/** What the Events view shows: exact contacts and stations by default. */
export type EventFilter = 'exact' | 'station' | 'all';

type Station = Extract<AstrologyEvent, { kind: 'station' }>;
type Window = Extract<AstrologyEvent, { kind: 'aspect-window' }>;

export type EventClass = 'station' | 'exact' | 'near-miss' | 'window';

const momentMs = (moment: EventMoment | null | undefined) => {
  if (!moment?.utc) return null;
  const value = Date.parse(moment.utc);
  return Number.isNaN(value) ? null : value;
};

export const isExactPass = (pass: AspectPass) => pass.state !== 'near-miss';

/** Stations, windows with an exact contact, near misses and windows with no pass at all. */
export function classify(event: AstrologyEvent): EventClass {
  if (event.kind === 'station') return 'station';
  if (event.passes.some(isExactPass)) return 'exact';
  return event.passes.length ? 'near-miss' : 'window';
}

export function matchesFilter(event: AstrologyEvent, filter: EventFilter) {
  if (filter === 'all') return true;
  const kind = classify(event);
  return filter === 'station' ? kind === 'station' : kind === 'station' || kind === 'exact';
}

/** The moment an event is filed under: a station, the first exact contact, or the start of the window. */
export function primaryMoment(event: AstrologyEvent): EventMoment | null {
  if (event.kind === 'station') return event.at;
  const pass = event.passes.find(isExactPass) ?? event.passes[0];
  return pass?.at ?? event.startsAt ?? event.endsAt;
}

const sortKey = (event: AstrologyEvent) => {
  const moment = primaryMoment(event);
  return momentMs(moment) ?? (moment?.jdTt === null || !moment ? Infinity : (moment.jdTt - 2440587.5) * 86_400_000);
};

/** Chronological, with events that have no usable time last. The input order breaks ties. */
export function sortEvents(events: readonly AstrologyEvent[]) {
  return events.map((event, index) => ({ event, index, key: sortKey(event) }))
    .sort((a, b) => a.key - b.key || a.index - b.index).map(entry => entry.event);
}

export interface MonthGroup { readonly key: string; readonly label: string; readonly events: readonly AstrologyEvent[] }

const monthFormat = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function monthOf(event: AstrologyEvent) {
  const ms = momentMs(primaryMoment(event));
  if (ms === null) return { key: 'unavailable', label: 'Date unavailable' };
  const date = new Date(ms);
  return { key: date.toISOString().slice(0, 7), label: monthFormat.format(date) };
}

/** Groups consecutive events by UTC month. Callers pass an already sorted page. */
export function groupByMonth(events: readonly AstrologyEvent[]): MonthGroup[] {
  const groups: { key: string; label: string; events: AstrologyEvent[] }[] = [];
  for (const event of events) {
    const month = monthOf(event);
    const last = groups.at(-1);
    if (last?.key === month.key) last.events.push(event);
    else groups.push({ ...month, events: [event] });
  }
  return groups;
}

/**
 * Whether a planet was retrograde at an instant, inferred only from the stations in the same
 * result: after a retrograde station it is retrograde until the next direct one. Before the first
 * station the opposite of that station's turn applies. Null when the result holds no station.
 */
export function retrogradeAt(planetId: PlanetId, jdTt: number | null, events: readonly AstrologyEvent[]): boolean | null {
  if (jdTt === null) return null;
  const stations = events.filter((event): event is Station => event.kind === 'station' && event.planet.planetId === planetId
    && event.at.jdTt !== null).sort((a, b) => a.at.jdTt! - b.at.jdTt!);
  if (!stations.length) return null;
  let before: Station | undefined;
  for (const station of stations) if (station.at.jdTt! <= jdTt) before = station;
  if (before) return before.turns === 'retrograde';
  return stations[0].turns === 'direct';
}

export interface PassView {
  readonly pass: AspectPass;
  readonly retrograde: boolean | null;
  /** 1-based position among the exact contacts of this window; null for near misses. */
  readonly number: number | null;
}

export function passViews(event: Window, all: readonly AstrologyEvent[]): PassView[] {
  let counter = 0;
  return event.passes.map(pass => ({
    pass,
    retrograde: retrogradeAt(event.transit.planetId, pass.at.jdTt, all),
    number: isExactPass(pass) ? ++counter : null,
  }));
}

export const exactCount = (event: Window) => event.passes.filter(isExactPass).length;

export function summarize(events: readonly AstrologyEvent[]) {
  const counts = { station: 0, exact: 0, 'near-miss': 0, window: 0 } satisfies Record<EventClass, number>;
  for (const event of events) counts[classify(event)]++;
  return counts;
}
