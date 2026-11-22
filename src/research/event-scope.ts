import type { RangeEvent } from '../search/range';
import type { ResearchSession } from './session';

export function isInResearchComputation(event: RangeEvent, session: ResearchSession): boolean {
  const body = 'transit' in event ? event.transit.planetId : event.planet.planetId;
  const { includeAngles, includeHouseIngresses, includeStations } = session.query.computation;
  return session.focus.effectiveTransitingBodies.includes(body) &&
    (event.kind !== 'station' || includeStations) &&
    (event.kind !== 'house-ingress' || includeHouseIngresses) &&
    (event.kind !== 'angle-aspect-window' || includeAngles);
}

export function researchFindingScopes(session: ResearchSession) {
  const scoped = session.evaluated.all.filter(item => isInResearchComputation(item.event, session));
  const relevant = scoped.filter(item => item.relevance.tier !== 'context');
  const complete = session.query.contextPolicy.retainBroaderContext ? scoped : relevant;
  return { scoped, relevant, complete };
}
