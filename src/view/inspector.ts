import type { AspectFact } from '../domain/aspects';
import type { HouseFacts, PlanetId, PlanetPosition } from '../domain/chart';
import { inspectorPersonalNatal, inspectorPersonalTransit } from '../interpret';
import type { InspectorPersonalNote, NatalReading, TransitReading } from '../interpret';
import { aspectEntry, bodyEntry, conceptEntry, entryById, entryForRef, houseEntry, parseElementKey, signEntry, sourcesFor } from '../knowledge';
import type { ElementRef, Entry } from '../knowledge';
import { formatLunarTimestamp } from '../lunar';
import type { DateOnlyMoonSummary, LunarCycleInfo, MoonSkyState, MoonState } from '../lunar';
import { natalHouse, planetName, signPosition, titleCase, wrapDegrees } from './chart-data';
import type { PositionMap } from './chart-data';
import { aspectLabel, degrees, houseName, node, planetInspection, refLabel, unavailableText } from './readings';
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
const aspectAngles = { conjunction: 0, sextile: 60, square: 90, trine: 120, opposition: 180 } as const;
const aspectOrder = ['conjunction', 'sextile', 'square', 'trine', 'opposition'] as const;

export interface InspectorLunarLayer {
  readonly state: MoonState | null;
  readonly cycle: LunarCycleInfo | null;
  readonly sky: MoonSkyState | null;
  readonly observerLabel: string;
  readonly missingObserverReason: string | null;
  readonly timeZone: string;
  readonly dateOnlySummary?: DateOnlyMoonSummary | null;
}

export interface InspectorLunarModel {
  readonly natal: InspectorLunarLayer;
  readonly transit: InspectorLunarLayer;
}

export interface InspectorModel {
  key: string;
  aspect: AspectFact | undefined;
  position: PlanetPosition | undefined;
  houses: HouseFacts | null;
  /** Aspects formed by the selected planet, in any order. */
  related: readonly AspectFact[];
  natal: PositionMap;
  transit: PositionMap;
  /** Every natal and transit aspect currently found. */
  aspects: readonly AspectFact[];
  /** Why houses are unavailable (a reason code), or an empty string when they are available. */
  houseReason: string;
  requestedSystem: string | null;
  /** The allowed orb for each aspect type, from the rule set in use. */
  orbs: Readonly<Record<string, number>>;
  /** The Time Machine moment and the birth details, in words. */
  moment: string;
  birth: string;
  demo: boolean;
  /** Set when a glossary concept was opened from another selection. */
  back?: { key: string; label: string };
  lunar?: InspectorLunarModel;
  /** Personalized natal interpretation for concise "In this chart" context. */
  natalReading?: NatalReading;
  /** Personalized transit interpretation for concise "In these transits" context. */
  transitReading?: TransitReading;
}

export const glyph = (id: PlanetId, layer: string) => {
  const mark = node('span', `${planetGlyphs[id]}︎`);
  mark.className = `glyph glyph-${layer}`;
  mark.setAttribute('aria-hidden', 'true');
  return mark;
};

/** A round mark for a sign, house, angle or aspect type, in the same style as a planet glyph. */
function symbolMark(text: string, extra = '') {
  const mark = node('span', text);
  mark.className = `glyph ${extra}`.trim();
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function chip(text: string, className: string) {
  const element = node('span', text);
  element.className = `chip ${className}`;
  return element;
}

/** A button that selects another chart element or concept; handled by delegation in the observatory. */
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

export function bulletList(items: readonly string[]) {
  const list = node('ul');
  list.className = 'meaning-list';
  for (const item of items) list.append(node('li', item));
  return list;
}

export function quiet(text: string) {
  return Object.assign(node('p', text), { className: 'quiet-note' });
}

function heading(tag: 'h3' | 'h4', text: string, id?: string) {
  const element = node(tag, text);
  if (id) element.id = id;
  return element;
}

function header(mark: HTMLElement, title: string, place: (Node | string)[]) {
  const head = node('div');
  head.className = 'inspect-head';
  const text = node('div');
  const name = node('p', title);
  name.className = 'inspect-title';
  name.tabIndex = -1;
  const where = node('p');
  where.className = 'inspect-place';
  where.append(...place);
  text.append(name, where);
  head.append(mark, text);
  return head;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Two buttons that move between the explanation and the chart's own numbers. */
function sectionNav() {
  const nav = node('nav');
  nav.className = 'inspect-jump';
  nav.setAttribute('aria-label', 'Inspector sections');
  for (const [id, label] of [['inspect-meaning', 'Meaning'], ['inspect-facts', 'Calculated facts']] as const) {
    const button = node('button', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      const section = document.getElementById(id);
      section?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      section?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
    });
    nav.append(button);
  }
  return nav;
}

export function sourcesBlock(entry: Entry) {
  const block = node('details');
  block.className = 'sources';
  block.dataset.detail = 'sources';
  block.append(node('summary', 'Sources and attribution'));
  block.append(quiet('The wording is original to this app. It was written from these references; no commercial interpretation text was copied.'));
  const list = node('ul');
  for (const source of sourcesFor(entry.sources)) {
    const item = node('li');
    const title = source.url ? Object.assign(node('a', source.title), { href: source.url, target: '_blank', rel: 'noopener noreferrer' }) : node('span', source.title);
    item.append(title);
    if (source.url) item.append(Object.assign(node('span', ' (opens in a new tab)'), { className: 'sr-only' }));
    item.append(` · ${source.author}. ${source.used}`);
    list.append(item);
  }
  block.append(list);
  return block;
}

/**
 * The explanation half of every view. Astronomy and tradition stay in separate, labelled groups, so
 * symbolism is never mistaken for a measurement or a prediction.
 */
function meaning(entry: Entry, lead: HTMLElement[] = []) {
  const section = node('section');
  section.id = 'inspect-meaning';
  section.className = 'meaning';
  section.setAttribute('aria-labelledby', 'inspect-meaning-heading');
  const title = heading('h3', 'Meaning', 'inspect-meaning-heading');
  title.tabIndex = -1;
  const open = Object.assign(node('a', 'Open in Learn'), { href: `#learn/${entry.id}`, className: 'learn-open' });
  open.setAttribute('aria-label', `Open ${entry.longName ?? entry.name} in Learn`);
  section.append(title, Object.assign(node('p', entry.tagline), { className: 'tagline' }), open, ...lead,
    node('p', entry.summary), heading('h4', 'Astronomical background'), bulletList(entry.facts),
    heading('h4', 'Traditional symbolism'), Object.assign(node('p', 'Tradition, not measurement: long-standing associations, not predictions or facts about you.'), { className: 'quiet-note' }),
    bulletList(entry.symbolism), heading('h4', 'How to think about it'), node('p', entry.reading));
  if (entry.reflection) {
    const prompt = node('details');
    prompt.className = 'reflection';
    prompt.dataset.detail = 'reflection';
    prompt.append(node('summary', 'A question to reflect on'), node('p', entry.reflection));
    section.append(prompt);
  }
  const more = (entry.see ?? []).map(id => entryById(id)).filter((see): see is Entry => !!see);
  if (more.length) {
    const learn = node('div');
    learn.className = 'learn-more';
    learn.append(node('span', 'Learn more'));
    for (const see of more) learn.append(jump([see.name], see.id, `Learn about ${see.name}`, 'concept-link'));
    section.append(learn);
  }
  section.append(sourcesBlock(entry));
  return section;
}

/** The chart-specific half: only values the calculation produced, plus where they come from. */
function facts(context: string, content: HTMLElement[]) {
  const section = node('section');
  section.id = 'inspect-facts';
  section.className = 'facts';
  section.setAttribute('aria-labelledby', 'inspect-facts-heading');
  const title = heading('h3', 'Calculated facts', 'inspect-facts-heading');
  title.tabIndex = -1;
  section.append(title, Object.assign(node('p', context), { className: 'context-note' }), ...content);
  return section;
}

function relationButton(fact: AspectFact, label: string, key: string) {
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
  text.append(node('strong', titleCase(fact.aspect)), ` ${label}`);
  text.append(' ', node('small', `${degrees(fact.orbDeg)} orb · ${toneText[kind]}`), bar);
  // The accessible name repeats the visible words, so voice control and screen readers agree.
  return jump([dot, text], key, `${titleCase(fact.aspect)} ${label} ${degrees(fact.orbDeg)} orb · ${toneText[kind]}`, `relation tone-${kind}`);
}

function relationList(label: string, listed: readonly AspectFact[], other: (fact: AspectFact) => string, empty: string) {
  const section = node('section');
  section.className = 'relations';
  section.setAttribute('aria-label', label);
  section.append(node('h4', `${label} (${listed.length})`));
  if (!listed.length) section.append(quiet(empty));
  const list = node('ul');
  for (const fact of [...listed].sort((a, b) => a.orbDeg - b.orbDeg)) {
    const item = node('li');
    item.append(relationButton(fact, other(fact), fact.id));
    list.append(item);
  }
  section.append(list);
  return section;
}

/** The planets of one layer that lie in a region, as buttons that open each planet. */
function planetsHere(layer: 'natal' | 'transit', keys: readonly string[], positions: PositionMap) {
  const list = node('ul');
  list.className = 'member-list';
  for (const key of keys.filter(candidate => candidate.startsWith(`${layer}/`))) {
    const id = key.split('/')[1] as PlanetId;
    const position = positions.get(id);
    if (!position) continue;
    const item = node('li');
    const text = node('span');
    text.className = 'relation-text';
    text.append(node('strong', `${titleCase(layer)} ${planetName(id)}`), ' ', node('small', signPosition(position.longitudeDeg)));
    item.append(jump([glyph(id, layer), text], key, `${titleCase(layer)} ${planetName(id)} ${signPosition(position.longitudeDeg)}`, `relation layer-${layer}`));
    list.append(item);
  }
  return list;
}

function memberSection(title: string, layer: 'natal' | 'transit', keys: readonly string[], positions: PositionMap, empty: string) {
  const section = node('section');
  section.className = 'relations';
  section.setAttribute('aria-label', title);
  const list = planetsHere(layer, keys, positions);
  section.append(node('h4', `${title} (${list.childElementCount})`));
  section.append(list.childElementCount ? list : quiet(empty));
  return section;
}

/** The keys of every planet inside a sign or house. Used by the Inspector and to mark them on the wheel. */
export function regionMembers(key: string, natal: PositionMap, transit: PositionMap, houses: HouseFacts | null) {
  const ref = parseElementKey(key);
  if (!ref || (ref.type !== 'sign' && ref.type !== 'house')) return [];
  const inside = (longitude: number) => ref.type === 'sign'
    ? Math.floor(wrapDegrees(longitude) / 30) % 12 === ref.index
    : natalHouse(longitude, houses) === ref.number;
  return (['natal', 'transit'] as const).flatMap(layer => [...(layer === 'natal' ? natal : transit)]
    .filter(([, position]) => inside(position.longitudeDeg)).map(([id]) => `${layer}/${id}`));
}

const houseSystemLine = (model: InspectorModel, houses: HouseFacts) => {
  const asked = model.requestedSystem ? houseName(model.requestedSystem) : null;
  const used = houseName(houses.effectiveSystem);
  return asked && asked !== used ? `${used} (requested ${asked}; a fallback was used)` : used;
};

const natalContext = (model: InspectorModel) => `Natal chart, fixed at the birth moment: ${model.birth}.`;
const momentContext = (model: InspectorModel) => `Transits at the Time Machine moment: ${model.moment}.`;

function signedDegrees(deg: number, digits = 2) {
  return `${deg >= 0 ? '+' : '−'}${Math.abs(deg).toFixed(digits)}°`;
}

function renderLunarInspectionBlock(layer: 'natal' | 'transit', info: InspectorLunarLayer | undefined): HTMLElement[] {
  if (!info || !info.state) return [];
  const s = info.state;
  const c = info.cycle;
  const sky = info.sky;
  const zone = info.timeZone || 'UTC';

  const section = node('section');
  section.className = 'inspect-lunar';
  section.setAttribute('aria-label', 'Lunar Observatory');
  section.append(node('h4', layer === 'natal' ? 'Lunar Observatory (birth Moon)' : 'Lunar Observatory (selected moment)'));

  const rows: string[][] = [
    ['Lunar phase', `${s.phaseLabel} (${s.waxingLabel})`],
    ['Illumination', `${s.illuminationPercent.toFixed(1)}% (phase angle ${s.phaseAngleDeg.toFixed(2)}°)`],
    ['Geocentric elongation', `${s.elongationDeg.toFixed(2)}°`],
    ['Geocentric tropical Moon', `${s.formattedPosition} (${degrees(s.moonLongitudeDeg)})`],
  ];

  if (c) {
    if (c.ageDays !== null && c.synodicLengthDays !== null) {
      rows.push(['Moon age & cycle', `${c.ageDays.toFixed(1)}d old · ${(c.cycleProgress * 100).toFixed(1)}% of ${c.synodicLengthDays.toFixed(2)}d cycle`]);
    } else if (c.ageDays !== null) {
      rows.push(['Moon age', `${c.ageDays.toFixed(1)}d since New Moon`]);
    }
    if (c.previous) {
      rows.push(['Previous phase', `${c.previous.label} · ${formatLunarTimestamp(c.previous.epochMs, zone)}`]);
    }
    if (c.next) {
      rows.push(['Next phase', `${c.next.label} · ${formatLunarTimestamp(c.next.epochMs, zone)}`]);
    }
  }

  if (sky) {
    rows.push(['Observer location', info.observerLabel]);
    rows.push([
      'Topocentric Moon (local)',
      `${sky.topocentricFormatted} (${degrees(sky.topocentricLongitudeDeg)} · parallax ${signedDegrees(sky.parallaxDeltaLonDeg, 2)})`,
    ]);
    rows.push(['Chart frame note', 'Chart wheel, aspects and exports use geocentric position']);
    rows.push([
      'Local altitude & azimuth',
      `${signedDegrees(sky.apparentAltitudeDeg, 1)} apparent (${signedDegrees(sky.geometricAltitudeDeg, 1)} geometric) · Az ${sky.azimuthDeg.toFixed(1)}°`,
    ]);
    rows.push(['Horizon visibility', `${sky.visibilityLabel} (standard atmosphere)`]);
    if (sky.localDateTransit) {
      const t = sky.localDateTransit;
      rows.push([
        'Upper meridian passage',
        `${formatLunarTimestamp(t.epochMs, zone)} · Culmination ${signedDegrees(t.culminationApparentAltitudeDeg, 1)}`,
      ]);
    } else if (sky.nextTransit || sky.nearestTransit) {
      const t = (sky.nextTransit ?? sky.nearestTransit)!;
      rows.push([
        'Upper meridian passage',
        `None on this local date · Next: ${formatLunarTimestamp(t.epochMs, zone)} (${signedDegrees(t.culminationApparentAltitudeDeg, 1)})`,
      ]);
    }
  }

  section.append(details(rows));

  if (sky?.signDiffers && sky.signDifferenceNote) {
    const signNote = Object.assign(node('p', sky.signDifferenceNote), { className: 'lunar-sign-diff' });
    section.append(signNote);
  } else if (!sky && info.missingObserverReason) {
    section.append(quiet(info.missingObserverReason));
  }

  return [section];
}

function personalBlock(note: InspectorPersonalNote | null, className = 'inspect-personal'): HTMLElement[] {
  if (!note) return [];
  const box = node('section');
  box.className = className;
  box.setAttribute('aria-label', note.heading);
  const top = node('div');
  top.className = 'inspect-personal-head';
  top.append(node('h4', note.heading), chip(note.factBadge, 'chip-quiet'));
  box.append(top);
  if (note.sensitivityNote) {
    box.append(Object.assign(node('p', note.sensitivityNote), { className: 'reading-caution' }));
  }
  box.append(
    Object.assign(node('p', note.synthesis), { className: 'inspect-personal-prose' }),
    Object.assign(node('p', `Traditional basis: ${note.symbolismNote}`), { className: 'quiet-note' }),
  );
  const clickable = note.citations.filter(c => c.selectKey);
  if (clickable.length) {
    const links = node('div');
    links.className = 'inspect-personal-links';
    for (const cite of clickable) {
      links.append(jump([cite.label], cite.selectKey!, `Inspect ${cite.label}`, 'concept-link'));
    }
    box.append(links);
  }
  return [box];
}

function planetView(model: InspectorModel, layer: 'natal' | 'transit', id: PlanetId, position: PlanetPosition) {
  const sign = Math.floor(position.longitudeDeg / 30) % 12;
  const signMark = node('span', `${signGlyphs[sign]}︎`);
  signMark.className = `sign-mark element-${elements[sign % 4]}`;
  signMark.setAttribute('aria-hidden', 'true');
  const head = header(glyph(id, layer), `${titleCase(layer)} ${planetName(id)}`, [signMark, signPosition(position.longitudeDeg)]);
  const motion = chip(position.retrograde ? '℞ Retrograde' : 'Direct', position.retrograde ? 'chip-retro' : 'chip-direct');
  const rows = planetInspection(position, model.houses).filter(([label]) => label !== 'Sign' && label !== 'Motion');
  const entry = bodyEntry(id);
  // Direct routes to the sign and house the planet is in: the same destinations as the wheel's own regions.
  const house = natalHouse(position.longitudeDeg, model.houses);
  const explore = node('div');
  explore.className = 'learn-more';
  explore.append(node('span', 'Explore'));
  explore.append(jump([`${signEntry(sign)?.name}`], `sign/${sign}`, `Open the sign ${signEntry(sign)?.name}`, 'concept-link'));
  if (house) explore.append(jump([`House ${house}`], `house/${house}`, `Open house ${house}`, 'concept-link'));
  if (id === 'moon') {
    explore.append(jump(['Moon phases'], 'concept/moon-phases', 'Learn about Moon phases', 'concept-link'));
    explore.append(jump(['Lunar parallax & local sky'], 'concept/lunar-parallax', 'Learn about Lunar parallax & local sky', 'concept-link'));
  }
  const lunarBlocks = id === 'moon'
    ? renderLunarInspectionBlock(layer, layer === 'natal' ? model.lunar?.natal : model.lunar?.transit)
    : [];
  const personal = layer === 'natal'
    ? personalBlock(inspectorPersonalNatal(model.natalReading, model.key), 'inspect-personal')
    : personalBlock(inspectorPersonalTransit(model.transitReading, model.key), 'inspect-transit-personal');
  const related = relationList('Aspects', model.related, fact => `to ${refLabel(pointKey(fact.from) === model.key ? fact.to : fact.from)}`, 'No major aspects within orb.');
  return [head, sectionNav(), ...(entry ? [meaning(entry, personal)] : []),
    facts(layer === 'natal' ? natalContext(model) : `${momentContext(model)} House numbers are the natal houses.`, [motion, details(rows), ...lunarBlocks, explore, related])];
}

function aspectView(model: InspectorModel, fact: AspectFact) {
  const kind = tone[fact.aspect];
  const pair = node('div');
  pair.className = 'inspect-pair';
  const end = (ref: AspectFact['from']) => jump([glyph(ref.planetId, ref.chartId), node('span', refLabel(ref))],
    pointKey(ref), `Show ${refLabel(ref)}`, `pair-end layer-${ref.chartId}`);
  const link = node('span');
  link.className = `pair-link tone-${kind}`;
  link.append(node('span', titleCase(fact.aspect)), node('small', toneText[kind]));
  pair.append(end(fact.from), link, end(fact.to));
  const title = node('p', aspectLabel(fact));
  title.className = 'inspect-title';
  title.tabIndex = -1;
  const fit = node('div');
  fit.className = `orb-meter tone-${kind}`;
  fit.setAttribute('aria-hidden', 'true');
  fit.style.setProperty('--fit', String(Math.max(0, 1 - fact.orbDeg / fact.allowedOrbDeg)));
  const entry = aspectEntry(fact.aspect);
  const themes = node('ul');
  themes.className = 'meaning-list pair-themes';
  for (const ref of [fact.from, fact.to]) {
    const body = bodyEntry(ref.planetId);
    if (body) themes.append(node('li', `${refLabel(ref)} · ${body.tagline}`));
  }
  const all = node('div');
  all.className = 'learn-more';
  const everyOne = `All ${aspectEntry(fact.aspect)?.name.toLowerCase()}s in this chart`;
  all.append(jump([everyOne], `aspect/${fact.aspect}`, everyOne, 'concept-link'));
  const crossing = fact.from.chartId !== fact.to.chartId;
  const personal = !crossing
    ? personalBlock(inspectorPersonalNatal(model.natalReading, fact.id), 'inspect-personal')
    : personalBlock(inspectorPersonalTransit(model.transitReading, fact.id), 'inspect-transit-personal');
  return [pair, title, fit, sectionNav(), ...(entry ? [meaning(entry, [...personal, themes])] : []),
    facts(crossing ? `${momentContext(model)} A transiting planet against a natal planet.` : `${natalContext(model)} Both planets are natal.`, [details([
      ['Separation', degrees(fact.separationDeg)], ['Exact angle', degrees(fact.exactAngleDeg)],
      ['Orb', degrees(fact.orbDeg)], ['Allowed orb', degrees(fact.allowedOrbDeg)],
    ]), all])];
}

function signView(model: InspectorModel, index: number) {
  const entry = signEntry(index)!;
  const mark = symbolMark(`${signGlyphs[index]}︎`, `sign-glyph element-${elements[index % 4]}`);
  const head = header(mark, entry.name, [entry.tagline]);
  const keys = regionMembers(`sign/${index}`, model.natal, model.transit, model.houses);
  const rows: string[][] = [['Zodiac longitude', `${index * 30}° to ${index * 30 + 30}°`]];
  const { houses } = model;
  if (houses) {
    if (Math.floor(houses.ascendantDeg / 30) % 12 === index) rows.push(['Ascendant', signPosition(houses.ascendantDeg)]);
    if (Math.floor(houses.midheavenDeg / 30) % 12 === index) rows.push(['Midheaven', signPosition(houses.midheavenDeg)]);
  }
  return [head, sectionNav(), meaning(entry), facts('The signs are fixed arcs of the zodiac, so only the planets in them change from chart to chart.', [
    details(rows),
    memberSection('Natal planets here', 'natal', keys, model.natal, model.natal.size ? 'No natal planets in this sign.' : 'Natal planets are unavailable for this chart.'),
    memberSection('Transit planets here', 'transit', keys, model.transit, 'No transiting planets in this sign at this moment.'),
  ])];
}

function houseView(model: InspectorModel, number: number) {
  const entry = houseEntry(number)!;
  const head = header(symbolMark(String(number)), entry.name, [entry.tagline]);
  const { houses } = model;
  if (!houses) {
    return [head, sectionNav(), meaning(entry), facts('Houses need a birth time and a birth place.', [
      quiet(unavailableText(model.houseReason)),
      quiet('The meaning above does not depend on your chart, so it is still available.'),
    ])];
  }
  const cusp = houses.cusps[number - 1];
  const next = houses.cusps[number % 12];
  const keys = regionMembers(`house/${number}`, model.natal, model.transit, houses);
  const rows = [['House system', houseSystemLine(model, houses)], ['Cusp', signPosition(cusp.longitudeDeg)],
    ['Cusp longitude', degrees(cusp.longitudeDeg)], ['Size', degrees(wrapDegrees(next.longitudeDeg - cusp.longitudeDeg))]];
  return [head, sectionNav(), meaning(entry), facts(`${natalContext(model)} House ${number} runs counter-clockwise from its cusp.`, [
    details(rows),
    memberSection('Natal planets here', 'natal', keys, model.natal, 'No natal planets in this house.'),
    memberSection('Transit planets here', 'transit', keys, model.transit, 'No transiting planets in this house at this moment.'),
  ])];
}

function angleView(model: InspectorModel, which: 'asc' | 'mc') {
  const entry = entryForRef({ type: 'angle', which })!;
  const head = header(symbolMark(entry.name, 'angle-glyph'), entry.longName ?? entry.name, [entry.tagline]);
  const { houses } = model;
  if (!houses) {
    return [head, sectionNav(), meaning(entry), facts('Angles need a birth time and a birth place.', [quiet(unavailableText(model.houseReason))])];
  }
  const longitude = which === 'asc' ? houses.ascendantDeg : houses.midheavenDeg;
  const opposite = wrapDegrees(longitude + 180);
  const rows = [[entry.longName ?? entry.name, signPosition(longitude)], ['Longitude', degrees(longitude)],
    [which === 'asc' ? 'Descendant' : 'Imum Coeli', signPosition(opposite)], ['In house', String(natalHouse(longitude, houses) ?? '—')],
    ['House system', houseSystemLine(model, houses)]];
  const personal = personalBlock(inspectorPersonalNatal(model.natalReading, `angle/${which}`));
  return [head, sectionNav(), meaning(entry, personal), facts(natalContext(model), [details(rows)])];
}

function aspectTypeView(model: InspectorModel, aspect: keyof typeof aspectAngles) {
  const entry = aspectEntry(aspect)!;
  const kind = tone[aspect];
  const head = header(symbolMark(aspectSymbols[aspect], `aspect-glyph tone-${kind}`), entry.name, [`${aspectAngles[aspect]}° · ${toneText[kind]}`]);
  const here = model.aspects.filter(fact => fact.aspect === aspect);
  const natal = here.filter(fact => fact.from.chartId === 'natal' && fact.to.chartId === 'natal');
  const transit = here.filter(fact => !natal.includes(fact));
  const names = (fact: AspectFact) => `${refLabel(fact.from)} to ${refLabel(fact.to)}`;
  return [head, sectionNav(), meaning(entry), facts('How this aspect is counted here, and where it occurs in this chart.', [
    details([['Exact angle', `${aspectAngles[aspect]}°`], ['Allowed orb', degrees(model.orbs[aspect] ?? 0)]]),
    relationList(`Natal ${entry.name.toLowerCase()}s`, natal, names, 'None within orb in the natal chart.'),
    relationList(`Transit ${entry.name.toLowerCase()}s`, transit, names, 'None within orb at this moment.'),
  ])];
}

function conceptFacts(model: InspectorModel, id: string) {
  const content: HTMLElement[] = [];
  const natalSun = model.natal.get('sun');
  switch (id) {
    case 'retrograde': {
      const retro = (layer: 'natal' | 'transit', positions: PositionMap) => [...positions]
        .filter(([, position]) => position.retrograde).map(([planet]) => `${titleCase(layer)} ${planetName(planet)}`);
      const names = [...retro('natal', model.natal), ...retro('transit', model.transit)];
      content.push(details([['Retrograde now', names.length ? names.join(', ') : 'None in the natal chart or at this moment']]));
      return facts(`${natalContext(model)} ${momentContext(model)}`, content);
    }
    case 'orb':
      content.push(details(aspectOrder.map(aspect => [titleCase(aspect), `up to ${degrees(model.orbs[aspect] ?? 0)}`])));
      return facts('The orbs this app allows by default.', content);
    case 'degrees':
      content.push(natalSun
        ? details([['Natal Sun', signPosition(natalSun.longitudeDeg)], ['As longitude', degrees(natalSun.longitudeDeg)]])
        : quiet('Natal positions are unavailable for this chart, so there is no example to show.'));
      return facts('An example from this chart.', content);
    case 'natal-chart':
      content.push(details([['Birth details', model.birth], ['Chart type', model.demo ? 'Demonstration chart, not yours' : 'Your calculated chart'],
        ['Houses and angles', model.houses ? 'Available' : 'Unavailable']]));
      if (!model.houses) content.push(quiet(unavailableText(model.houseReason)));
      return facts('What this chart was calculated from.', content);
    case 'transits': {
      const crossing = model.aspects.filter(fact => fact.from.chartId !== fact.to.chartId).length;
      content.push(details([['Time Machine moment', model.moment], ['Transit-to-natal aspects', String(crossing)]]));
      return facts('What the outer gold ring shows now.', content);
    }
    case 'moon-phases': {
      const tState = model.lunar?.transit.state;
      const tCycle = model.lunar?.transit.cycle;
      const nState = model.lunar?.natal.state;
      const rows: string[][] = [];
      if (tState) {
        rows.push(['Transit Moon phase', `${tState.phaseLabel} (${tState.waxingLabel})`]);
        rows.push(['Transit illumination', `${tState.illuminationPercent.toFixed(1)}% (${tState.elongationDeg.toFixed(1)}° elongation)`]);
        rows.push(['Transit Moon sign', `${tState.formattedPosition} (geocentric)`]);
      }
      if (tCycle?.next) {
        rows.push(['Next principal phase', `${tCycle.next.label} · ${formatLunarTimestamp(tCycle.next.epochMs, model.lunar?.transit.timeZone ?? 'UTC')}`]);
      }
      if (nState) {
        rows.push(['Natal Moon phase', `${nState.phaseLabel} · ${nState.illuminationPercent.toFixed(1)}% · ${nState.formattedPosition}`]);
      } else if (model.lunar?.natal.dateOnlySummary?.status === 'ok') {
        rows.push(['Natal date Moon', `${model.lunar.natal.dateOnlySummary.phaseSummary} · ${model.lunar.natal.dateOnlySummary.signSummary}`]);
      }
      content.push(rows.length ? details(rows) : quiet('Lunar phase figures are unavailable for this date.'));
      return facts(`${momentContext(model)} ${natalContext(model)}`, content);
    }
    case 'lunar-parallax': {
      const tSky = model.lunar?.transit.sky;
      const tState = model.lunar?.transit.state;
      const nSky = model.lunar?.natal.sky;
      const rows: string[][] = [];
      if (tState) {
        rows.push(['Transit geocentric Moon', `${tState.formattedPosition} (${degrees(tState.moonLongitudeDeg)})`]);
      }
      if (tSky) {
        rows.push(['Transit observer', model.lunar?.transit.observerLabel ?? 'Active observer']);
        rows.push(['Transit topocentric Moon', `${tSky.topocentricFormatted} (${degrees(tSky.topocentricLongitudeDeg)} · ${signedDegrees(tSky.parallaxDeltaLonDeg, 2)})`]);
        rows.push(['Transit altitude', `${signedDegrees(tSky.apparentAltitudeDeg, 1)} (${tSky.visibilityLabel})`]);
      }
      if (nSky) {
        rows.push(['Natal topocentric Moon', `${nSky.topocentricFormatted} (${signedDegrees(nSky.parallaxDeltaLonDeg, 2)} · ${nSky.visibilityLabel})`]);
      }
      content.push(rows.length ? details(rows) : quiet('Select an observer location in the Lunar Observatory to compare geocentric and topocentric positions.'));
      if (tSky?.signDiffers && tSky.signDifferenceNote) content.push(quiet(tSky.signDifferenceNote));
      return facts('Geocentric chart frame versus local topocentric observer coordinates.', content);
    }
    default:
      content.push(model.houses
        ? details([['Requested', model.requestedSystem ? houseName(model.requestedSystem) : '—'], ['In use', houseName(model.houses.effectiveSystem)],
          ['Fallback used', model.houses.fallback ? 'Yes' : 'No']])
        : quiet(unavailableText(model.houseReason)));
      return facts(natalContext(model), content);
  }
}

function conceptView(model: InspectorModel, id: string) {
  const entry = conceptEntry(id)!;
  return [header(symbolMark(entry.symbol ?? '✦', 'concept-glyph'), entry.name, [entry.tagline]), sectionNav(), meaning(entry), conceptFacts(model, id)];
}

/** The start state: a short guide to everything on the wheel, with full-size buttons for the small targets. */
function indexView(model: InspectorModel) {
  const intro = node('p', 'Select a planet or aspect, a sign, a house or an angle on the wheel to see what it means and how it is calculated here. Or choose from this guide.');
  intro.className = 'inspect-intro';
  intro.tabIndex = -1;
  const group = (title: string, buttons: HTMLElement[], note?: string) => {
    const section = node('section');
    section.className = 'guide-group';
    section.setAttribute('aria-label', title);
    section.append(node('h3', title));
    const list = node('div');
    list.className = 'guide-buttons';
    list.append(...buttons);
    section.append(list);
    if (note) section.append(quiet(note));
    return section;
  };
  const button = (label: string, key: string, name: string, mark?: string) => jump(
    mark ? [Object.assign(node('span', mark), { className: 'guide-mark' }), label] : [label], key, name, 'guide-button');
  const signs = Array.from({ length: 12 }, (_, index) => button(signEntry(index)!.name, `sign/${index}`, `Zodiac sign ${signEntry(index)!.name}`, `${signGlyphs[index]}︎`));
  const houses = Array.from({ length: 12 }, (_, index) => button(String(index + 1), `house/${index + 1}`, `House ${index + 1}, ${houseEntry(index + 1)!.tagline}`));
  const angles = [button('Ascendant', 'angle/asc', 'Ascendant (ASC)'), button('Midheaven', 'angle/mc', 'Midheaven (MC)')];
  const aspects = aspectOrder.map(aspect => button(aspectEntry(aspect)!.name, `aspect/${aspect}`, `${aspectEntry(aspect)!.name} aspects`, aspectSymbols[aspect]));
  const concepts = ['retrograde', 'orb', 'degrees', 'natal-chart', 'transits', 'house-systems', 'moon-phases', 'lunar-parallax']
    .map(id => button(conceptEntry(id)!.name, `concept/${id}`, `About ${conceptEntry(id)!.name}`));
  const unavailable = model.houses ? undefined : `${unavailableText(model.houseReason)} Houses and angles are not drawn, but their meanings are still here.`;
  return [intro, group('Zodiac signs', signs), group('Houses', houses, unavailable), group('Angles', angles), group('Aspect types', aspects), group('Ideas', concepts)];
}

export function renderInspection(container: HTMLElement, model: InspectorModel) {
  const [layer, id] = model.key.split('/') as [string, PlanetId];
  const element = parseElementKey(model.key);
  let parts: HTMLElement[];
  if (model.aspect) parts = aspectView(model, model.aspect);
  else if (element) parts = elementView(model, element);
  else if (model.position && (layer === 'natal' || layer === 'transit')) parts = planetView(model, layer, id, model.position);
  else parts = indexView(model);
  // Every view can return to where it was opened from, or to the guide, so nothing is a dead end on a desktop
  // screen where there is no selection bar to clear.
  if (model.back && element?.type === 'concept') {
    parts.unshift(jump([`← Back to ${model.back.label}`], model.back.key, `Back to ${model.back.label}`, 'back-link'));
  } else if (model.key) {
    parts.unshift(jump(['← Chart guide'], '', 'Back to the chart guide', 'back-link'));
  }
  // Keep what the reader opened across the quiet redraws of Time Machine stepping, and skip identical renders
  // so a screen reader is not re-announced the whole panel for nothing.
  const staging = node('div');
  staging.append(...parts);
  if (container.dataset.key === model.key) {
    for (const open of container.querySelectorAll<HTMLDetailsElement>('details[open][data-detail]')) {
      staging.querySelector<HTMLDetailsElement>(`details[data-detail="${open.dataset.detail}"]`)?.setAttribute('open', '');
    }
    if (staging.innerHTML === container.innerHTML) return;
  }
  container.dataset.key = model.key;
  container.replaceChildren(...staging.childNodes);
}

function elementView(model: InspectorModel, element: ElementRef) {
  switch (element.type) {
    case 'sign': return signView(model, element.index);
    case 'house': return houseView(model, element.number);
    case 'angle': return angleView(model, element.which);
    case 'aspect': return aspectTypeView(model, element.aspect as keyof typeof aspectAngles);
    case 'concept': return conceptView(model, element.id);
  }
}
