import { expect, test } from 'vitest';
import type { EvaluatedEvent, ImpactWindowEvidence, PersonalImpactResult, PersonalImpactScore } from '../../src/research';
import { impactCycleKeys, rankEventResults, researchPriority } from '../../src/view/event-ranking';

const moment = (day: number) => ({ jdTt: 2460000 + day, jdUt: null, utc: null });
const component = <Reason extends string>(reason: Reason) => ({ reason, points: 0, possiblePoints: 0, missing: [] });

function row(ordinal: number, total: number, day = ordinal, seriesIds = [`series-${ordinal}`], relevance = 20) {
  const ids = seriesIds.map((_, index) => `event-${ordinal}-${index}`);
  const windows = seriesIds.map((id, index): ImpactWindowEvidence => ({
    facts: {
      kind: 'aspect-window', id: ids[index], transit: { chartId: 'transit', planetId: 'saturn' },
      target: { chartId: 'natal', planetId: 'sun' }, aspect: 'square',
      startsAt: moment(day), endsAt: moment(day + 1), clippedStart: false, clippedEnd: false, passes: [], allowedOrbDeg: 2,
      series: { id, branchLongitudeDeg: 0, windowIndex: 0, windowCountInRange: 1, exactPassCountInRange: 0,
        isRetrogradeSeries: false, clippedStart: false, clippedEnd: false, complete: true },
    },
    observedStartTt: moment(day).jdTt, observedEndTt: moment(day + 1).jdTt, observedDays: 1,
    durationIsMinimum: false, exactPassCountInWindow: 0,
  }));
  const impact: PersonalImpactScore = {
    modelVersion: 'impact-v1', contactKey: String(ordinal), calculatedEventIds: ids, transitingBody: 'saturn',
    total, possibleUpperBound: Math.min(total + 10, 100), band: 'notable',
    components: {
      natalConnection: component('natal-luminary'), planetaryCycle: component('saturn'),
      precision: component('unobserved'), contactType: component('square'),
    },
    missingData: [], natalPlanetEvidence: null, evidence: { kind: 'aspect-window', windows, bestPass: null },
  };
  const item: EvaluatedEvent = {
    event: { ...windows[0].facts, timing: 'future' },
    axisCompanions: [],
    relevance: { tier: 'secondary', inFocus: true, excludedByFocus: false, rawScore: relevance, score: relevance,
      matchedThemeIds: [], matchedHouses: [], matchedAngles: [], reasons: [], whyRelevant: '' },
  };
  return { item, impact };
}

function getRanking(rows: readonly ReturnType<typeof row>[]) {
  const impact: PersonalImpactResult = {
    modelVersion: 'impact-v1',
    scores: rows.map(({ impact }) => impact),
    byEventId: new Map(rows.flatMap(({ impact }) => impact.calculatedEventIds.map(id => [id, impact] as const))),
    chartAvailability: {
      timeStatus: 'resolved', natalPositionsAvailable: true, natalUnavailableReason: null,
      housesAvailable: false, housesUnavailableReason: 'missing-location', effectiveHouseSystem: null, polarHouseFallback: false,
    },
    coverage: { status: 'complete', warnings: [], unavailable: [], range: {
      effectiveStart: moment(0), effectiveEnd: moment(100), requestedStart: moment(0), requestedEnd: moment(100),
      requestedDays: 100, effectiveDays: 100, chunkCount: 1, chunkDays: 100, clippedToCoverage: false,
      slowBodiesOnly: false, maxAllowedDays: 1827,
    } },
  };
  const cycles = impactCycleKeys(impact);
  return (options: Parameters<typeof rankEventResults>[3], shown = rows) =>
    rankEventResults(shown.map(entry => entry.item), impact, cycles, options);
}

test('distinguishes Off from inclusive 0 and filters on supported score through 100', () => {
  const rank = getRanking([row(0, 0), row(1, 66), row(2, 100)]);
  const options = { top: null, order: 'impact' } as const;
  expect(rank({ ...options, minimumImpact: null })).toEqual(rank({ ...options, minimumImpact: 0 }));
  expect(rank({ ...options, minimumImpact: 66 }).matchingWindows).toBe(2);
  expect(rank({ ...options, minimumImpact: 67 }).rows.map(r => r.impact.total)).toEqual([100]);
  expect(rank({ ...options, minimumImpact: 100 }).rows.map(r => r.impact.total)).toEqual([100]);
  expect(rank({ ...options, minimumImpact: 100 }, [row(1, 66)]).rows).toEqual([]);
});

test('limits distinct slots before pagination and breaks equal Impact ties by time then source ordinal', () => {
  const entries = Array.from({ length: 61 }, (_, i) => row(i, 80, Math.floor(i / 2))).reverse();
  const rank = getRanking(entries);
  for (const top of [10, 20, 50] as const) {
    const { rows, matchingWindows, matchingGroups, displayedWindows } = rank({ top, minimumImpact: null, order: 'impact' });
    expect(rows.map(r => r.impact.contactKey)).toEqual(Array.from({ length: top }, (_, i) => String(i)));
    expect([matchingWindows, matchingGroups, displayedWindows]).toEqual([61, 61, top]);
  }
});

test('groups return windows linked by folded series even when the bridge window is filtered out', () => {
  const bridge = row(0, 40, 1, ['axis-series-A', 'axis-series-B']);
  const early = row(1, 85, 4, ['axis-series-A']);
  const high = row(2, 95, 16, ['axis-series-B']);
  const outside = row(3, 50, 19, ['axis-series-A']);
  const other = row(4, 81, 17);
  const rank = getRanking([bridge, early, high, outside, other]);
  const onlyMatching = [early, high, outside, other];
  const result = rank({ top: 10, minimumImpact: 65, order: 'impact' }, onlyMatching);
  expect([result.matchingWindows, result.matchingGroups, result.displayedWindows]).toEqual([3, 2, 3]);
  expect(result.rows[0].item).toBe(high.item);
  expect(result.rows[0].returns).toEqual([early.item]);
  expect(rank({ top: null, minimumImpact: null, order: 'impact' }).rows).toHaveLength(5);
});

test('keeps Theme Relevance and Impact separate while applying the optional priority ordering', () => {
  const a = row(0, 90, 1, ['a'], 10);
  const b = row(1, 76, 2, ['b'], 100);
  const rank = getRanking([a, b]);
  const options = { top: null, minimumImpact: null } as const;
  expect(researchPriority(90, 10)).toBe(66);
  expect(rank({ ...options, order: 'impact' }).rows[0].item).toBe(a.item);
  expect(rank({ ...options, order: 'priority' }).rows[0].item).toBe(b.item);
  expect(rank({ ...options, order: 'priority', minimumImpact: 80 }).rows[0].item).toBe(a.item);
});
