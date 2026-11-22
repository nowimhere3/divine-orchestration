import { PERSONAL_IMPACT_MODEL, scoreResearchImpact } from '../research/impact';
import type { PersonalImpactScore } from '../research/impact';
import { impactCycleKeys } from '../research/impact-cycles';
import { findResearchConvergences } from '../research/convergence';
import { rankResearchSelection, researchExportChoices } from '../research/export-selection';
import type { PersonalizedResearchScope, ResearchSelection } from '../research/export-selection';
import type { ResearchExportEventV1, selectResearchEvents } from './research-events';
import type { ProjectMoment } from './research-privacy';
import { angle, aspect, house, knownValue, planet } from './research-privacy';

export const IMPACT_CONVENTION = 'Personal Impact is an astrological significance score. It expresses no probability of a life outcome.';

export function preparePersonalizedSelection(selection: ResearchSelection, scope: PersonalizedResearchScope, includeLinked: boolean) {
  const choices = researchExportChoices(selection);
  const { stages, filters, groups } = selection;
  const cutoff = filters.minimumImpact;
  if (cutoff !== null && (!Number.isInteger(cutoff) || cutoff < 0 || cutoff > 100)) throw new Error('Invalid Impact cutoff.');
  knownValue(['all', 'relevant', 'primary', 'context'], filters.scope);
  knownValue(['exact', 'station', 'all'], filters.category);
  knownValue(['chronological', 'relevance', 'impact', 'priority'], filters.sort);
  knownValue([10, 20, 50, null], filters.top);
  if (scope !== 'current' && includeLinked) throw new Error('Optional linked evidence applies only to current results.');
  const scores = scoreResearchImpact(selection.session);
  const cycles = impactCycleKeys(scores);
  const expected = rankResearchSelection(selection.session, filters, scores, cycles).selection;
  if (expected.stages.inViewScope !== stages.inViewScope || expected.stages.afterDisplayFilters !== stages.afterDisplayFilters ||
      expected.stages.afterImpact !== stages.afterImpact || expected.groups.length !== groups.length ||
      groups.some((group, index) => {
        const actual = expected.groups[index];
        return group.primaryId !== actual.primaryId || group.linkedIds.length !== actual.linkedIds.length ||
          group.linkedIds.some((id, linkedIndex) => id !== actual.linkedIds[linkedIndex]);
      })) throw new Error('The frozen selection differs from the ranked Events results.');
  const identities = new Map<string, {
    role: 'primary' | 'linked'; displayRank: number; representative: string; included: boolean;
  }>();
  for (const [index, group] of groups.entries()) {
    if (filters.top === null && group.linkedIds.length) throw new Error('Unexpected linked windows for Top All.');
    for (const id of [group.primaryId, ...group.linkedIds]) {
      if (identities.has(id)) throw new Error('A research event occurs more than once in the selection.');
      const primary = id === group.primaryId;
      identities.set(id, { role: primary ? 'primary' : 'linked', displayRank: index + 1,
        representative: group.primaryId, included: primary || includeLinked });
    }
  }
  const ids = scope === 'current' ? new Set([...identities].filter(([, item]) => item.included).map(([id]) => id)) : undefined;
  return { choices, identities, ids, scores, cycles };
}

function projectImpact(
  score: PersonalImpactScore, event: ResearchExportEventV1, aliases: ReadonlyMap<string, string>,
) {
  const { components, evidence, natalPlanetEvidence: natal } = score;
  const contribution = <R extends string>({ points, possiblePoints, reason, missing }: {
    points: number; possiblePoints: number; reason: R; missing: PersonalImpactScore['missingData'];
  }) => ({ points, possiblePoints, reason, missing: [...missing] });
  const rawWindows = 'windows' in evidence ? evidence.windows : [];
  const best = 'windows' in evidence ? evidence.bestPass : null;
  const bestPass = best && { eventId: aliases.get(best.eventId)!, passIndex: best.passIndex + 1 };
  const projectedWindows = [event.facts, ...event.axisCompanions];
  return {
    modelVersion: PERSONAL_IMPACT_MODEL, total: score.total, possibleUpperBound: score.possibleUpperBound, band: score.band,
    components: {
      natalConnection: contribution(components.natalConnection), planetaryCycle: contribution(components.planetaryCycle),
      precision: contribution(components.precision), contactType: contribution(components.contactType),
    },
    missingData: [...score.missingData],
    natalPlanetEvidence: natal && {
      planetId: planet(natal.planetId), houseId: natal.houseId === null ? null : house(natal.houseId),
      traditionalAngularHousesRuled: natal.traditionalAngularHousesRuled?.map(house) ?? null,
      isTraditionalChartRuler: natal.isTraditionalChartRuler,
    },
    evidence: {
      bestPass,
      windows: rawWindows.map(window => {
        const id = aliases.get(window.facts.id);
        const facts = projectedWindows.find(item => item.id === id);
        if (!facts || !('series' in facts)) throw new Error('Impact evidence has no corresponding exported contact window.');
        return { eventId: facts.id, seriesId: facts.series.id, observedDays: window.observedDays,
          durationIsMinimum: window.durationIsMinimum, exactPassCountInWindow: window.exactPassCountInWindow,
          exactPassCountInSeries: facts.series.exactPassCountInRange, seriesComplete: facts.series.complete };
      }),
    },
  };
}

export interface ResearchExportEventV2 extends ResearchExportEventV1 {
  readonly cycleId: string;
  readonly personalImpact: ReturnType<typeof projectImpact>;
  readonly selection: {
    readonly role: 'primary' | 'linked' | 'scope';
    readonly displayRank: number | null;
    readonly representativeId: string | null;
  };
}

function contactDescription(event: ResearchExportEventV2): string {
  const { facts } = event;
  if (facts.kind === 'station') return `${planet(facts.planetId)} station ${facts.turns}`;
  if (facts.kind === 'house-ingress') return `${planet(facts.planetId)} crosses house ${house(facts.cuspHouseId)}`;
  const target = facts.kind === 'aspect-window' ? planet(facts.natalPlanetId) : angle(facts.targetAngle).toUpperCase();
  return `${planet(facts.transitPlanetId)} ${aspect(facts.aspect)} natal ${target}`;
}

export function projectPersonalizedResearch(
  frozen: ResearchSelection, scope: PersonalizedResearchScope, includeLinked: boolean,
  chosen: ReturnType<typeof preparePersonalizedSelection>, base: ReturnType<typeof selectResearchEvents>, moment: ProjectMoment,
) {
  const { session, filters, stages } = frozen;
  const { scores, cycles } = chosen;
  const cycleAliases = new Map<string, string>();
  for (const key of cycles.values()) if (!cycleAliases.has(key)) cycleAliases.set(key, `cycle-${cycleAliases.size + 1}`);
  const byAlias = new Map(base.events.map(item => [item.id, item]));
  const exported: ResearchExportEventV2[] = [];
  const byContact = new Map<string, ResearchExportEventV2>();
  const rawAliases = new Map(session.rawResult.events.map((event, index) => [event.id, `event-${index + 1}`]));
  for (const [rawId, alias] of base.eventAliases) {
    const score = scores.byEventId.get(rawId);
    if (!score) throw new Error('The selected event is missing its Impact score.');
    const cycleId = cycleAliases.get(cycles.get(score)!);
    if (!cycleId) throw new Error('The selected event is missing its cycle identity.');
    const item = scope === 'current' ? chosen.identities.get(rawId) : undefined;
    const event: ResearchExportEventV2 = {
      ...byAlias.get(alias)!, cycleId,
      personalImpact: projectImpact(score, byAlias.get(alias)!, rawAliases),
      selection: {
        role: item?.role ?? 'scope', displayRank: item?.displayRank ?? null,
        representativeId: item ? base.eventAliases.get(item.representative)! : null,
      },
    };
    exported.push(event);
    byContact.set(score.contactKey, event);
  }

  const selection = {
    scope,
    filters: {
      scope: knownValue(['relevant', 'primary', 'context', 'all'], filters.scope),
      category: knownValue(['exact', 'station', 'all'], filters.category),
      sort: knownValue(['chronological', 'relevance', 'impact', 'priority'], filters.sort),
      minimumImpact: filters.minimumImpact, top: knownValue([10, 20, 50, null], filters.top),
      showMoon: Boolean(filters.showMoon), multiThemeOnly: Boolean(filters.multiThemeOnly), matchTheme: Boolean(filters.matchTheme),
    },
    linkedEvidenceIncluded: includeLinked,
    counts: {
      ...chosen.choices,
      exported: exported.length,
      excludedFromComplete: chosen.choices.complete - exported.length,
      distinctCycles: new Set(exported.map(event => event.cycleId)).size,
      primary: scope === 'current' ? chosen.choices.current : exported.length,
      linkedIncluded: scope === 'current' && includeLinked ? chosen.choices.linked : 0,
    },
    currentExclusions: scope === 'current' ? {
      outsideViewScope: chosen.choices.complete - stages.inViewScope,
      displayFilters: stages.inViewScope - stages.afterDisplayFilters,
      impactCutoff: stages.afterDisplayFilters - stages.afterImpact,
      topLimit: stages.afterImpact - chosen.identities.size,
      linkedEvidence: includeLinked ? 0 : chosen.choices.linked,
    } : null,
  };
  const strongest = [...exported].sort((a, b) => b.personalImpact.total - a.personalImpact.total).slice(0, 5)
    .map(event => ({ eventId: event.id, label: contactDescription(event), personalImpact: event.personalImpact.total,
      themeRelevance: event.relevance.score }));
  const convergence = findResearchConvergences(session, {
    ...frozen.overlap, selectedEventIds: new Set(base.eventAliases.keys()),
  });
  const highlights = convergence.periods.map((period, i) => ({ period, periodNumber: i + 1 }))
    .sort((a, b) => b.period.peakConcurrentBodies - a.period.peakConcurrentBodies || b.period.observedDays - a.period.observedDays)
    .slice(0, 3).sort((a, b) => a.periodNumber - b.periodNumber)
    .map(({ period, periodNumber }) => {
      const peak = period.segments.filter(segment => segment.bodies.length === period.peakConcurrentBodies)
        .reduce((longest, segment) => segment.end.jdTt - segment.start.jdTt > longest.end.jdTt - longest.start.jdTt ? segment : longest);
      const rankedContacts = [...period.contacts].sort((a, b) => b.total - a.total);
      const representatives = period.bodies.map(body => rankedContacts.find(contact => contact.transitingBody === body)!);
      const contacts = [...new Set([...representatives, ...rankedContacts])].map(contact => byContact.get(contact.contactKey)!.id);
      return {
        periodNumber, start: moment(period.start), end: moment(period.end), observedDays: period.observedDays,
        clippedStart: period.clippedStart, clippedEnd: period.clippedEnd, complete: period.complete,
        bodies: period.bodies.map(planet), peakConcurrentBodies: period.peakConcurrentBodies,
        peak: { start: moment(peak.start), end: moment(peak.end), bodies: peak.bodies.map(planet) },
        contactCount: contacts.length,
        eventIds: contacts.slice(0, 12),
        markerCount: period.markers.length,
        markers: period.markers.slice(0, 3).map(marker => ({
          eventId: byContact.get(marker.contactKey)!.id, at: moment(marker.at),
          kind: knownValue(['exact-pass', 'station', 'house-ingress'], marker.kind),
        })),
      };
    });
  return {
    events: exported,
    personalized: {
      modelVersion: PERSONAL_IMPACT_MODEL, convention: IMPACT_CONVENTION, selection,
      overview: {
        strongest, strongestLimit: 5, limitedImpactEvidence: exported.filter(event => event.personalImpact.missingData.length).length,
        overlaps: {
          minimumImpact: convergence.minimumImpact, includeMoonMarkers: convergence.includeMoonMarkers,
          totalPeriods: convergence.periods.length, omittedWindows: convergence.omittedWindows.length,
          highlightLimit: 3, eventRefsPerHighlight: 12, markerRefsPerHighlight: 3, highlights,
        },
      },
    },
  };
}

export type PersonalizedResearchV2 = ReturnType<typeof projectPersonalizedResearch>['personalized'];
