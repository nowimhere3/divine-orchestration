import type { AspectFact } from '../domain/aspects';
import type { HouseFacts, PlanetFact, PlanetPosition, PlanetRef } from '../domain/chart';
import { pointKey } from './astro-wheel';
import { natalHouse, planetName, signPosition, titleCase, wrapDegrees } from './chart-data';

export const degrees = (amount: number) => `${amount.toFixed(3)}°`;
export const houseName = (name: string) => name === 'WholeSign' ? 'Whole Sign' : name;
export const anglePositions = (houses: HouseFacts) => [
  ['Ascendant', houses.ascendantDeg], ['Midheaven', houses.midheavenDeg],
  ['Descendant', wrapDegrees(houses.ascendantDeg + 180)], ['Imum Coeli', wrapDegrees(houses.midheavenDeg + 180)],
] as const;

export function node<K extends keyof HTMLElementTagNameMap>(tag: K, value?: string) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  return element;
}

type Cell = string | HTMLElement;

function table(caption: string, columns: readonly string[], rows: Cell[][]) {
  const result = node('table');
  result.createCaption().textContent = caption;
  const heading = result.createTHead().insertRow();
  for (const column of columns) {
    const header = node('th', column);
    header.scope = 'col';
    heading.append(header);
  }
  const body = result.createTBody();
  for (const [label, ...values] of rows) {
    const row = body.insertRow();
    const header = node('th');
    header.scope = 'row';
    header.append(label);
    row.append(header);
    for (const value of values) row.insertCell().append(value);
  }
  return result;
}

function inspectButton(label: string, key: string, layer: string) {
  const button = node('button', label);
  button.type = 'button';
  button.className = 'cell-button';
  button.dataset.inspectKey = key;
  button.setAttribute('aria-label', `Inspect ${layer} ${label}`);
  button.setAttribute('aria-controls', 'inspection');
  button.setAttribute('aria-pressed', 'false');
  return button;
}

export function planetTable(facts: readonly PlanetFact[], layer: 'natal' | 'transit', houses: HouseFacts | null) {
  const label = titleCase(layer);
  return table(`${label} planetary positions`, ['Planet', 'Sign position', 'Longitude', 'Natal house', 'Speed', 'Motion'],
    facts.map(({ planetId, position }) => {
      const name = planetName(planetId);
      if (position.status === 'unavailable') return [name, unavailableText(position.reason), '—', '—', '—', '—'];
      const p = position.value;
      return [
        inspectButton(name, pointKey({ chartId: layer, planetId }), label),
        signPosition(p.longitudeDeg), degrees(p.longitudeDeg), String(natalHouse(p.longitudeDeg, houses) ?? '—'),
        `${degrees(p.longitudeSpeedDegPerDay)}/day`, p.retrograde ? 'Retrograde' : 'Direct',
      ];
    }),
  );
}

export const refLabel = (ref: PlanetRef) => `${ref.chartId === 'natal' ? 'Natal' : 'Transit'} ${planetName(ref.planetId)}`;
export const aspectLabel = (fact: AspectFact) => `${refLabel(fact.from)} · ${titleCase(fact.aspect)} · ${refLabel(fact.to)}`;

export function aspectTable(facts: readonly AspectFact[], caption: string) {
  return table(caption, ['Aspect', 'Separation', 'Exact angle', 'Orb'], facts.map(fact => [
    inspectButton(aspectLabel(fact), fact.id, 'aspect'),
    degrees(fact.separationDeg), degrees(fact.exactAngleDeg), degrees(fact.orbDeg),
  ]));
}

export function houseTables(houses: HouseFacts) {
  return [
    table(`${houseName(houses.effectiveSystem)} houses`, ['House', 'Cusp', 'Longitude'], houses.cusps.map(cusp =>
      [String(cusp.houseId), signPosition(cusp.longitudeDeg), degrees(cusp.longitudeDeg)])),
    table('Natal angles', ['Angle', 'Sign position', 'Longitude'], anglePositions(houses).map(([label, value]) =>
      [label, signPosition(value), degrees(value)])),
  ];
}

export function planetInspection(p: PlanetPosition, houses: HouseFacts | null) {
  return [
    ['Sign', signPosition(p.longitudeDeg)], ['Longitude', degrees(p.longitudeDeg)],
    ['Natal house', String(natalHouse(p.longitudeDeg, houses) ?? 'Unavailable')],
    ['Speed', `${degrees(p.longitudeSpeedDegPerDay)}/day`],
    ['Motion', p.retrograde ? 'Retrograde' : 'Direct'], ['Latitude', degrees(p.latitudeDeg)],
  ];
}

export function unavailableText(code: string) {
  switch (code) {
    case 'unknown-birth-time': return 'Unknown birth time. Natal planets, houses and angles are unavailable.';
    case 'missing-location': return 'Enter latitude and longitude to calculate houses and angles.';
    case 'outside-coverage': return 'This date is outside the available ephemeris.';
    case 'calculation-unavailable': return 'Calculation unavailable.';
    default: return 'Unavailable.';
  }
}
