import type { EvaluatedEvent, PersonalImpactResult, PersonalImpactScore } from '../research';
import type { ResearchSelectionSort, ResearchSelectionTop } from '../research/export-selection';
import { sortEvaluatedEvents } from './event-model';
export { impactCycleKeys } from '../research/impact-cycles';

export type EventRankingOrder = ResearchSelectionSort;
export type EventTopLimit = ResearchSelectionTop;

export interface RankedEventRow {
  readonly item: EvaluatedEvent;
  readonly impact: PersonalImpactScore;
  readonly returns: readonly EvaluatedEvent[];
}

interface Entry extends Omit<RankedEventRow, 'returns'> {
  readonly time: number;
  readonly ordinal: number;
}

function firstObservedTime(score: PersonalImpactScore): number {
  if ('windows' in score.evidence) {
    return Math.min(...score.evidence.windows.map(window =>
      window.observedStartTt ?? window.facts.passes[0]?.at.jdTt ?? window.observedEndTt ?? Infinity));
  }
  return score.evidence.facts.at.jdTt ?? Infinity;
}

function compareTime(a: Entry, b: Entry) {
  return a.time - b.time || a.ordinal - b.ordinal;
}

function compareImpact(a: Entry, b: Entry) {
  return b.impact.total - a.impact.total || compareTime(a, b);
}

export function researchPriority(impact: number, relevance: number): number {
  return Math.round(0.7 * impact + 0.3 * relevance);
}

/** The caller applies U6 scope and display predicates first. Pagination happens after this selection. */
export function rankEventResults(
  items: readonly EvaluatedEvent[],
  impact: PersonalImpactResult,
  cycleKeys: ReadonlyMap<PersonalImpactScore, string>,
  options: { minimumImpact: number | null; top: EventTopLimit; order: EventRankingOrder },
) {
  const { minimumImpact, top, order } = options;
  const byItem = new Map<EvaluatedEvent, Entry>();
  for (const item of items) {
    const score = impact.byEventId.get(item.event.id);
    if (!score) throw new Error('Event is missing from the bound Impact results.');
    if (minimumImpact !== null && score.total < minimumImpact) continue;
    byItem.set(item, { item, impact: score, time: firstObservedTime(score), ordinal: Number.parseInt(score.contactKey, 10) });
  }
  const matching = [...byItem.values()];
  const groupWindows = new Map<string, Entry[]>();
  if (top !== null) {
    for (const entry of matching.sort(compareImpact)) {
      const key = cycleKeys.get(entry.impact) ?? entry.impact.contactKey;
      const group = groupWindows.get(key);
      if (group) group.push(entry);
      else groupWindows.set(key, [entry]);
    }
  }
  const selected = top === null ? matching.map(entry => [entry]) : [...groupWindows.values()].slice(0, top);
  const rows = new Map(selected.map(([first, ...returns]) => [first.item, {
    item: first.item, impact: first.impact, returns: returns.sort(compareTime).map(entry => entry.item),
  }]));
  const representatives = [...rows.keys()];
  let ordered: readonly EvaluatedEvent[];
  if (order === 'chronological' || order === 'relevance') {
    ordered = sortEvaluatedEvents(representatives, order);
  } else {
    ordered = representatives.sort((a, b) => {
      const left = byItem.get(a)!;
      const right = byItem.get(b)!;
      const priority = order === 'priority'
        ? researchPriority(right.impact.total, b.relevance.score) - researchPriority(left.impact.total, a.relevance.score)
        : 0;
      return priority || compareImpact(left, right);
    });
  }
  return {
    matchingWindows: matching.length,
    matchingGroups: top === null ? matching.length : groupWindows.size,
    displayedWindows: selected.reduce((sum, group) => sum + group.length, 0),
    rows: ordered.map(item => rows.get(item)!),
  };
}
