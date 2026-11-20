import type { AstrologyEvent } from '../domain/event';
import type { EventSearchResult } from '../search/events';
import type { SnapshotContext } from './snapshot';

export interface EventSelection {
  readonly daysBefore: number;
  readonly daysAfter: number;
  readonly timing: 'all' | 'past' | 'present' | 'future';
  readonly filter: 'all' | 'focused' | 'station';
  readonly limit: number;
}

export function selectEventContext(result: EventSearchResult, options: EventSelection) {
  const all = result.context?.events ?? [];
  const reference = result.settings.referenceTt;
  const distance = (event: AstrologyEvent) => {
    if (reference === null || event.timing === 'present') return 0;
    const epoch = event.kind === 'station' ? event.at.jdTt
      : event.timing === 'past' ? event.endsAt?.jdTt ?? result.context?.end.jdTt
        : event.startsAt?.jdTt ?? result.context?.start.jdTt;
    return Math.abs((epoch ?? reference) - reference);
  };
  const keep = all.map((event, index) => ({ event, index, distance: distance(event) }))
    .filter(({ event }) => (options.timing === 'all' || event.timing === options.timing) &&
      (event.kind === 'station' || options.filter === 'all' ||
        (options.filter === 'focused' && event.passes.some(pass => pass.state !== 'near-miss'))))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, options.limit).sort((a, b) => a.index - b.index).map(({ event }) => event);
  const eventSummary: NonNullable<SnapshotContext['eventSummary']> = {
    ...options, status: result.status, totalEvents: all.length, includedEvents: keep.length,
    warnings: result.warnings,
    unavailableReasons: [...new Set([...result.unavailable.map(issue => issue.reason), ...(result.reason ? [result.reason] : [])])].sort(),
    contactToleranceDeg: result.provenance.contactToleranceDeg,
    refinementSeconds: result.provenance.refinementSeconds,
    stationToleranceDegPerDay: result.provenance.stationToleranceDegPerDay,
    stationResidualsDegPerDay: keep.filter(event => event.kind === 'station')
      .map(event => result.stationResidualsDegPerDay[event.id] ?? null),
  };
  return { eventSearch: result.context ? { ...result.context, events: keep } : null, eventSummary };
}
