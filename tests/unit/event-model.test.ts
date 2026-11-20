import { describe, expect, it } from 'vitest';
import type { AspectPass, AstrologyEvent, EventMoment } from '../../src/domain/event';
import { classify, groupByMonth, matchesFilter, passViews, primaryMoment, retrogradeAt, sortEvents, summarize } from '../../src/view/event-model';

const at = (utc: string | null, jdTt: number | null = utc ? Date.parse(utc) / 86_400_000 + 2440587.5 : null): EventMoment =>
  ({ utc, jdTt, jdUt: jdTt });

const station = (id: string, utc: string | null, turns: 'direct' | 'retrograde', planetId: 'mercury' | 'venus' = 'mercury'): AstrologyEvent =>
  ({ id, kind: 'station', timing: 'past', planet: { chartId: 'transit', planetId }, at: at(utc), turns });

const pass = (utc: string, state: AspectPass['state'] = 'exact'): AspectPass =>
  ({ at: at(utc), state, residualDeg: state === 'near-miss' ? 0.4 : 0, toleranceDeg: 0.001 });

const window = (id: string, passes: AspectPass[], start = '2024-04-01T00:00:00Z', end = '2024-04-30T00:00:00Z'): AstrologyEvent => ({
  id, kind: 'aspect-window', timing: 'future', transit: { chartId: 'transit', planetId: 'mercury' },
  target: { chartId: 'natal', planetId: 'sun' }, aspect: 'square', startsAt: at(start), endsAt: at(end),
  clippedStart: false, clippedEnd: false, passes, allowedOrbDeg: 6,
});

describe('event classification and filtering', () => {
  const exact = window('exact', [pass('2024-04-10T00:00:00Z')]);
  const near = window('near', [pass('2024-04-12T00:00:00Z', 'near-miss')]);
  const bare = window('bare', []);
  const stat = station('s', '2024-04-02T00:00:00Z', 'retrograde');
  const all = [exact, near, bare, stat];

  it('separates exact contacts, near misses, bare windows and stations', () => {
    expect(all.map(classify)).toEqual(['exact', 'near-miss', 'window', 'station']);
    expect(summarize(all)).toEqual({ station: 1, exact: 1, 'near-miss': 1, window: 1 });
  });

  it('shows exact contacts and stations by default, stations only, or everything', () => {
    expect(all.filter(event => matchesFilter(event, 'exact'))).toEqual([exact, stat]);
    expect(all.filter(event => matchesFilter(event, 'station'))).toEqual([stat]);
    expect(all.filter(event => matchesFilter(event, 'all'))).toEqual(all);
  });

  it('files an event under its first exact contact, otherwise the first pass, otherwise its window', () => {
    expect(primaryMoment(window('x', [pass('2024-04-05T00:00:00Z', 'near-miss'), pass('2024-04-09T00:00:00Z', 'refined')]))?.utc)
      .toBe('2024-04-09T00:00:00Z');
    expect(primaryMoment(near)?.utc).toBe('2024-04-12T00:00:00Z');
    expect(primaryMoment(bare)?.utc).toBe('2024-04-01T00:00:00Z');
    expect(primaryMoment(stat)?.utc).toBe('2024-04-02T00:00:00Z');
  });
});

describe('ordering and month grouping', () => {
  it('sorts chronologically by the filed moment, stably, with undated events last', () => {
    const late = station('late', '2024-06-01T00:00:00Z', 'direct');
    const early = window('early', [pass('2024-04-03T00:00:00Z')]);
    const undated = station('undated', null, 'direct');
    const tieA = station('a', '2024-05-01T00:00:00Z', 'direct');
    const tieB = station('b', '2024-05-01T00:00:00Z', 'retrograde');
    expect(sortEvents([undated, late, tieA, tieB, early]).map(event => event.id)).toEqual(['early', 'a', 'b', 'late', 'undated']);
  });

  it('groups consecutive events by UTC month with a readable label', () => {
    const events = sortEvents([
      station('1', '2024-04-30T23:59:00Z', 'direct'), station('2', '2024-05-01T00:00:00Z', 'direct'),
      station('3', '2024-05-20T10:00:00Z', 'retrograde'), station('4', null, 'direct'),
    ]);
    const groups = groupByMonth(events);
    expect(groups.map(group => [group.label, group.events.map(event => event.id)])).toEqual([
      ['April 2024', ['1']], ['May 2024', ['2', '3']], ['Date unavailable', ['4']],
    ]);
  });
});

describe('retrograde passes', () => {
  const stations = [station('r', '2024-04-01T22:00:00Z', 'retrograde'), station('d', '2024-04-25T12:00:00Z', 'direct')];
  const jd = (utc: string) => at(utc).jdTt;

  it('is retrograde between a retrograde station and the next direct one', () => {
    expect(retrogradeAt('mercury', jd('2024-04-10T00:00:00Z'), stations)).toBe(true);
    expect(retrogradeAt('mercury', jd('2024-05-10T00:00:00Z'), stations)).toBe(false);
  });

  it('infers the state before the first station from that station', () => {
    expect(retrogradeAt('mercury', jd('2024-03-20T00:00:00Z'), stations)).toBe(false);
    expect(retrogradeAt('mercury', jd('2024-04-20T00:00:00Z'), [stations[1]])).toBe(true);
    expect(retrogradeAt('mercury', jd('2024-03-01T00:00:00Z'), [stations[1]])).toBe(true);
  });

  it('stays unknown without a station of that planet or a usable time', () => {
    expect(retrogradeAt('venus', jd('2024-04-10T00:00:00Z'), stations)).toBeNull();
    expect(retrogradeAt('mercury', null, stations)).toBeNull();
    expect(retrogradeAt('mercury', jd('2024-04-10T00:00:00Z'), [])).toBeNull();
  });

  it('numbers the exact contacts of a window and flags the retrograde ones', () => {
    const triple = window('t', [pass('2024-03-28T00:00:00Z'), pass('2024-04-12T00:00:00Z'), pass('2024-04-20T00:00:00Z', 'near-miss'), pass('2024-05-02T00:00:00Z')]);
    if (triple.kind !== 'aspect-window') throw new Error('expected a window');
    const views = passViews(triple, [triple, ...stations]);
    expect(views.map(view => view.number)).toEqual([1, 2, null, 3]);
    expect(views.map(view => view.retrograde)).toEqual([false, true, true, false]);
  });
});
