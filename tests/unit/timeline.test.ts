import { describe, expect, it } from 'vitest';
import { relativeLabel, timelineBounds } from '../../src/view/timeline';

const now = Date.parse('2026-11-19T20:00:00Z');
const hour = 3_600_000;
const day = 24 * hour;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('relativeLabel', () => {
  it('names the present moment', () => {
    expect(relativeLabel(now, now)).toBe('Right now');
    expect(relativeLabel(now + 60_000, now)).toBe('Right now');
    expect(relativeLabel(now - 80_000, now)).toBe('Right now');
  });

  it('chooses a readable unit in both directions', () => {
    expect(relativeLabel(now + 10 * 60_000, now)).toBe('in 10 minutes');
    expect(relativeLabel(now - 5 * hour, now)).toBe('5 hours ago');
    expect(relativeLabel(now + 3 * day, now)).toBe('in 3 days');
    expect(relativeLabel(now - 21 * day, now)).toBe('3 weeks ago');
    expect(relativeLabel(now + 120 * day, now)).toBe('in 4 months');
    expect(relativeLabel(now - 3 * 365.25 * day, now)).toBe('3 years ago');
  });
});

describe('timelineBounds', () => {
  it('computes symmetric calendar-month bounds for ±3, ±6 and ±12 months', () => {
    const center = Date.parse('2026-06-15T00:00:00Z');
    const m3 = timelineBounds(center, 3);
    expect([isoDate(m3.first), isoDate(m3.last)]).toEqual(['2026-03-15', '2026-09-15']);

    const m6 = timelineBounds(center, 6);
    expect([isoDate(m6.first), isoDate(m6.last)]).toEqual(['2025-12-15', '2026-12-15']);

    const m12 = timelineBounds(center, 12);
    expect([isoDate(m12.first), isoDate(m12.last)]).toEqual(['2025-06-15', '2027-06-15']);
  });

  it('handles month-end and leap-year calendar arithmetic accurately', () => {
    const may31NonLeap = Date.parse('2026-05-31T00:00:00Z');
    const b1 = timelineBounds(may31NonLeap, 3);
    expect([isoDate(b1.first), isoDate(b1.last)]).toEqual(['2026-02-28', '2026-08-31']);

    const may31Leap = Date.parse('2024-05-31T00:00:00Z');
    const b2 = timelineBounds(may31Leap, 3);
    expect([isoDate(b2.first), isoDate(b2.last)]).toEqual(['2024-02-29', '2024-08-31']);

    const feb29Leap = Date.parse('2024-02-29T00:00:00Z');
    const b3 = timelineBounds(feb29Leap, 12);
    expect([isoDate(b3.first), isoDate(b3.last)]).toEqual(['2023-02-28', '2025-02-28']);
  });

  it('clamps bounds to the supported ephemeris range (1550-01-01 .. 2650-01-03)', () => {
    const nearMin = timelineBounds(Date.parse('1550-02-10T00:00:00Z'), 6);
    expect([isoDate(nearMin.first), isoDate(nearMin.last)]).toEqual(['1550-01-01', '1550-08-10']);

    const nearMax = timelineBounds(Date.parse('2649-10-15T00:00:00Z'), 12);
    expect([isoDate(nearMax.first), isoDate(nearMax.last)]).toEqual(['2648-10-15', '2650-01-03']);
  });
});
