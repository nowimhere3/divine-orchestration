import type { EventMoment } from '../domain/event';
import type { ImpactMissingData, PersonalImpactScore } from '../research';
import { planetName, titleCase } from './chart-data';
import { node } from './readings';

const CONNECTIONS: Record<PersonalImpactScore['components']['natalConnection']['reason'], string> = {
  'natal-planet': 'Contact with a natal planet',
  'natal-luminary': 'Contact with the natal Sun or Moon',
  'traditional-chart-ruler': 'Contact with the traditional chart ruler',
  'traditional-angular-house-ruler': 'Contact with the traditional ruler of an angular house',
  'natal-angular-house-placement': 'Natal planet placed in an angular house',
  'natal-axis': 'Contact with a natal angle',
  'angular-cusp-crossing': 'Crossing an angular house cusp',
  'other-cusp-crossing': 'Crossing a nonangular house cusp',
  'station-in-angular-house': 'Station in an angular natal house',
  'station-in-other-house': 'Station in a nonangular natal house',
  'station-house-unavailable': 'The station’s natal house is unavailable',
};

const PRECISION: Record<PersonalImpactScore['components']['precision']['reason'], string> = {
  exact: 'Observed exact contact',
  refined: 'Observed exact contact refined by the solver',
  'near-miss': 'Closest measured approach relative to the allowed orb',
  unobserved: 'Closest approach unavailable in this search',
  'resolved-point': 'Resolved station or cusp-crossing time',
  'unresolved-point': 'Point time unavailable',
};

const MISSING: Record<ImpactMissingData, string> = {
  'natal-planet-factor-unavailable': 'Some natal planet factors are unavailable.',
  'natal-house-placement-unavailable': 'Natal house placement could not be established.',
  'traditional-angular-rulership-unavailable': 'Traditional angular house rulership is unavailable.',
  'traditional-chart-ruler-unavailable': 'The traditional chart ruler is unavailable.',
  'station-natal-house-unavailable': 'No natal house could be assigned to this station.',
  'closest-approach-unobserved': 'The closest approach was not observed.',
  'closest-approach-may-be-clipped': 'The search boundary may cut off a closer approach.',
  'point-time-unavailable': 'The station or crossing time is unavailable.',
};

export const impactDays = (days: number) => days < 0.01 ? '<0.01' : Number(days.toFixed(2)).toLocaleString('en');

export function impactContactLabel(score: PersonalImpactScore): string {
  const body = planetName(score.transitingBody);
  if (!('windows' in score.evidence)) {
    const facts = score.evidence.facts;
    return facts.kind === 'station' ? `${body} stations ${facts.turns}` : `${body} crosses House ${facts.cuspHouseId}`;
  }
  const descriptions = score.evidence.windows.map(({ facts }) => {
    const target = facts.kind === 'aspect-window' ? planetName(facts.target.planetId) : facts.targetAngle.toUpperCase();
    return `${titleCase(facts.aspect)} natal ${target}`;
  });
  return `${body} · ${descriptions.join(' / ')}`;
}

export function impactExplanation(score: PersonalImpactScore, momentText: (moment: EventMoment | null) => string) {
  const details = node('details');
  details.className = 'event-more event-impact-detail';
  details.append(node('summary', 'Why this score?'));
  const contributions = node('dl');
  const row = (term: string, description: string) => contributions.append(node('dt', term), node('dd', description));
  const { natalConnection, planetaryCycle, precision, contactType } = score.components;
  const number = (points: number) => Number(points.toFixed(3));
  const points = (value: { points: number; possiblePoints: number; missing: readonly ImpactMissingData[] }, maximum: number) =>
    `${number(value.points)}/${maximum} ${value.missing.length ? 'supported points' : 'points'}`;
  row('Natal connection', `${points(natalConnection, 40)} · ${CONNECTIONS[natalConnection.reason]}`);
  row('Planetary cycle', `${points(planetaryCycle, 25)} · Transiting ${planetName(planetaryCycle.reason)}`);
  row('Contact precision', `${points(precision, 20)} · ${PRECISION[precision.reason]}`);
  const descriptor = contactType.reason === 'house-ingress' ? 'House crossing' : titleCase(contactType.reason);
  row('Contact type', `${points(contactType, 15)} · ${descriptor}`);
  row('Personal Impact', `${score.total}/100 after rounding once · ${score.modelVersion}`);
  if (score.missingData.length) {
    row('Limited evidence', `${score.total} supported; possible upper bound ${score.possibleUpperBound}. ${score.missingData.map(key => MISSING[key]).join(' ')}`);
  }
  const natal = score.natalPlanetEvidence;
  if (natal?.houseId) row('Natal placement', `${planetName(natal.planetId)} in House ${natal.houseId}`);
  if (natal?.traditionalAngularHousesRuled?.length) row('Traditional rulership', `Houses ${natal.traditionalAngularHousesRuled.join(', ')}`);
  details.append(contributions);
  if ('windows' in score.evidence) {
    const best = score.evidence.bestPass;
    const winningWindow = score.evidence.windows.find(window => window.facts.id === best?.eventId);
    const closest = best && winningWindow?.facts.passes[best.passIndex];
    if (closest && winningWindow) {
      const residual = closest.residualDeg === null ? '' : ` · ${Number(closest.residualDeg.toPrecision(4))}° from exact`;
      const end = winningWindow.facts.kind === 'angle-aspect-window' ? ` · ${winningWindow.facts.targetAngle.toUpperCase()}` : '';
      row('Precision evidence', `${momentText(closest.at)}${end}${residual} · ${winningWindow.facts.allowedOrbDeg}° allowed orb`);
    }
    for (const window of score.evidence.windows) {
      const { facts } = window;
      const end = facts.kind === 'angle-aspect-window' ? ` · ${facts.targetAngle.toUpperCase()}` : '';
      const duration = window.observedDays === null ? 'Observed duration unavailable' :
        `${window.durationIsMinimum ? 'At least ' : ''}${impactDays(window.observedDays)} days in orb`;
      row(`Window evidence${end}`, `${duration} · ${window.exactPassCountInWindow} exact in this window · ${facts.series.exactPassCountInRange} exact in the series within this search · ${facts.series.complete ? 'Series complete' : 'Series open at search horizon'}`);
    }
    details.append(node('p', 'Duration and repeat passes are evidence. They add zero points.'));
  } else {
    row('Resolved event time', momentText(score.evidence.facts.at));
    if (score.evidence.stationResidualDegPerDay !== null) {
      row('Station precision evidence', `${Number(score.evidence.stationResidualDegPerDay.toPrecision(4))}°/day residual speed`);
    }
  }
  const convention = node('p', 'This score expresses astrological significance under the current model. It gives no probability of a life outcome.');
  convention.className = 'hint';
  details.append(convention);
  return details;
}
