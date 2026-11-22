import type { EventMoment, EventTiming } from '../domain/event';
import type { EventRangeSearchResult, RangeEvent } from '../search/range';
import { TIME_EPS } from '../search/geometry';

function timingFor(reference: number | null, start: number | null, end: number | null): EventTiming {
  if (reference === null || start === null || end === null) return 'unknown';
  return reference < start - TIME_EPS ? 'future' : reference > end + TIME_EPS ? 'past' : 'present';
}

const jd = (moment: EventMoment | null | undefined) =>
  moment && moment.jdTt !== null && Number.isFinite(moment.jdTt) ? moment.jdTt : null;

/**
 * The same past/present/future rule the range engine applies, derived from an event's own times.
 * A window cut by the search horizon is bounded by the effective search interval on that side.
 */
export function retimeEvent(
  event: RangeEvent,
  referenceTt: number | null,
  horizon: { readonly startTt: number | null; readonly endTt: number | null },
): RangeEvent {
  let timing: EventTiming;
  if (event.kind === 'station') {
    const at = jd(event.at);
    timing = timingFor(referenceTt, at, at);
  } else if (event.kind === 'house-ingress') {
    const at = jd(event.at);
    timing = timingFor(referenceTt, at, at);
  } else {
    const start = event.clippedStart ? horizon.startTt : jd(event.startsAt);
    const end = event.clippedEnd ? horizon.endTt : jd(event.endsAt);
    timing = timingFor(referenceTt, start, end);
  }
  return timing === event.timing ? event : { ...event, timing };
}

/**
 * Returns the same calculated result with past/present/future timing re-derived for a new reference
 * moment. Nothing is recalculated: positions, windows and passes are unchanged, so a Time Machine move
 * never forces a new search. Events whose timing does not change keep their object identity.
 */
export function retimeRangeResult(result: EventRangeSearchResult, referenceTt: number | null): EventRangeSearchResult {
  const previous = result.settings.referenceTt;
  const same = previous === referenceTt || (previous !== null && referenceTt !== null && Math.abs(previous - referenceTt) <= TIME_EPS);
  if (same || result.status === 'unavailable') return result;
  const horizon = {
    startTt: jd(result.range.effectiveStart) ?? result.settings.startTt,
    endTt: jd(result.range.effectiveEnd) ?? result.settings.endTt,
  };
  return {
    ...result,
    settings: { ...result.settings, referenceTt },
    events: result.events.map(event => retimeEvent(event, referenceTt, horizon)),
  };
}
