import { Temporal } from '@js-temporal/polyfill';
import { ATOMIC_OFFSETS_VERIFIED_BEFORE, isKnownLeapMidnight, taiMinusUtc } from './atomic-offsets';

export interface BirthTimeInput {
  readonly date: string; // YYYY-MM-DD, proleptic Gregorian
  readonly time: string | null; // HH:mm[:ss[.SSS]], null for unknown
  readonly timeZone?: string; // IANA name
  readonly offsetOverride?: string; // ±HH:mm[:ss]; east positive
  readonly disambiguation?: 'earlier' | 'later';
}

export type TimeWarning =
  | 'historical-zone-offset-uncertain'
  | 'offset-override-differs-from-zone'
  | 'pre-utc-ut1-approximation'
  | 'modeled-delta-t'
  | 'future-utc-assumption';

export interface OffsetCandidate {
  readonly utc: string | null;
  readonly historicalUt1Iso: string | null;
  readonly offset: string;
}

export interface ResolvedInstant {
  readonly kind: 'resolved';
  readonly input: BirthTimeInput & { readonly time: string };
  readonly calendar: 'proleptic-gregorian';
  /** Null before the earliest UTC record used here. */
  readonly utc: string | null;
  /** Pre-UTC civil time adjusted by the offset and interpreted as approximate UT1. */
  readonly historicalUt1Iso: string | null;
  /** Resolution of the entered wall time, independent of clock or offset accuracy. */
  readonly wallTimeResolutionSeconds: number;
  readonly jdUt: number;
  readonly jdTt: number;
  readonly deltaTYear: number;
  readonly deltaTSeconds: number;
  readonly deltaTSource: 'ephemera-model';
  readonly taiMinusUtcSeconds: number | null;
  readonly leapSecond: boolean;
  readonly offset: {
    readonly value: string;
    readonly seconds: number;
    readonly source: 'iana-runtime' | 'user-override';
    readonly certainty: 'runtime-zone-data' | 'historical-estimate' | 'user-supplied';
    readonly zone: string | null;
    readonly transition: 'unique' | 'fold' | 'gap' | null;
    readonly foldChoice: 'earlier' | 'later' | null;
  };
  readonly warnings: readonly TimeWarning[];
}

export interface UnknownBirthTime {
  readonly kind: 'unknown-time';
  readonly input: BirthTimeInput & { readonly time: null };
  readonly calendar: 'proleptic-gregorian';
}

type TimeFailure = {
  readonly kind: 'unresolved';
  readonly input: BirthTimeInput;
  readonly reason:
    | 'invalid-date' | 'invalid-time' | 'invalid-zone' | 'invalid-offset'
    | 'missing-zone-or-offset' | 'invalid-disambiguation' | 'nonexistent-wall-time'
    | 'ambiguous-wall-time' | 'invalid-leap-second' | 'delta-t-unavailable';
  readonly candidates?: readonly OffsetCandidate[];
};

export type TimeResolution = ResolvedInstant | UnknownBirthTime | TimeFailure;

const MS_PER_DAY = 86_400_000;
const SECONDS_PER_DAY = 86_400;
const UNIX_EPOCH_JD = 2440587.5;

function jdAtEpoch(epochMs: number) {
  return UNIX_EPOCH_JD + epochMs / MS_PER_DAY;
}

function formatUtc(epochMs: number, leap: boolean) {
  const iso = new Date(epochMs).toISOString();
  return leap ? iso.replace(/:59(?=\.\d{3}Z$)/, ':60') : iso;
}

function parseOffset(text: string) {
  const match = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const [, sign, h, m, s = '0'] = match;
  if (+h > 23 || +m > 59 || +s > 59) return null;
  const seconds = +h * 3600 + +m * 60 + +s;
  // RFC 3339 uses -00:00 for an unknown offset. Require +00:00 for known zero.
  if (!seconds && sign === '-') return null;
  return sign === '-' ? -seconds : seconds;
}

function zoneCandidates(wall: Temporal.PlainDateTime, zone: string) {
  const earlier = wall.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const later = wall.toZonedDateTime(zone, { disambiguation: 'later' });
  const candidates = earlier.equals(later) ? [earlier] : [earlier, later];
  return candidates.filter(candidate => candidate.toPlainDateTime().equals(wall));
}

function describeCandidate(candidate: Temporal.ZonedDateTime, leap: boolean): OffsetCandidate {
  const { epochMilliseconds, offset } = candidate;
  const iso = formatUtc(epochMilliseconds, leap);
  const hasUtcRecord = taiMinusUtc(jdAtEpoch(epochMilliseconds)) !== null;
  return { utc: hasUtcRecord ? iso : null, historicalUt1Iso: hasUtcRecord ? null : iso.slice(0, -1), offset };
}

/** Resolve civil inputs using the approved engine's model, passed as a function. */
export function resolveBirthTime(
  provided: BirthTimeInput,
  modelDeltaTSeconds: (fractionalYear: number) => number,
): TimeResolution {
  const { date, time, timeZone, offsetOverride, disambiguation } = provided;
  const input: BirthTimeInput = {
    date, time,
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(offsetOverride === undefined ? {} : { offsetOverride }),
    ...(disambiguation === undefined ? {} : { disambiguation }),
  };
  const fail = (reason: TimeFailure['reason'], candidates?: readonly OffsetCandidate[]): TimeFailure =>
    candidates ? { kind: 'unresolved', input, reason, candidates } : { kind: 'unresolved', input, reason };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return fail('invalid-date');
  let plainDate: Temporal.PlainDate;
  try {
    plainDate = Temporal.PlainDate.from(date);
  } catch {
    return fail('invalid-date');
  }
  if (disambiguation !== undefined &&
      ((disambiguation !== 'earlier' && disambiguation !== 'later') || offsetOverride !== undefined)) {
    return fail('invalid-disambiguation');
  }
  const manualSeconds = offsetOverride === undefined ? null : parseOffset(offsetOverride);
  if (offsetOverride !== undefined && manualSeconds === null) return fail('invalid-offset');
  if (timeZone !== undefined) {
    if (!/^[a-z][a-z0-9_+\-/]*$/i.test(timeZone)) return fail('invalid-zone');
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      return fail('invalid-zone');
    }
  }
  if (time === null) return { kind: 'unknown-time', input: { ...input, time }, calendar: 'proleptic-gregorian' };
  if (!timeZone && manualSeconds === null) return fail('missing-zone-or-offset');
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(time);
  if (!match) return fail('invalid-time');
  const [, hour, minute, second = '0', fraction = ''] = match;
  if (+hour > 23 || +minute > 59 || +second > 60) return fail('invalid-time');
  const wallTimeResolutionSeconds = match[3] === undefined ? 60 : 10 ** -fraction.length;
  const leapSecond = +second === 60;
  const wall = plainDate.toPlainDateTime({
    hour: +hour, minute: +minute, second: leapSecond ? 59 : +second, millisecond: +fraction.padEnd(3, '0'),
  });

  const candidates = timeZone === undefined ? [] : zoneCandidates(wall, timeZone);
  const warnings: TimeWarning[] = [];
  const candidateForLeap = (candidate: Temporal.ZonedDateTime) =>
    isKnownLeapMidnight(jdAtEpoch((Math.floor(candidate.epochMilliseconds / 1000) + 1) * 1000));
  const valid = leapSecond ? candidates.filter(candidateForLeap) : candidates;
  let epochMs: number;
  let offsetSeconds: number;
  let offsetText: string;
  let foldChoice: 'earlier' | 'later' | null = null;
  if (manualSeconds !== null) {
    epochMs = wall.toZonedDateTime('UTC').epochMilliseconds - manualSeconds * 1000;
    offsetSeconds = manualSeconds;
    offsetText = offsetOverride!;
    const matchingIndex = candidates.findIndex(candidate => candidate.epochMilliseconds === epochMs);
    if (timeZone && matchingIndex < 0) warnings.push('offset-override-differs-from-zone');
    if (candidates.length > 1 && matchingIndex >= 0) foldChoice = matchingIndex === 0 ? 'earlier' : 'later';
  } else {
    if (!candidates.length) return fail('nonexistent-wall-time');
    if (!valid.length) return fail('invalid-leap-second');
    if (valid.length > 1 && !disambiguation) {
      return fail('ambiguous-wall-time', valid.map(candidate => describeCandidate(candidate, leapSecond)));
    }
    const selected = valid[disambiguation === 'later' ? valid.length - 1 : 0];
    if (candidates.length > 1) foldChoice = candidates[0].equals(selected) ? 'earlier' : 'later';
    epochMs = selected.epochMilliseconds;
    offsetSeconds = selected.offsetNanoseconds / 1e9;
    offsetText = selected.offset;
  }

  const nextSecond = (Math.floor(epochMs / 1000) + 1) * 1000;
  if (leapSecond && !isKnownLeapMidnight(jdAtEpoch(nextSecond))) return fail('invalid-leap-second');
  const iso = formatUtc(epochMs, leapSecond);
  if (!/^\d{4}-/.test(iso) || iso.startsWith('0000')) return fail('invalid-date');
  const year = Number(iso.slice(0, 4));
  const start = Date.parse(`${iso.slice(0, 4)}-01-01T00:00:00Z`);
  const daysInYear = Temporal.PlainDate.from(iso.slice(0, 10)).daysInYear;
  const deltaTYear = year + (epochMs - start) / (daysInYear * MS_PER_DAY);
  const deltaTSeconds = modelDeltaTSeconds(deltaTYear);
  if (!Number.isFinite(deltaTSeconds)) return fail('delta-t-unavailable');
  const historicalZone = manualSeconds === null && (year < 1970 || plainDate.year < 1970);
  if (historicalZone) warnings.push('historical-zone-offset-uncertain');
  const taiMinusUtcSeconds = taiMinusUtc(jdAtEpoch(epochMs));
  if (taiMinusUtcSeconds === null) warnings.push('pre-utc-ut1-approximation');
  if (iso.slice(0, 10) >= ATOMIC_OFFSETS_VERIFIED_BEFORE) warnings.push('future-utc-assumption');
  warnings.push('modeled-delta-t');

  // The leap second is represented by an ISO :60 label, beyond POSIX Date's model.
  const civilJd = jdAtEpoch(epochMs + (leapSecond ? 1000 : 0));
  const jdTt = civilJd + (taiMinusUtcSeconds === null ? deltaTSeconds : taiMinusUtcSeconds + 32.184) / SECONDS_PER_DAY;
  const jdUt = taiMinusUtcSeconds === null ? civilJd : jdTt - deltaTSeconds / SECONDS_PER_DAY;
  return {
    kind: 'resolved', input: { ...input, time }, calendar: 'proleptic-gregorian',
    utc: taiMinusUtcSeconds === null ? null : iso,
    historicalUt1Iso: taiMinusUtcSeconds === null ? iso.slice(0, -1) : null,
    wallTimeResolutionSeconds,
    jdUt, jdTt, deltaTYear, deltaTSeconds, deltaTSource: 'ephemera-model',
    taiMinusUtcSeconds, leapSecond,
    offset: {
      value: offsetText,
      seconds: offsetSeconds,
      source: manualSeconds === null ? 'iana-runtime' : 'user-override',
      certainty: manualSeconds !== null ? 'user-supplied' : historicalZone ? 'historical-estimate' : 'runtime-zone-data',
      zone: timeZone ?? null,
      transition: !timeZone ? null : candidates.length === 0 ? 'gap' : candidates.length === 1 ? 'unique' : 'fold',
      foldChoice,
    },
    warnings,
  };
}
