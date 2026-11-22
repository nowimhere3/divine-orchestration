import type { PlanetId } from '../domain/chart';
import type { EventMoment } from '../domain/event';
import type { EventRelevance, RelevanceReason, RelevanceReasonCode } from '../research/relevance';
import type { ResearchSession } from '../research/session';
import { researchFindingScopes } from '../research/event-scope';
import type { RangeEvent } from '../search/range';
import { angle, aspect, house, houseSystem, knownValue, planet } from './research-privacy';
import type { ProjectMoment } from './research-privacy';

export type ResearchExportMode = 'focused' | 'complete' | 'research-package';

const REASON_LABELS: Record<RelevanceReasonCode, string> = {
  'house-ingress-focus': 'Crosses a boundary of a focus house',
  'natal-occupant-contact': 'Contacts a natal planet occupying a focus house',
  'house-ruler-contact': 'Contacts the traditional ruler of a focus house',
  'modern-coruler-contact': 'Contacts the modern co-ruler of a focus house',
  'angle-axis-contact': 'Contacts a focus angle on the natal axis',
  'station-in-focus-house': 'Changes direction in a focus house',
  'explicit-custom-target': 'Matches an explicit custom target',
  'multi-theme-convergence': 'Links multiple active themes',
  'natural-significator': 'Links through a symbolic planetary significator',
  'cycle-tempo-weight': 'Weighted by planetary cycle duration',
  'contact-precision': 'Weighted by contact precision',
  'angular-prominence': 'Highlights an angular house or cardinal axis',
  'broader-astronomical-context': 'Included as broader astronomical context',
};

function projectReason(reason: RelevanceReason, aliases: ReadonlyMap<string, string>, excludedByFocus: boolean) {
  const { code, points, params: p } = reason;
  if (!Object.hasOwn(REASON_LABELS, code)) throw new TypeError('Unknown relevance reason in research export.');
  const params = {
    ...(p.planetId === undefined ? {} : { planetId: planet(p.planetId) }),
    ...(p.targetPlanetId === undefined ? {} : { targetPlanetId: planet(p.targetPlanetId) }),
    ...(p.aspect === undefined ? {} : { aspect: aspect(p.aspect) }),
    ...(p.houseId === undefined ? {} : { houseId: house(p.houseId) }),
    ...(p.fromHouse === undefined ? {} : { fromHouse: house(p.fromHouse) }),
    ...(p.toHouse === undefined ? {} : { toHouse: house(p.toHouse) }),
    ...(p.signIndex === undefined ? {} : { signIndex: p.signIndex }),
    ...(p.angle === undefined ? {} : { angle: angle(p.angle) }),
    ...(p.oppositeAngle === undefined ? {} : { oppositeAngle: angle(p.oppositeAngle) }),
    ...(p.oppositeAspect === undefined ? {} : { oppositeAspect: aspect(p.oppositeAspect) }),
    ...(p.turns === undefined ? {} : { turns: knownValue(['direct', 'retrograde'], p.turns) }),
    ...(p.themeIds === undefined ? {} : { themeIds: p.themeIds.map(id => themeAlias(aliases, id)) }),
    ...(p.convergenceCount === undefined ? {} : { convergenceCount: p.convergenceCount }),
    ...(p.exactPassCount === undefined ? {} : { exactPassCount: p.exactPassCount }),
    ...(p.isRetrogradeSeries === undefined ? {} : { isRetrogradeSeries: p.isRetrogradeSeries }),
    ...(p.tempoGroup === undefined ? {} : { tempoGroup: knownValue(['outer', 'social', 'personal', 'lunar'], p.tempoGroup) }),
    ...(p.isDerivedOpposite === undefined ? {} : { isDerivedOpposite: p.isDerivedOpposite }),
  };
  const details = [
    params.planetId,
    params.targetPlanetId && `natal ${params.targetPlanetId}`,
    params.aspect,
    params.angle?.toUpperCase(),
    params.oppositeAngle && `${params.oppositeAspect ?? ''} ${params.oppositeAngle.toUpperCase()}`.trim(),
    params.houseId && `House ${params.houseId}`,
    params.fromHouse && params.toHouse && `House ${params.fromHouse} to House ${params.toHouse}`,
    params.turns,
    params.tempoGroup,
    params.exactPassCount !== undefined && `${params.exactPassCount} exact passes in range`,
    ...(params.themeIds ?? []),
  ].filter(Boolean);
  const label = code === 'broader-astronomical-context' && excludedByFocus
    ? 'Outside active focus filters, retained as requested broader context' : REASON_LABELS[code];
  return {
    code, points, category: knownValue(['astronomical', 'chart-linkage', 'symbolic-convention'], reason.category),
    params, summary: details.length ? `${label} (${details.join(', ')})` : label,
  };
}

function themeAlias(aliases: ReadonlyMap<string, string>, id: string): string {
  const alias = aliases.get(id);
  if (alias === undefined) throw new Error('Research relevance references a theme outside the bound query.');
  return alias;
}

function projectRelevance(relevance: EventRelevance, aliases: ReadonlyMap<string, string>) {
  const reasons = relevance.reasons.map(reason => projectReason(reason, aliases, relevance.excludedByFocus));
  return {
    tier: knownValue(['primary', 'secondary', 'context'], relevance.tier),
    inFocus: relevance.inFocus, excludedByFocus: relevance.excludedByFocus,
    rawScore: relevance.rawScore, score: relevance.score,
    matchedThemeIds: relevance.matchedThemeIds.map(id => themeAlias(aliases, id)),
    matchedHouses: relevance.matchedHouses.map(house), matchedAngles: relevance.matchedAngles.map(angle),
    reasons, whyRelevant: reasons.map(reason => reason.summary).join('. '),
  };
}

function projectEvent(
  event: RangeEvent, id: string, moment: ProjectMoment, seriesIds: ReadonlyMap<string, string>, residual: number | null,
) {
  const common = { id, timing: knownValue(['past', 'present', 'future', 'unknown'], event.timing) };
  switch (event.kind) {
    case 'station':
      return {
        ...common, kind: event.kind, planetId: planet(event.planet.planetId), at: moment(event.at),
        turns: knownValue(['direct', 'retrograde'], event.turns), residualDegPerDay: residual,
        inNatalHouse: event.inNatalHouse === null ? null : house(event.inNatalHouse),
      };
    case 'house-ingress':
      return {
        ...common, kind: event.kind, planetId: planet(event.planet.planetId), at: moment(event.at),
        cuspHouseId: house(event.cuspHouseId), fromHouse: house(event.fromHouse), toHouse: house(event.toHouse),
        retrograde: event.retrograde, houseSystem: houseSystem(event.houseSystem),
      };
    case 'aspect-window':
    case 'angle-aspect-window': {
      const s = event.series;
      const seriesId = seriesIds.get(s.id);
      if (!seriesId) throw new Error('Missing research series identity.');
      const window = {
        ...common, transitPlanetId: planet(event.transit.planetId), aspect: aspect(event.aspect),
        startsAt: moment(event.startsAt), endsAt: moment(event.endsAt),
        clippedStart: event.clippedStart, clippedEnd: event.clippedEnd, allowedOrbDeg: event.allowedOrbDeg,
        passes: event.passes.map(pass => ({
          at: moment(pass.at), state: knownValue(['exact', 'refined', 'near-miss'], pass.state),
          residualDeg: pass.residualDeg, toleranceDeg: pass.toleranceDeg,
          retrograde: pass.retrograde, passNumberInSeries: pass.passNumberInSeries,
        })),
        series: {
          id: seriesId, branchLongitudeDeg: s.branchLongitudeDeg, windowIndex: s.windowIndex,
          windowCountInRange: s.windowCountInRange, exactPassCountInRange: s.exactPassCountInRange,
          isRetrogradeSeries: s.isRetrogradeSeries, clippedStart: s.clippedStart, clippedEnd: s.clippedEnd, complete: s.complete,
        },
      };
      return event.kind === 'aspect-window'
        ? { ...window, kind: event.kind, natalPlanetId: planet(event.target.planetId) }
        : { ...window, kind: event.kind, targetAngle: angle(event.targetAngle) };
    }
  }
}

type ExportedFacts = ReturnType<typeof projectEvent>;
type ExportedAngle = Extract<ExportedFacts, { kind: 'angle-aspect-window' }>;

export interface ResearchExportEventV1 {
  readonly id: string;
  /** Point timestamp or visible window start, with clipped windows ordered at the effective start. */
  readonly orderAt: ReturnType<ProjectMoment>;
  readonly facts: ExportedFacts;
  readonly axisCompanions: readonly ExportedAngle[];
  readonly relevance: ReturnType<typeof projectRelevance>;
}

function bodyOf(event: RangeEvent): PlanetId {
  return 'transit' in event ? event.transit.planetId : event.planet.planetId;
}

function orderMoment(event: RangeEvent, effectiveStart: EventMoment): EventMoment {
  return 'at' in event ? event.at : event.startsAt ?? effectiveStart;
}

export function countExportEvents(events: readonly ResearchExportEventV1[]) {
  const byKind = { 'aspect-window': 0, 'angle-aspect-window': 0, 'house-ingress': 0, station: 0 };
  const byTier = { primary: 0, secondary: 0, context: 0 };
  const byBody: Partial<Record<PlanetId, number>> = {};
  const byTheme: Record<string, number> = {};
  const byHouse: Record<string, number> = {};
  let axisCompanions = 0;
  for (const { facts, relevance, axisCompanions: companions } of events) {
    const body = 'planetId' in facts ? facts.planetId : facts.transitPlanetId;
    byKind[facts.kind] += 1;
    byTier[relevance.tier] += 1;
    byBody[body] = (byBody[body] ?? 0) + 1;
    for (const id of relevance.matchedThemeIds) byTheme[id] = (byTheme[id] ?? 0) + 1;
    for (const id of relevance.matchedHouses) byHouse[id] = (byHouse[id] ?? 0) + 1;
    axisCompanions += companions.length;
  }
  return { total: events.length, byKind, byTier, byBody, byTheme, byHouse, moon: byBody.moon ?? 0, axisCompanions };
}

export function selectResearchEvents(
  session: ResearchSession, mode: ResearchExportMode, moment: ProjectMoment, aliases: ReadonlyMap<string, string>,
  selectedIds?: ReadonlySet<string>,
) {
  const { rawResult: raw, evaluated, query } = session;
  const rawById = new Map(raw.events.map((event, index) => [event.id, { event, index, alias: `event-${index + 1}` }]));
  const seriesIds = new Map<string, string>();
  for (const event of raw.events) {
    if ('series' in event && !seriesIds.has(event.series.id)) seriesIds.set(event.series.id, `series-${seriesIds.size + 1}`);
  }
  const rawInfo = (id: string) => {
    const item = rawById.get(id);
    if (!item) throw new Error('An evaluated research event is missing from the bound calculation.');
    return item;
  };
  if (rawById.size !== raw.events.length) throw new Error('The bound calculation contains duplicate research event IDs.');
  const seen = new Set<string>();
  const mark = (id: string) => {
    rawInfo(id);
    if (seen.has(id)) throw new Error('The evaluated research session contains duplicate research event IDs.');
    seen.add(id);
  };
  for (const item of evaluated.all) {
    mark(item.event.id);
    for (const id of evaluated.calculatedAxisCompanionIds.get(item.event.id) ?? []) mark(id);
  }
  const { counts } = evaluated;
  if (counts.total !== evaluated.all.length || counts.calculatedEvents !== raw.events.length) {
    throw new Error('The bound research session calculated or presented event counts do not reconcile.');
  }
  if (counts.axisDuplicatesMerged !== seen.size - evaluated.all.length) {
    throw new Error(`The bound research session accounts for ${seen.size - evaluated.all.length} of ${counts.axisDuplicatesMerged} merged axis windows.`);
  }
  if (raw.events.some(event => seen.has(event.id) !== query.computation.transitingBodies.includes(bodyOf(event))) ||
      seen.size + counts.outsideQueryScope !== raw.events.length) {
    throw new Error('The bound research session transiting-body event counts do not reconcile.');
  }

  const bodies = session.focus.effectiveTransitingBodies;
  if (bodies.some(body => !raw.settings.bodies.includes(body))) {
    throw new Error('The bound calculation does not cover every requested transiting body.');
  }
  const { scoped, relevant } = researchFindingScopes(session);
  const retainBroaderContext = mode !== 'focused' && query.contextPolicy.retainBroaderContext;
  const baseline = retainBroaderContext ? scoped : relevant;
  const selected = selectedIds === undefined ? baseline : baseline.filter(item => selectedIds.has(item.event.id));
  if (selectedIds !== undefined && selected.length !== selectedIds.size) {
    throw new Error('A selected event is outside the authorized research scope.');
  }
  const ordered = selected.map(item => ({
    item, orderAt: orderMoment(item.event, raw.range.effectiveStart), source: rawInfo(item.event.id),
  })).sort((a, b) => (a.orderAt.jdTt ?? Infinity) - (b.orderAt.jdTt ?? Infinity) || a.source.index - b.source.index);

  const events = ordered.map(({ item, orderAt, source }): ResearchExportEventV1 => ({
    id: source.alias, orderAt: moment(orderAt),
    facts: projectEvent(item.event, source.alias, moment, seriesIds, raw.stationResidualsDegPerDay[item.event.id] ?? null),
    axisCompanions: (evaluated.calculatedAxisCompanionIds.get(item.event.id) ?? []).map(eventId => {
      const companion = rawInfo(eventId);
      const projected = projectEvent(companion.event, companion.alias, moment, seriesIds, null);
      if (projected.kind !== 'angle-aspect-window') throw new Error('Research axis companion is not an angle window.');
      return projected;
    }),
    relevance: projectRelevance(item.relevance, aliases),
  }));
  return {
    events,
    eventAliases: new Map(ordered.map(({ item, source }) => [item.event.id, source.alias])),
    scope: {
      transitingBodies: bodies.map(planet),
      moon: {
        requested: query.computation.transitingBodies.includes('moon'), included: bodies.includes('moon'),
        calculated: raw.settings.bodies.includes('moon'),
      },
      includesBroaderContext: retainBroaderContext,
      counts: {
        calculated: counts.calculatedEvents, presented: counts.total, axisDuplicatesMerged: counts.axisDuplicatesMerged,
        outsideCalculatedBodyScope: counts.outsideQueryScope,
        outsideExportComputationScope: evaluated.all.length - scoped.length,
        omittedBroaderContext: scoped.length - baseline.length,
        exported: countExportEvents(events),
      },
      completeForSelectedScope: true as const,
    },
  };
}
