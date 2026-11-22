import { researchFindingScopes } from './event-scope';
import type { ResearchSession } from './session';
import { scoreResearchImpact } from './impact';
import { impactCycleKeys } from './impact-cycles';
import { matchesRangeFilter } from '../view/event-model';
import { rankEventResults } from '../view/event-ranking';

export type ResultScope = 'relevant' | 'primary' | 'context' | 'all';
export type ResearchSelectionSort = 'chronological' | 'relevance' | 'impact' | 'priority';
export type ResearchSelectionTop = 10 | 20 | 50 | null;
export type PersonalizedResearchScope = 'current' | 'relevant' | 'complete';

export interface ResearchDisplayFilters {
  readonly scope: ResultScope;
  readonly category: 'exact' | 'station' | 'all';
  readonly minimumImpact: number | null;
  readonly top: ResearchSelectionTop;
  readonly sort: ResearchSelectionSort;
  readonly showMoon: boolean;
  readonly multiThemeOnly: boolean;
  readonly matchTheme: boolean;
}

export interface ResearchSelectionGroup {
  readonly primaryId: string;
  readonly linkedIds: readonly string[];
}

export interface ResearchSelection {
  readonly session: ResearchSession;
  readonly filters: ResearchDisplayFilters;
  readonly groups: readonly ResearchSelectionGroup[];
  readonly stages: {
    readonly inViewScope: number;
    readonly afterDisplayFilters: number;
    readonly afterImpact: number;
  };
  readonly overlap: { readonly minimumImpact: number; readonly includeMoonMarkers: boolean };
}

export function rankResearchSelection(
  session: ResearchSession, filters: ResearchDisplayFilters,
  impact = scoreResearchImpact(session), cycles = impactCycleKeys(impact),
) {
  const { complete } = researchFindingScopes(session);
  const inView = complete.filter(({ relevance }) => {
    switch (filters.scope) {
      case 'all': return true;
      case 'context': return relevance.tier === 'context';
      case 'primary': return relevance.tier === 'primary';
      case 'relevant': return relevance.tier !== 'context';
    }
  });
  const filtered = inView.filter(({ event, relevance }) => {
    const body = 'transit' in event ? event.transit.planetId : event.planet.planetId;
    return matchesRangeFilter(event, filters.category) &&
      (filters.showMoon || body !== 'moon') &&
      (!filters.matchTheme || relevance.matchedThemeIds.length > 0) &&
      (!filters.multiThemeOnly || relevance.matchedThemeIds.length >= 2);
  });
  const ranking = rankEventResults(filtered, impact, cycles, {
    minimumImpact: filters.minimumImpact, top: filters.top, order: filters.sort,
  });
  return {
    ranking,
    selection: {
      session, filters,
      stages: { inViewScope: inView.length, afterDisplayFilters: filtered.length, afterImpact: ranking.matchingWindows },
      groups: ranking.rows.map(row => ({ primaryId: row.item.event.id, linkedIds: row.returns.map(item => item.event.id) })),
    },
  };
}

/** Freeze the ranked rows before pagination. The bound session owns the query and theme snapshot. */
export function freezeResearchSelection(selection: ResearchSelection): ResearchSelection {
  return Object.freeze({
    session: selection.session,
    filters: Object.freeze({ ...selection.filters }),
    groups: Object.freeze(selection.groups.map(group => Object.freeze({
      primaryId: group.primaryId, linkedIds: Object.freeze([...group.linkedIds]),
    }))),
    stages: Object.freeze({ ...selection.stages }),
    overlap: Object.freeze({ ...selection.overlap }),
  });
}

export function researchExportChoices(selection: ResearchSelection) {
  const { relevant, complete } = researchFindingScopes(selection.session);
  return {
    current: selection.groups.length,
    linked: selection.groups.reduce((count, group) => count + group.linkedIds.length, 0),
    relevant: relevant.length,
    complete: complete.length,
  };
}
