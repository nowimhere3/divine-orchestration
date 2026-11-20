import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, expect, test } from 'vitest';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import { normalizeBirthTime, resolveBirthTime } from '../../src/time/resolve';
import type { BirthTimeInput, ResolvedInstant } from '../../src/time/resolve';

let deltaT: (year: number) => number;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const bytes = await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm'));
  deltaT = (await createEphemeraEngine(bytes)).modelDeltaTSeconds;
});

function resolved(input: BirthTimeInput): ResolvedInstant {
  const result = resolveBirthTime(input, deltaT);
  if (result.kind !== 'resolved') throw new Error(`Time resolution failed: ${JSON.stringify(result)}`);
  return result;
}

test('requires a choice for a DST fold and exposes both instants', () => {
  const input = { date: '2024-11-03', time: '01:30', timeZone: 'America/New_York' };
  expect(resolveBirthTime(input, deltaT)).toMatchObject({
    kind: 'unresolved', reason: 'ambiguous-wall-time',
    candidates: [
      { utc: '2024-11-03T05:30:00.000Z', offset: '-04:00' },
      { utc: '2024-11-03T06:30:00.000Z', offset: '-05:00' },
    ],
  });
  expect(resolved({ ...input, disambiguation: 'earlier' })).toMatchObject({
    utc: '2024-11-03T05:30:00.000Z', wallTimeResolutionSeconds: 60,
    offset: { source: 'iana-runtime', transition: 'fold', foldChoice: 'earlier' },
  });
  expect(resolved({ ...input, disambiguation: 'later' }).utc).toBe('2024-11-03T06:30:00.000Z');
  expect(resolved({ ...input, offsetOverride: '-05:00' }).offset).toMatchObject({
    source: 'user-override', transition: 'fold', foldChoice: 'later',
  });
});

test.each([
  ['2024-03-10', '02:30', 'America/New_York'],
  ['2024-10-06', '02:15', 'Australia/Lord_Howe'],
  ['2011-12-30', '12:00', 'Pacific/Apia'],
])('rejects the nonexistent wall time %s %s in %s', (date, time, timeZone) => {
  expect(resolveBirthTime({ date, time, timeZone, disambiguation: 'later' }, deltaT)).toMatchObject({
    kind: 'unresolved', reason: 'nonexistent-wall-time',
  });
});

test('uses an explicit offset for a gap only as an override with provenance', () => {
  const result = resolved({ date: '2024-03-10', time: '02:30', timeZone: 'America/New_York', offsetOverride: '-05:00' });
  expect(result).toMatchObject({
    utc: '2024-03-10T07:30:00.000Z',
    offset: { source: 'user-override', transition: 'gap', foldChoice: null },
  });
  expect(result.warnings).toContain('offset-override-differs-from-zone');
});

test('preserves a historical override with seconds and labels pre-UTC UT1', () => {
  const input = { date: '1900-01-01', time: '12:00:00', timeZone: 'Europe/Paris' };
  expect(resolved(input).warnings).toContain('historical-zone-offset-uncertain');
  const result = resolved({ ...input, offsetOverride: '+00:09:22' });
  expect(result).toMatchObject({
    input: { ...input, offsetOverride: '+00:09:22' },
    utc: null, historicalUt1Iso: '1900-01-01T11:50:38.000', taiMinusUtcSeconds: null,
    offset: { seconds: 562, source: 'user-override', certainty: 'user-supplied' },
  });
  expect(result.warnings).toEqual(expect.arrayContaining([
    'pre-utc-ut1-approximation', 'modeled-delta-t',
  ]));
  expect(resolved({ ...input, timeZone: 'UTC', offsetOverride: '+00:09:22' }).warnings)
    .toContain('offset-override-differs-from-zone');
  expect((result.jdTt - result.jdUt) * 86400).toBeCloseTo(result.deltaTSeconds, 4);
  expect(resolved({ date: '1965-01-01', time: '00:00:00', timeZone: 'UTC' }).taiMinusUtcSeconds)
    .toBeCloseTo(3.540130, 6);
});

test('supports a valid leap second in a local zone and preserves the UTC label', () => {
  const date = '2016-12-31';
  const timeZone = 'America/New_York';
  const before = resolved({ date, time: '18:59:59.500', timeZone });
  const leap = resolved({ date, time: '18:59:60.500', timeZone });
  const after = resolved({ date, time: '19:00:00.500', timeZone });
  expect(leap).toMatchObject({
    utc: '2016-12-31T23:59:60.500Z', leapSecond: true, taiMinusUtcSeconds: 36,
    wallTimeResolutionSeconds: 0.001,
  });
  expect(after.taiMinusUtcSeconds).toBe(37);
  expect((leap.jdTt - before.jdTt) * 86400).toBeCloseTo(1, 4);
  expect((after.jdTt - leap.jdTt) * 86400).toBeCloseTo(1, 4);
});

test('matches the USNO J2000 epoch and supplies B1 with UT1, TT and model year', () => {
  const input = { date: '2000-01-01', time: '11:58:55.816', offsetOverride: '+00:00' };
  const result = resolved(input);
  expect(result).toMatchObject({ jdTt: 2451545, utc: '2000-01-01T11:58:55.816Z', taiMinusUtcSeconds: 32 });
  expect(result.deltaTYear).toBeGreaterThan(2000);
  expect((result.jdTt - result.jdUt) * 86400).toBeCloseTo(result.deltaTSeconds, 4);
  expect(resolved({ date: '2040-01-01', time: '00:00', timeZone: 'UTC' }).warnings).toContain('future-utc-assumption');
});

test.each([
  [{ date: '2023-02-29', time: null }, 'invalid-date'],
  [{ date: '2024-01-01', time: '24:00', timeZone: 'UTC' }, 'invalid-time'],
  [{ date: '2024-01-01', time: '12:00', timeZone: 'Mars/Olympus' }, 'invalid-zone'],
  [{ date: '2024-01-01', time: '12:00', timeZone: '+01:00' }, 'invalid-zone'],
  [{ date: '2024-01-01', time: '12:00', offsetOverride: '-00:00' }, 'invalid-offset'],
  [{ date: '2024-01-01', time: '12:00' }, 'missing-zone-or-offset'],
  [{ date: '2016-12-31', time: '12:00:60', timeZone: 'UTC' }, 'invalid-leap-second'],
  [{ date: '2016-12-30', time: '23:59:60', offsetOverride: '+00:00' }, 'invalid-leap-second'],
] as const)('rejects invalid input %j', (input, reason) => {
  expect(resolveBirthTime(input, deltaT)).toMatchObject({ kind: 'unresolved', reason });
});

test('preserves a date without manufacturing a birth instant', () => {
  const input = { date: '2024-02-29', time: null, timeZone: 'Asia/Kathmandu' };
  expect(resolveBirthTime(input, deltaT)).toEqual({
    kind: 'unknown-time', input, calendar: 'proleptic-gregorian',
  });
});

test.each([
  ['2:00', '02:00'], ['9:30', '09:30'], ['02:00', '02:00'], ['14:00', '14:00'], [' 7:05:09 ', '07:05:09'], ['0:00', '00:00'],
  ['2:00:30.5', '02:00:30.5'],
])('normalizes the local birth time %s to %s', (text, expected) => {
  expect(normalizeBirthTime(text)).toBe(expected);
});

test.each(['2:00 PM', '2pm', '2', '200', '2.00', '24:00', '2:60', '12:5', '', '1:2:3'])('does not reinterpret or accept %s', text => {
  const result = resolveBirthTime({ date: '2024-01-01', time: normalizeBirthTime(text), timeZone: 'UTC' }, deltaT);
  expect(result).toMatchObject({ kind: 'unresolved', reason: 'invalid-time' });
});

test('an unpadded hour resolves to the same instant as the padded one', () => {
  const a = resolveBirthTime({ date: '2024-01-01', time: normalizeBirthTime('2:00'), timeZone: 'America/Edmonton' }, deltaT);
  const b = resolveBirthTime({ date: '2024-01-01', time: '02:00', timeZone: 'America/Edmonton' }, deltaT);
  expect(a).toEqual(b);
  expect(a.kind).toBe('resolved');
});
