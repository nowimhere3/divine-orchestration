import type { PersonalImpactResult, PersonalImpactScore } from './impact';

/** Give both ends of folded axes, and all windows linked by either series, one ranking key. */
export function impactCycleKeys(impact: PersonalImpactResult): ReadonlyMap<PersonalImpactScore, string> {
  const links = new Map<string, string>();
  function root(key: string): string {
    let parent = key;
    while (links.has(parent)) parent = links.get(parent)!;
    while (key !== parent) {
      const next = links.get(key)!;
      links.set(key, parent);
      key = next;
    }
    return parent;
  }
  const seriesOf = new Map<PersonalImpactScore, string>();
  for (const score of impact.scores) {
    if (!('windows' in score.evidence) || !score.evidence.windows.length) continue;
    const [first, ...companions] = score.evidence.windows.map(window => window.facts.series.id);
    seriesOf.set(score, first);
    for (const id of companions) {
      const left = root(first);
      const right = root(id);
      if (left !== right) links.set(right, left);
    }
  }
  return new Map(impact.scores.map(score => {
    const series = seriesOf.get(score);
    return [score, series === undefined ? `contact:${score.contactKey}` : `series:${root(series)}`];
  }));
}
