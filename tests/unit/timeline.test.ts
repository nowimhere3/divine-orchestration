import { describe, expect, it } from 'vitest';
import { relativeLabel } from '../../src/view/timeline';

const now = Date.parse('2026-11-19T20:00:00Z');
const hour = 3_600_000;
const day = 24 * hour;

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
