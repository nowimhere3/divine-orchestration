import type { AspectFact } from '../domain/aspects';
import type { HouseFacts, PlanetId, PlanetPosition } from '../domain/chart';
import { planetName, signPosition, titleCase } from './chart-data';
import { aspectLabel, degrees, node, planetInspection, refLabel } from './readings';
import { pointKey } from './astro-wheel';

// Text presentation (U+FE0E) keeps these from rendering as color emoji.
export const planetGlyphs: Record<PlanetId, string> = {
  sun: '☉', moon: '☽', mercury: '☿', venus: '♀', mars: '♂',
  jupiter: '♃', saturn: '♄', uranus: '♅', neptune: '♆', pluto: '♇',
};
const signGlyphs = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
const elements = ['fire', 'earth', 'air', 'water'] as const;
/** Text presentation again, so the symbols stay monochrome. */
export const aspectSymbols = { conjunction: '☌', sextile: '⚹', square: '□', trine: '△', opposition: '☍' } as const;
export const tone = { conjunction: 'blend', sextile: 'support', trine: 'support', square: 'tense', opposition: 'tense' } as const;
export const toneText = { blend: 'Blending', support: 'Supportive', tense: 'Tense' } as const;

export interface InspectorModel {
  key: string;
  aspect: AspectFact | undefined;
  position: PlanetPosition | undefined;
  houses: HouseFacts | null;
  /** Aspects formed by the selected planet, in any order. */
  related: readonly AspectFact[];
}

export const glyph = (id: PlanetId, layer: string) => {
  const mark = node('span', `${planetGlyphs[id]}︎`);
  mark.className = `glyph glyph-${layer}`;
  mark.setAttribute('aria-hidden', 'true');
  return mark;
};

function chip(text: string, className: string) {
  const element = node('span', text);
  element.className = `chip ${className}`;
  return element;
}

/** A button that selects another planet or aspect; handled by delegation in the observatory. */
function jump(content: (HTMLElement | string)[], key: string, label: string, className: string) {
  const button = node('button');
  button.type = 'button';
  button.className = className;
  button.dataset.selectKey = key;
  button.setAttribute('aria-label', label);
  button.append(...content);
  return button;
}

function details(rows: readonly (readonly string[])[]) {
  const list = node('dl');
  for (const [label, value] of rows) list.append(node('dt', label), node('dd', value));
  return list;
}

function planetView(model: InspectorModel, layer: string, id: PlanetId, position: PlanetPosition) {
  const sign = Math.floor(position.longitudeDeg / 30) % 12;
  const header = node('div');
  header.className = 'inspect-head';
  const title = node('div');
  const name = node('p', `${titleCase(layer as 'natal')} ${planetName(id)}`);
  name.className = 'inspect-title';
  name.tabIndex = -1;
  const place = node('p');
  place.className = 'inspect-place';
  const signMark = node('span', `${signGlyphs[sign]}︎`);
  signMark.className = `sign-mark element-${elements[sign % 4]}`;
  signMark.setAttribute('aria-hidden', 'true');
  place.append(signMark, signPosition(position.longitudeDeg));
  title.append(name, place);
  const motion = chip(position.retrograde ? '℞ Retrograde' : 'Direct', position.retrograde ? 'chip-retro' : 'chip-direct');
  header.append(glyph(id, layer), title);
  const rows = planetInspection(position, model.houses).filter(([label]) => label !== 'Sign' && label !== 'Motion');

  const related = [...model.related].sort((a, b) => a.orbDeg - b.orbDeg);
  const section = node('section');
  section.className = 'relations';
  section.setAttribute('aria-label', 'Aspects');
  section.append(node('h3', `Aspects (${related.length})`));
  if (!related.length) section.append(Object.assign(node('p', 'No major aspects within orb.'), { className: 'quiet-note' }));
  const list = node('ul');
  for (const fact of related) {
    const other = pointKey(fact.from) === model.key ? fact.to : fact.from;
    const kind = tone[fact.aspect];
    const bar = node('span');
    bar.className = 'orb-bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.style.setProperty('--fit', String(Math.max(0, 1 - fact.orbDeg / fact.allowedOrbDeg)));
    const dot = node('span');
    dot.className = `aspect-dot aspect-${fact.aspect}`;
    dot.setAttribute('aria-hidden', 'true');
    const text = node('span');
    text.className = 'relation-text';
    text.append(node('strong', titleCase(fact.aspect)), ` to ${refLabel(other)}`);
    const orb = node('small', `${degrees(fact.orbDeg)} orb · ${toneText[kind]}`);
    text.append(' ', orb, bar);
    const item = node('li');
    // The accessible name repeats the visible words, so voice control and screen readers agree.
    const name = `${titleCase(fact.aspect)} to ${refLabel(other)} ${degrees(fact.orbDeg)} orb · ${toneText[kind]}`;
    item.append(jump([dot, text], fact.id, name, `relation tone-${kind}`));
    list.append(item);
  }
  section.append(list);
  return [header, motion, details(rows), section];
}

function aspectView(fact: AspectFact) {
  const kind = tone[fact.aspect];
  const pair = node('div');
  pair.className = 'inspect-pair';
  const end = (ref: AspectFact['from']) => jump([glyph(ref.planetId, ref.chartId), node('span', refLabel(ref))],
    pointKey(ref), `Show ${refLabel(ref)}`, `pair-end layer-${ref.chartId}`);
  const link = node('span');
  link.className = `pair-link tone-${kind}`;
  link.append(node('span', titleCase(fact.aspect)), Object.assign(node('small', toneText[kind]), {}));
  pair.append(end(fact.from), link, end(fact.to));
  const title = node('p', aspectLabel(fact));
  title.className = 'inspect-title';
  title.tabIndex = -1;
  const fit = node('div');
  fit.className = `orb-meter tone-${kind}`;
  fit.setAttribute('aria-hidden', 'true');
  fit.style.setProperty('--fit', String(Math.max(0, 1 - fact.orbDeg / fact.allowedOrbDeg)));
  return [pair, title, fit, details([
    ['Separation', degrees(fact.separationDeg)], ['Exact angle', degrees(fact.exactAngleDeg)],
    ['Orb', degrees(fact.orbDeg)], ['Allowed orb', degrees(fact.allowedOrbDeg)],
  ])];
}

export function renderInspection(container: HTMLElement, model: InspectorModel) {
  const [layer, id] = model.key.split('/') as [string, PlanetId];
  if (model.aspect) container.replaceChildren(...aspectView(model.aspect));
  else if (model.position && (layer === 'natal' || layer === 'transit')) {
    container.replaceChildren(...planetView(model, layer, id, model.position));
  } else {
    container.replaceChildren(node('p', 'Select a planet or aspect to see its geometry.'));
  }
}
