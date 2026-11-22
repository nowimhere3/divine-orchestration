import { MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectId } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { Chart, HouseId, PlanetId } from '../domain/chart';
import type { EventMoment } from '../domain/event';
import { ALL_HOUSE_IDS, ALL_RESEARCH_ANGLES } from '../knowledge/research-themes';
import { utcFromTt } from '../time/atomic-offsets';

export interface ResearchExportPrivacy {
  readonly birthDetails: 'redacted' | 'full';
  readonly eventDates: 'relative' | 'calendar' | 'omit';
}

export type ResearchExportMoment = EventMoment | { readonly offsetTtDays: number } | null;
export type ProjectMoment = (moment: EventMoment | null) => ResearchExportMoment;

export function knownValue<T extends string | number | null>(allowed: readonly T[], value: T): T {
  if (!allowed.includes(value)) throw new TypeError('Invalid enumerated value in research export input.');
  return value;
}

export const planet = (value: PlanetId) => knownValue(PLANET_IDS, value);
export const house = (value: HouseId) => knownValue(ALL_HOUSE_IDS, value);
export const angle = (value: typeof ALL_RESEARCH_ANGLES[number]) => knownValue(ALL_RESEARCH_ANGLES, value);
export const aspect = (value: AspectId) => knownValue(Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[], value);
export const houseSystem = (value: string | null) =>
  knownValue(['WholeSign', 'Placidus', 'Porphyry', null] as const, value);

export function resolveExportPrivacy(input: Partial<ResearchExportPrivacy> = {}): ResearchExportPrivacy {
  const birthDetails = knownValue(['redacted', 'full'], input.birthDetails ?? 'redacted');
  const eventDates = knownValue(['relative', 'calendar', 'omit'], input.eventDates ?? (birthDetails === 'full' ? 'calendar' : 'relative'));
  return { birthDetails, eventDates };
}

export function projectMoments(privacy: ResearchExportPrivacy, originTt: number): ProjectMoment {
  return moment => {
    if (moment === null || privacy.eventDates === 'omit') return null;
    if (privacy.eventDates === 'relative') {
      return moment.jdTt === null ? null : { offsetTtDays: moment.jdTt - originTt };
    }
    const { utc, jdUt, jdTt } = moment;
    if (utc !== null && typeof utc !== 'string') throw new TypeError('Invalid research event UTC timestamp.');
    if (utc !== null && !/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(utc)) {
      throw new TypeError('Invalid research event UTC timestamp.');
    }
    return { utc, jdUt, jdTt };
  };
}

export function projectReference(
  referenceTt: number | null, moment: ProjectMoment, eventDates: ResearchExportPrivacy['eventDates'],
): ResearchExportMoment {
  return moment(referenceTt === null ? null : {
    jdTt: referenceTt, jdUt: null, utc: eventDates === 'calendar' ? utcFromTt(referenceTt) : null,
  });
}

export function privacyNotices(privacy: ResearchExportPrivacy): readonly string[] {
  return [
    privacy.birthDetails === 'full'
      ? 'This export includes the original natal birth date, time, zone and available observer coordinates.'
      : 'Direct natal identity and birth details are removed. Profile and custom-theme labels are excluded.',
    'Natal planetary geometry, house cusps and angles can help reconstruct birth details. Redaction does not guarantee anonymity.',
    privacy.eventDates === 'calendar'
      ? 'Calendar transit timestamps, combined with chart geometry, can narrow possible birth details.'
      : privacy.eventDates === 'relative'
        ? 'Timing uses exact TT day offsets from the requested range start. Geometry and event patterns can still reveal possible dates or birth details.'
        : 'Event timestamps and offsets are omitted. Geometry and ordered event patterns can still reveal possible dates or birth details.',
  ];
}

/** The full policy shares only the birth fields defined in SnapshotV0. */
export function projectBirthTime(time: Chart['time']): Chart['time'] {
  const { date, time: clock, timeZone, offsetOverride, disambiguation } = time.input;
  const input = {
    date, time: clock,
    ...(timeZone !== undefined ? { timeZone } : {}),
    ...(offsetOverride !== undefined ? { offsetOverride } : {}),
    ...(disambiguation !== undefined ? { disambiguation } : {}),
  };
  if (time.kind === 'unknown-time') return { kind: time.kind, input: { ...input, time: null }, calendar: 'proleptic-gregorian' };
  const { value, seconds, source, certainty, zone, transition, foldChoice } = time.offset;
  return {
    kind: time.kind, input: { ...input, time: time.input.time }, calendar: 'proleptic-gregorian',
    utc: time.utc, historicalUt1Iso: time.historicalUt1Iso,
    wallTimeResolutionSeconds: time.wallTimeResolutionSeconds, jdUt: time.jdUt, jdTt: time.jdTt,
    deltaTYear: time.deltaTYear, deltaTSeconds: time.deltaTSeconds, deltaTSource: 'ephemera-model',
    taiMinusUtcSeconds: time.taiMinusUtcSeconds, leapSecond: time.leapSecond,
    offset: { value, seconds, source, certainty, zone, transition, foldChoice },
    warnings: time.warnings,
  };
}
