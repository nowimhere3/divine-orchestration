import { angularSeparation } from '../domain/aspects';
import type { AspectFact } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { Chart, HouseFacts, HouseId, PlanetId } from '../domain/chart';
import {
  angleEntry, aspectEntry, bodyEntry, bodyMeta, houseEntry, houseMeta, signEntry, signMeta,
} from '../knowledge';
import type { SourceId, ZodiacElement, ZodiacMode } from '../knowledge';
import { angularDistance, natalHouse, planetName, signPosition, wrapDegrees } from '../view/chart-data';
import type { PositionMap } from '../view/chart-data';
import { ELEMENT_LABELS, ELEMENT_THEMES, indefiniteArticle, MODE_LABELS, MODE_THEMES } from './copy-natal';
import type { AngleAspectFact, BalanceBreakdown, BalanceBucket, ChartTheme, FactCitation } from './types';

const ELEMENTS: readonly ZodiacElement[] = ['fire', 'earth', 'air', 'water'];
const MODES: readonly ZodiacMode[] = ['cardinal', 'fixed', 'mutable'];

/** Transparent weighting: Luminaries & ASC = 2, Personal & MC = 1.5, Social = 1, Outer = 0.5. */
export const BODY_BALANCE_WEIGHTS: Readonly<Record<PlanetId, number>> = {
  sun: 2,
  moon: 2,
  mercury: 1.5,
  venus: 1.5,
  mars: 1.5,
  jupiter: 1,
  saturn: 1,
  uranus: 0.5,
  neptune: 0.5,
  pluto: 0.5,
};

function signOf(longitudeDeg: number): number {
  return Math.floor(wrapDegrees(longitudeDeg) / 30) % 12;
}

function emptyBucket(): { weight: number; count: number; bodies: string[] } {
  return { weight: 0, count: 0, bodies: [] };
}

export function computeBalance(
  positions: PositionMap,
  houses: HouseFacts | null,
  confirmedSigns?: ReadonlyMap<PlanetId, number>,
): BalanceBreakdown | null {
  const elements: Record<ZodiacElement, { weight: number; count: number; bodies: string[] }> = {
    fire: emptyBucket(), earth: emptyBucket(), air: emptyBucket(), water: emptyBucket(),
  };
  const modes: Record<ZodiacMode, { weight: number; count: number; bodies: string[] }> = {
    cardinal: emptyBucket(), fixed: emptyBucket(), mutable: emptyBucket(),
  };
  let totalWeight = 0;

  const add = (label: string, signIndex: number, weight: number) => {
    const meta = signMeta(signIndex);
    elements[meta.element].weight += weight;
    elements[meta.element].count += 1;
    elements[meta.element].bodies.push(label);
    modes[meta.mode].weight += weight;
    modes[meta.mode].count += 1;
    modes[meta.mode].bodies.push(label);
    totalWeight += weight;
  };

  for (const id of PLANET_IDS) {
    const pos = positions.get(id);
    if (pos) {
      add(planetName(id), signOf(pos.longitudeDeg), BODY_BALANCE_WEIGHTS[id]);
    } else if (confirmedSigns?.has(id)) {
      add(planetName(id), confirmedSigns.get(id)!, BODY_BALANCE_WEIGHTS[id]);
    }
  }

  let includesAngles = false;
  if (houses) {
    add('Ascendant', signOf(houses.ascendantDeg), 2);
    add('Midheaven', signOf(houses.midheavenDeg), 1.5);
    includesAngles = true;
  }

  if (totalWeight <= 0) return null;

  const sortedEl = [...ELEMENTS].sort((a, b) => elements[b].weight - elements[a].weight || elements[b].count - elements[a].count);
  const topEl = sortedEl[0];
  const secondEl = sortedEl[1];
  const dominantElement = elements[topEl].weight >= totalWeight * 0.34 && elements[topEl].weight > elements[secondEl].weight
    ? topEl
    : null;
  const sparseElements = ELEMENTS.filter(el => elements[el].count === 0 || elements[el].weight <= totalWeight * 0.1);

  const sortedMode = [...MODES].sort((a, b) => modes[b].weight - modes[a].weight || modes[b].count - modes[a].count);
  const topMode = sortedMode[0];
  const secondMode = sortedMode[1];
  const dominantMode = modes[topMode].weight >= totalWeight * 0.42 && modes[topMode].weight > modes[secondMode].weight
    ? topMode
    : null;
  const sparseModes = MODES.filter(mode => modes[mode].count === 0);

  return {
    elements: elements as Readonly<Record<ZodiacElement, BalanceBucket>>,
    modes: modes as Readonly<Record<ZodiacMode, BalanceBucket>>,
    dominantElement,
    sparseElements,
    dominantMode,
    sparseModes,
    totalWeight,
    includesAngles,
  };
}

export function buildBalanceTheme(balance: BalanceBreakdown): ChartTheme | null {
  const elSummary = ELEMENTS.map(el => `${ELEMENT_LABELS[el]} ${balance.elements[el].count}`).join(' · ');
  const modeSummary = MODES.map(m => `${MODE_LABELS[m]} ${balance.modes[m].count}`).join(' · ');
  const scope = balance.includesAngles ? '10 planets + ASC/MC' : 'confirmed planetary placements';

  const parts: string[] = [];
  if (balance.dominantElement) {
    const bucket = balance.elements[balance.dominantElement];
    parts.push(
      `Weighted toward ${ELEMENT_LABELS[balance.dominantElement]} (${bucket.bodies.join(', ')}), ${ELEMENT_THEMES[balance.dominantElement].dominant}.`,
    );
  } else {
    parts.push('No single element dominates the chart; traditional readings view a mixed elemental spread as drawing on multiple modes of response depending on the situation.');
  }

  if (balance.sparseElements.length > 0 && balance.sparseElements.length <= 2) {
    const sparse = balance.sparseElements[0];
    const zero = balance.elements[sparse].count === 0;
    parts.push(
      zero
        ? `With no major placements in ${ELEMENT_LABELS[sparse]}, ${ELEMENT_THEMES[sparse].sparse}.`
        : `With lighter weighting in ${ELEMENT_LABELS[sparse]}, ${ELEMENT_THEMES[sparse].sparse}.`,
    );
  }

  if (balance.dominantMode) {
    const bucket = balance.modes[balance.dominantMode];
    parts.push(
      `By modality, ${MODE_LABELS[balance.dominantMode]} signs carry the most weight (${bucket.bodies.join(', ')}), emphasizing ${MODE_THEMES[balance.dominantMode]}.`,
    );
  }

  const title = balance.dominantElement && balance.dominantMode
    ? `${ELEMENT_LABELS[balance.dominantElement]} & ${MODE_LABELS[balance.dominantMode]} emphasis`
    : balance.dominantElement
      ? `${ELEMENT_LABELS[balance.dominantElement]} elemental emphasis`
      : balance.dominantMode
        ? `${MODE_LABELS[balance.dominantMode]} modality emphasis`
        : 'Balanced elemental & modal spread';

  const reflection = balance.dominantElement
    ? ELEMENT_THEMES[balance.dominantElement].reflection
    : 'Which of your natural strengths—action, practicality, perspective or feeling—do you reach for first under pressure?';

  return {
    id: 'theme/balance',
    kind: 'balance',
    title,
    factsSummary: `${scope}: ${elSummary} | ${modeSummary}`,
    symbolismBasis: 'Traditional four-element (triplicity) and three-modality groupings, weighted toward luminaries, personal planets and angles.',
    synthesis: parts.join(' '),
    reflection,
    citations: [],
    sources: ['wiki-triplicity', 'wiki-sign', 'ptolemy'],
  };
}

export function detectStelliums(positions: PositionMap, houses: HouseFacts | null): readonly ChartTheme[] {
  const themes: ChartTheme[] = [];
  const bySign = new Map<number, PlanetId[]>();
  const byHouse = new Map<HouseId, PlanetId[]>();

  for (const id of PLANET_IDS) {
    const pos = positions.get(id);
    if (!pos) continue;
    const s = signOf(pos.longitudeDeg);
    bySign.set(s, [...(bySign.get(s) ?? []), id]);
    const h = natalHouse(pos.longitudeDeg, houses);
    if (h) byHouse.set(h, [...(byHouse.get(h) ?? []), id]);
  }

  for (const [signIndex, ids] of [...bySign.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])) {
    if (ids.length < 3) continue;
    const personalCount = ids.filter(id => !bodyMeta(id).generationalSign).length;
    if (personalCount === 0) continue; // Ignore purely outer-planet generational groupings as personal stelliums.
    const sMeta = signMeta(signIndex);
    const sEntry = signEntry(signIndex)!;
    const names = ids.map(planetName);
    const citations: FactCitation[] = [
      { label: sMeta.name, selectKey: `sign/${signIndex}` },
      ...ids.map(id => ({ label: `Natal ${planetName(id)}`, selectKey: `natal/${id}` })),
    ];
    const outerNote = personalCount < ids.length
      ? ` (${personalCount} personal/social and ${ids.length - personalCount} outer-planet placements)`
      : '';
    themes.push({
      id: `theme/stellium-sign-${signIndex}`,
      kind: 'stellium',
      title: `Concentration in ${sMeta.name} (${ids.length} planets)`,
      factsSummary: `${names.join(', ')} in ${sMeta.name}${outerNote}`,
      symbolismBasis: `${sMeta.name} (${sEntry.tagline.toLowerCase()}): ${sMeta.keywords}.`,
      synthesis:
        `Having ${ids.length} natal planets gathered in ${sMeta.name} forms a sign concentration (stellium), focusing multiple chart themes through `
        + `${indefiniteArticle(`${sMeta.stylePhrase} lens`)}. Traditional readings treat this cluster as a signature emphasis—giving extra voice to ${sMeta.keywords}.`,
      reflection: sEntry.reflection ?? `How do ${sMeta.name} themes tie different areas of your life together?`,
      citations,
      sources: [...sEntry.sources],
    });
  }

  for (const [houseId, ids] of [...byHouse.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])) {
    if (ids.length < 3) continue;
    const hMeta = houseMeta(houseId);
    const hEntry = houseEntry(houseId)!;
    const names = ids.map(planetName);
    const citations: FactCitation[] = [
      { label: `House ${houseId}`, selectKey: `house/${houseId}` },
      ...ids.map(id => ({ label: `Natal ${planetName(id)}`, selectKey: `natal/${id}` })),
    ];
    themes.push({
      id: `theme/stellium-house-${houseId}`,
      kind: 'stellium',
      title: `House ${houseId} focus (${ids.length} planets)`,
      factsSummary: `${names.join(', ')} in House ${houseId} (${hMeta.tagline})`,
      symbolismBasis: `House ${houseId} (${hMeta.group}): ${hMeta.topics}.`,
      synthesis:
        `With ${ids.length} natal planets occupying House ${houseId}, a large share of chart activity converges on ${hMeta.arenaPhrase}. `
        + `Decisions and growth in this single arena often ripple across multiple parts of life.`,
      reflection: hEntry.reflection ?? `Why does ${hMeta.arenaPhrase} hold such recurring focus for me?`,
      citations,
      sources: [...hEntry.sources],
    });
  }

  return themes;
}

export function detectAngularAndHemisphere(
  positions: PositionMap,
  houses: HouseFacts | null,
  angleAspects: readonly AngleAspectFact[],
): readonly ChartTheme[] {
  if (!houses || !positions.size) return [];
  const themes: ChartTheme[] = [];
  const angularHouses: readonly HouseId[] = [1, 4, 7, 10];
  const angularPlanets: { id: PlanetId; house: HouseId }[] = [];
  let above = 0; // Houses 7..12
  let below = 0; // Houses 1..6
  let east = 0; // Houses 10,11,12,1,2,3
  let west = 0; // Houses 4,5,6,7,8,9

  for (const id of PLANET_IDS) {
    const pos = positions.get(id);
    if (!pos) continue;
    const h = natalHouse(pos.longitudeDeg, houses);
    if (!h) continue;
    if (angularHouses.includes(h)) angularPlanets.push({ id, house: h });
    if (h >= 7) above += 1; else below += 1;
    if (h <= 3 || h >= 10) east += 1; else west += 1;
  }

  const tightAngleContacts = angleAspects.filter(a => a.orbDeg <= 3);

  if (angularPlanets.length >= 3 || tightAngleContacts.length >= 2) {
    const citations: FactCitation[] = [
      ...angularPlanets.map(({ id, house }) => ({ label: `Natal ${planetName(id)} (H${house})`, selectKey: `natal/${id}` })),
      ...tightAngleContacts.slice(0, 3).map(a => ({
        label: `${planetName(a.planetId)} ${a.aspect} ${a.angle.toUpperCase()}`,
        selectKey: `angle/${a.angle}`,
      })),
    ];
    const parts: string[] = [];
    if (angularPlanets.length) {
      parts.push(`${angularPlanets.length} planets sit in angular houses (${angularPlanets.map(p => `${planetName(p.id)} in H${p.house}`).join(', ')})`);
    }
    if (tightAngleContacts.length) {
      parts.push(`tight angle contacts include ${tightAngleContacts.slice(0, 3).map(a => `${planetName(a.planetId)} ${a.aspect} ${a.angle.toUpperCase()} (${a.orbDeg.toFixed(1)}°)`).join(', ')}`);
    }
    themes.push({
      id: 'theme/angular-emphasis',
      kind: 'angular',
      title: 'Strong angular emphasis',
      factsSummary: parts.join('; '),
      symbolismBasis: 'Angular houses (1, 4, 7, 10) and tight contacts to the Ascendant and Midheaven are traditionally read as prominent, outward-facing anchors.',
      synthesis:
        `With ${parts.join(' and ')}, traditional astrology reads this chart as strongly anchored around visible life pillars—identity, home foundations, partnership and public direction.`,
      reflection: 'Which visible commitments or life pillars feel most central to who I am right now?',
      citations,
      sources: [...angleEntry('asc')!.sources, ...houseEntry(1)!.sources],
    });
  }

  const total = above + below;
  if (total >= 8) {
    const isWholeSign = houses.effectiveSystem === 'WholeSign';
    const horizonAligned = !isWholeSign
      && angularSeparation(houses.cusps[0].longitudeDeg, houses.ascendantDeg) < 0.01
      && angularSeparation(houses.cusps[6].longitudeDeg, wrapDegrees(houses.ascendantDeg + 180)) < 0.01;
    const meridianAligned = !isWholeSign
      && angularSeparation(houses.cusps[9].longitudeDeg, houses.midheavenDeg) < 0.01
      && angularSeparation(houses.cusps[3].longitudeDeg, wrapDegrees(houses.midheavenDeg + 180)) < 0.01;

    if (!horizonAligned || !meridianAligned) {
      // Whole Sign (or non-quadrant) house cusps align with 30° zodiac signs rather than the physical horizon/meridian axes.
      const systemLabel = isWholeSign ? 'Whole Sign' : houses.effectiveSystem;
      const upperLower = above >= 7
        ? {
          label: `Houses 7–12 (${systemLabel} upper houses)`,
          count: above,
          reading: 'concentrates chart activity in the upper house group associated with relationships, public life, community and outward contribution',
        }
        : below >= 7
          ? {
            label: `Houses 1–6 (${systemLabel} lower houses)`,
            count: below,
            reading: 'concentrates chart activity in the lower house group associated with private foundations, personal craft, home roots and inner development',
          }
          : null;
      const eastWest = east >= 7
        ? {
          label: `Houses 10–3 (${systemLabel})`,
          count: east,
          reading: 'traditionally leans toward self-initiation and steering your own pace',
        }
        : west >= 7
          ? {
            label: `Houses 4–9 (${systemLabel})`,
            count: west,
            reading: 'traditionally highlights collaboration, responsiveness and growth through others',
          }
          : null;

      if (upperLower || eastWest) {
        const factBits = [
          upperLower ? `${upperLower.count} of ${total} planets in ${upperLower.label}` : null,
          eastWest ? `${eastWest.count} of ${total} planets in ${eastWest.label}` : null,
        ].filter(Boolean);
        const synthesisBits = [
          upperLower ? `This ${systemLabel} house-group weighting ${upperLower.reading}.` : null,
          eastWest ? `Across the 10–3 / 4–9 house split, this ${eastWest.reading}.` : null,
        ].filter(Boolean);
        themes.push({
          id: 'theme/hemisphere',
          kind: 'hemisphere',
          title: `${systemLabel} house-group emphasis`,
          factsSummary: `${factBits.join(' · ')} (counted by ${systemLabel} houses, not physical horizon/meridian coordinates)`,
          symbolismBasis: `Traditional house-half grouping under ${systemLabel} houses; ${systemLabel} boundaries follow 30° zodiac signs rather than the exact Ascendant–Descendant horizon or Midheaven–IC meridian axes.`,
          synthesis: synthesisBits.join(' '),
          reflection: 'How do I balance private restoration with outward engagement and collaboration?',
          citations: [],
          sources: ['wiki-house', 'lilly', 'britannica-astrology'],
        });
      }
    } else {
      // Quadrant house systems (Placidus, Porphyry fallback): Cusp 1/7 = ASC/DSC and Cusp 10/4 = MC/IC.
      const vertical = above >= 7
        ? { side: 'Southern (above the ASC–DSC horizon axis, Houses 7–12)', count: above, reading: 'places noticeable emphasis on public life, relationships, community and outward contribution' }
        : below >= 7
          ? { side: 'Northern (below the ASC–DSC horizon axis, Houses 1–6)', count: below, reading: 'places noticeable emphasis on private foundations, personal craft, home roots and inner development' }
          : null;
      const horizontal = east >= 7
        ? { side: 'Eastern (ASC side of the MC–IC meridian, Houses 10–3)', count: east, reading: 'traditionally leans toward self-initiation and steering your own pace' }
        : west >= 7
          ? { side: 'Western (DSC side of the MC–IC meridian, Houses 4–9)', count: west, reading: 'traditionally highlights collaboration, responsiveness and growth through others' }
          : null;

      if (vertical || horizontal) {
        const factBits = [
          vertical ? `${vertical.count} of ${total} planets in ${vertical.side}` : null,
          horizontal ? `${horizontal.count} of ${total} planets in ${horizontal.side}` : null,
        ].filter(Boolean);
        const synthesisBits = [
          vertical ? `A ${vertical.side.split(' ')[0].toLowerCase()}-hemisphere weighting ${vertical.reading}.` : null,
          horizontal ? `At the same time, an ${horizontal.side.split(' ')[0].toLowerCase()}-hemisphere weighting ${horizontal.reading}.` : null,
        ].filter(Boolean);
        themes.push({
          id: 'theme/hemisphere',
          kind: 'hemisphere',
          title: vertical && horizontal ? 'Pronounced hemisphere focus' : vertical ? `${vertical.side.split(' ')[0]} hemisphere emphasis` : `${horizontal!.side.split(' ')[0]} hemisphere emphasis`,
          factsSummary: factBits.join(' · '),
          symbolismBasis: 'Traditional hemisphere weighting compares planetary distribution across the ASC–DSC horizon axis (public vs. private) and MC–IC meridian axis (self-directed vs. relational).',
          synthesis: synthesisBits.join(' '),
          reflection: 'How do I balance private restoration with outward engagement and collaboration?',
          citations: [],
          sources: ['wiki-house', 'lilly', 'britannica-astrology'],
        });
      }
    }
  }

  return themes;
}

function hasAspect(
  lookup: ReadonlyMap<string, AspectFact>,
  a: PlanetId,
  b: PlanetId,
  kind: AspectFact['aspect'],
): AspectFact | undefined {
  const key = a < b ? `${a}|${b}|${kind}` : `${b}|${a}|${kind}`;
  return lookup.get(key);
}

export function detectAspectPatterns(
  aspects: readonly AspectFact[],
  positions: PositionMap,
): readonly ChartTheme[] {
  const natalAspects = aspects.filter(a => a.from.chartId === 'natal' && a.to.chartId === 'natal');
  if (!natalAspects.length) return [];

  const lookup = new Map<string, AspectFact>();
  const degreeCount = new Map<PlanetId, AspectFact[]>();
  for (const fact of natalAspects) {
    const a = fact.from.planetId;
    const b = fact.to.planetId;
    const key = a < b ? `${a}|${b}|${fact.aspect}` : `${b}|${a}|${fact.aspect}`;
    lookup.set(key, fact);
    degreeCount.set(a, [...(degreeCount.get(a) ?? []), fact]);
    degreeCount.set(b, [...(degreeCount.get(b) ?? []), fact]);
  }

  const themes: ChartTheme[] = [];
  const present = PLANET_IDS.filter(id => positions.has(id));

  // 1. Grand Cross (two oppositions mutually square)
  const grandCrossKeys = new Set<string>();
  const oppositions = natalAspects.filter(a => a.aspect === 'opposition');
  for (let i = 0; i < oppositions.length; i += 1) {
    for (let j = i + 1; j < oppositions.length; j += 1) {
      const o1 = oppositions[i];
      const o2 = oppositions[j];
      const pts = [o1.from.planetId, o1.to.planetId, o2.from.planetId, o2.to.planetId];
      if (new Set(pts).size !== 4) continue;
      if (
        hasAspect(lookup, pts[0], pts[2], 'square')
        && hasAspect(lookup, pts[0], pts[3], 'square')
        && hasAspect(lookup, pts[1], pts[2], 'square')
        && hasAspect(lookup, pts[1], pts[3], 'square')
      ) {
        const sig = [...pts].sort().join('|');
        if (grandCrossKeys.has(sig)) continue;
        grandCrossKeys.add(sig);
        const names = pts.map(planetName);
        themes.push({
          id: `theme/grand-cross-${sig}`,
          kind: 'pattern',
          title: `Grand Cross (${names.join(' · ')})`,
          factsSummary: `Two oppositions (${planetName(pts[0])}–${planetName(pts[1])} and ${planetName(pts[2])}–${planetName(pts[3])}) linked by four squares`,
          symbolismBasis: 'A Grand Cross combines two oppositions and four squares into a four-cornered dynamic of active tension.',
          synthesis:
            `Your chart forms a Grand Cross among ${names.join(', ')}. Traditional interpretation views this geometry as high-energy and motivating—`
            + `pulling four distinct drives into simultaneous negotiation and rewarding deliberate pacing and clear priorities.`,
          reflection: 'When several commitments pull in different directions at once, what helps me choose my next steady step?',
          citations: pts.map(id => ({ label: `Natal ${planetName(id)}`, selectKey: `natal/${id}` })),
          sources: [...aspectEntry('square')!.sources, ...aspectEntry('opposition')!.sources],
        });
      }
    }
  }

  // 2. T-Square (an opposition where a third planet squares both ends)
  const tSquareSigs = new Set<string>();
  for (const opp of oppositions) {
    const a = opp.from.planetId;
    const b = opp.to.planetId;
    for (const apex of present) {
      if (apex === a || apex === b) continue;
      const sqA = hasAspect(lookup, apex, a, 'square');
      const sqB = hasAspect(lookup, apex, b, 'square');
      if (!sqA || !sqB) continue;
      const sig = `${[a, b].sort().join('-')}|${apex}`;
      if (tSquareSigs.has(sig)) continue;
      // Skip if already part of a detected Grand Cross
      if ([...grandCrossKeys].some(gc => gc.includes(a) && gc.includes(b) && gc.includes(apex))) continue;
      tSquareSigs.add(sig);
      const apexName = planetName(apex);
      const apexMeta = bodyMeta(apex);
      themes.push({
        id: `theme/t-square-${sig}`,
        kind: 'pattern',
        title: `T-Square focused on ${apexName}`,
        factsSummary: `${planetName(a)} opposite ${planetName(b)} (${opp.orbDeg.toFixed(1)}°), both square ${apexName} (${sqA.orbDeg.toFixed(1)}° / ${sqB.orbDeg.toFixed(1)}°)`,
        symbolismBasis: 'A T-Square links an opposition to a focal apex planet by two squares, channelling polarity tension into a single point of action.',
        synthesis:
          `With ${planetName(a)} opposing ${planetName(b)} and both squaring ${apexName}, ${apexName} serves as the focal outlet of a T-Square. `
          + `Traditional readings look to ${apexMeta.drivePhrase} as the constructive lever for resolving the push-and-pull between ${planetName(a)} and ${planetName(b)}.`,
        reflection: `How can engaging ${apexMeta.focusPhrase} help balance competing pressures?`,
        citations: [
          { label: `Apex: Natal ${apexName}`, selectKey: `natal/${apex}` },
          { label: `Natal ${planetName(a)}`, selectKey: `natal/${a}` },
          { label: `Natal ${planetName(b)}`, selectKey: `natal/${b}` },
        ],
        sources: [...aspectEntry('square')!.sources, ...aspectEntry('opposition')!.sources],
      });
    }
  }

  // 3. Grand Trine (three planets mutually trine)
  const grandTrineSigs = new Set<string>();
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const t1 = hasAspect(lookup, present[i], present[j], 'trine');
      if (!t1) continue;
      for (let k = j + 1; k < present.length; k += 1) {
        const t2 = hasAspect(lookup, present[i], present[k], 'trine');
        const t3 = hasAspect(lookup, present[j], present[k], 'trine');
        if (!t2 || !t3) continue;
        const pts = [present[i], present[j], present[k]];
        const sig = pts.join('|');
        if (grandTrineSigs.has(sig)) continue;
        grandTrineSigs.add(sig);
        const names = pts.map(planetName);
        const elements = [...new Set(pts.map(id => signMeta(signOf(positions.get(id)!.longitudeDeg)).element))];
        const elNote = elements.length === 1 ? ` in ${ELEMENT_LABELS[elements[0]]}` : '';
        themes.push({
          id: `theme/grand-trine-${sig}`,
          kind: 'pattern',
          title: `Grand Trine${elNote} (${names.join(' · ')})`,
          factsSummary: `${names.join(', ')} linked by three trines (${t1.orbDeg.toFixed(1)}°, ${t2.orbDeg.toFixed(1)}°, ${t3.orbDeg.toFixed(1)}°)`,
          symbolismBasis: 'A Grand Trine connects three planets in a closed triangle of 120° aspects—traditionally read as self-reinforcing flow and natural aptitude.',
          synthesis:
            `${names.join(', ')} form a Grand Trine${elNote}, creating an easy loop of mutual support across ${pts.map(id => bodyEntry(id)!.tagline.toLowerCase()).join(', ')}. `
            + `Because trines operate smoothly, traditional guidance encourages putting this natural fluency to deliberate use rather than letting it stay on autopilot.`,
          reflection: 'Which natural strength comes so easily to me that I sometimes overlook its value?',
          citations: pts.map(id => ({ label: `Natal ${planetName(id)}`, selectKey: `natal/${id}` })),
          sources: [...aspectEntry('trine')!.sources],
        });
      }
    }
  }

  // 4. Focal planet (most connected planet when >= 4 aspects)
  const ranked = [...degreeCount.entries()]
    .sort((a, b) => b[1].length - a[1].length || PLANET_IDS.indexOf(a[0]) - PLANET_IDS.indexOf(b[0]));
  if (ranked.length && ranked[0][1].length >= 4) {
    const [focalId, connected] = ranked[0];
    const focalName = planetName(focalId);
    const focalMeta = bodyMeta(focalId);
    const focalEntry = bodyEntry(focalId)!;
    const partners = connected.map(f => planetName(f.from.planetId === focalId ? f.to.planetId : f.from.planetId));
    themes.push({
      id: `theme/focal-${focalId}`,
      kind: 'pattern',
      title: `Focal planet: ${focalName} (${connected.length} major aspects)`,
      factsSummary: `Natal ${focalName} forms ${connected.length} major aspects (with ${partners.join(', ')})`,
      symbolismBasis: `${focalName} (${focalEntry.tagline.toLowerCase()}) acts as a hub connecting multiple parts of the natal chart.`,
      synthesis:
        `With ${connected.length} major natal aspects converging on ${focalName}, ${focalMeta.drivePhrase} acts as a central crossroads in your chart. `
        + `Themes touched by ${partners.slice(0, 4).join(', ')} repeatedly filter through how ${focalName} operates.`,
      reflection: focalEntry.reflection ?? `How does ${focalMeta.focusPhrase} tie other themes in my life together?`,
      citations: [
        { label: `Natal ${focalName}`, selectKey: `natal/${focalId}` },
        ...connected.slice(0, 3).map(f => ({
          label: `${focalName} ${f.aspect} ${planetName(f.from.planetId === focalId ? f.to.planetId : f.from.planetId)}`,
          selectKey: f.id,
        })),
      ],
      sources: [...focalEntry.sources, 'wiki-aspect'],
    });
  }

  return themes.slice(0, 4);
}

export function detectRetrogradeTheme(positions: PositionMap): ChartTheme | null {
  const retro = PLANET_IDS.filter(id => positions.get(id)?.retrograde);
  const personalRetro = retro.filter(id => id === 'mercury' || id === 'venus' || id === 'mars');
  if (personalRetro.length === 0 && retro.length < 3) return null;

  const names = retro.map(planetName);
  const citations: FactCitation[] = retro.map(id => ({ label: `Natal ${planetName(id)} ℞`, selectKey: `natal/${id}` }));
  const personalClause = personalRetro.length
    ? `Including personal ${personalRetro.length === 1 ? 'planet' : 'planets'} ${personalRetro.map(planetName).join(' and ')}, `
    : '';
  return {
    id: 'theme/retrograde',
    kind: 'retrograde',
    title: `Retrograde emphasis (${retro.length} natal ${retro.length === 1 ? 'planet' : 'planets'} ℞)`,
    factsSummary: `Negative apparent ecliptic speed at birth: ${names.join(', ')}`,
    symbolismBasis: 'Apparent retrograde motion is an observational perspective effect; traditionally it is linked with reflective, inward-first processing rather than misfortune.',
    synthesis:
      `${personalClause}${names.join(', ')} ${retro.length === 1 ? 'was' : 'were'} in apparent retrograde motion at birth. `
      + `Traditional symbolism reads natal retrograde placements as turning those themes inward first—favouring reflection, revision and self-defined timing over rushing ahead.`,
    reflection: 'Where do I do my best work by reflecting quietly and revising before sharing with others?',
    citations,
    sources: ['wiki-retrograde', 'wiki-planets-astrology'],
  };
}

export function detectSensitivityNotes(
  chart: Chart,
  positions: PositionMap,
  houses: HouseFacts | null,
): readonly string[] {
  const notes: string[] = [];
  const allWarnings = new Set<string>([
    ...chart.warnings,
    ...(chart.time.kind === 'resolved' ? chart.time.warnings : []),
  ]);

  if (allWarnings.has('historical-zone-offset-uncertain')) {
    notes.push('Historical time-zone offset uncertainty applies to this date; if a recorded UTC offset is available, entering it can sharpen the Ascendant, houses and Moon degree.');
  }
  if (allWarnings.has('pre-utc-ut1-approximation')) {
    notes.push('This date predates modern UTC records, so UT1 and exact house cusps are approximate.');
  }
  if (allWarnings.has('polar-house-fallback')) {
    notes.push('Placidus houses are undefined at this extreme latitude, so the engine fell back to Porphyry cusps.');
  }

  const moon = positions.get('moon');
  if (moon) {
    const degInSign = wrapDegrees(moon.longitudeDeg) % 30;
    if (degInSign < 1 || degInSign > 29) {
      notes.push(`Natal Moon (${signPosition(moon.longitudeDeg)}) sits within 1° of a sign boundary; even a two-hour shift in birth time could place it in the neighbouring sign.`);
    }
  }

  if (houses) {
    const ascDeg = wrapDegrees(houses.ascendantDeg) % 30;
    if (ascDeg < 2 || ascDeg > 28) {
      notes.push(`Ascendant (${signPosition(houses.ascendantDeg)}) sits within 2° of a sign boundary; a change of roughly 8 minutes in birth time can shift the rising sign and Whole Sign houses.`);
    }
    const mcDeg = wrapDegrees(houses.midheavenDeg) % 30;
    if (mcDeg < 2 || mcDeg > 28) {
      notes.push(`Midheaven (${signPosition(houses.midheavenDeg)}) sits within 2° of a sign boundary and is sensitive to small changes in birth time.`);
    }
    if (houses.effectiveSystem !== 'WholeSign') {
      const nearCusp: string[] = [];
      for (const id of PLANET_IDS) {
        const pos = positions.get(id);
        if (!pos) continue;
        const h = natalHouse(pos.longitudeDeg, houses);
        if (!h) continue;
        const nextCusp = houses.cusps[h % 12].longitudeDeg;
        const toNext = angularDistance(nextCusp, pos.longitudeDeg);
        if (toNext > 0 && toNext < 1.5) {
          nearCusp.push(`${planetName(id)} (within ${toNext.toFixed(1)}° of House ${(h % 12) + 1})`);
        }
      }
      if (nearCusp.length) {
        notes.push(
          `Under ${houses.effectiveSystem} houses, ${nearCusp.join(', ')} ${nearCusp.length === 1 ? 'sits' : 'sit'} close to the next house cusp and ${nearCusp.length === 1 ? 'is' : 'are'} sensitive to birth-time precision.`,
        );
      }
    }
  }

  return notes;
}

export function collectSources(...groups: readonly (readonly SourceId[])[]): readonly SourceId[] {
  const set = new Set<SourceId>();
  for (const group of groups) for (const id of group) set.add(id);
  return [...set];
}
