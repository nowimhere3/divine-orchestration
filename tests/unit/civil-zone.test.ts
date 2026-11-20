import { expect, test } from 'vitest';
import { localClock } from '../../src/time/civil-zone';
import { resolveBirthTime } from '../../src/time/resolve';

const zone = 'America/Edmonton';
test.each([
  ['1995-01-15', '12:00', '19:00', '-07:00'],
  ['1995-07-15', '12:00', '18:00', '-06:00'],
  ['2026-10-31', '16:00', '22:00', '-06:00'],
  ['2026-11-01', '01:30', '07:30', '-06:00'],
  ['2027-01-15', '12:00', '18:00', '-06:00'],
  ['2027-03-14', '02:30', '08:30', '-06:00'],
])('Edmonton %s %s resolves and round trips', (date, time, utcClock, offset) => {
  const result = resolveBirthTime({ date, time, timeZone: zone }, () => 69);
  if (result.kind !== 'resolved') throw Error(result.kind);
  expect(result.utc).toBe(date + 'T' + utcClock + ':00.000Z');
  expect(result.offset.source).toBe(date >= '2026-11-01' ? 'alberta-rule' : 'iana-runtime');
  expect(localClock(Date.parse(result.utc!), zone)).toEqual({ date, clock: time, offset });
});

test('historical Edmonton fold, gap and manual overrides retain their meaning', () => {
  const birth = { timeZone: zone, date: '2025-11-02', time: '01:30' };
  expect(resolveBirthTime(birth, () => 69)).toMatchObject({ reason: 'ambiguous-wall-time' });
  expect(resolveBirthTime({ ...birth, date: '2026-03-08', time: '02:15' }, () => 69))
    .toMatchObject({ reason: 'nonexistent-wall-time' });
  expect(resolveBirthTime({ ...birth, date: '2027-01-01', offsetOverride: '-07:00' }, () => 69))
    .toMatchObject({ utc: '2027-01-01T08:30:00.000Z', offset: { source: 'user-override' }, warnings: expect.arrayContaining(['offset-override-differs-from-zone']) });
});
