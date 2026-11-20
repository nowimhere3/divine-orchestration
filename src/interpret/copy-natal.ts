import type { AspectId } from '../domain/aspects';
import type { HouseId, PlanetId } from '../domain/chart';
import {
  angleEntry, aspectEntry, aspectMeta, bodyEntry, bodyMeta, houseEntry, houseMeta, signEntry, signMeta,
} from '../knowledge';
import type { AspectTone, SourceId, ZodiacElement, ZodiacMode } from '../knowledge';
import type { LunarPhaseId } from '../lunar';
import { planetName, titleCase } from '../view/chart-data';
import type { AngleId, TightnessTier } from './types';

export function indefiniteArticle(phrase: string): string {
  return /^[aeiou]/i.test(phrase.trim()) ? `an ${phrase}` : `a ${phrase}`;
}

export const EPISTEMIC_DISCLAIMER =
  'Astronomical positions, houses and aspect angles are calculated from the bundled ephemeris. '
  + 'Astrological meanings reflect Western traditional and modern symbolism—a cultural language for reflection, not scientific measurement or guaranteed prediction.';

export const ELEMENT_LABELS: Readonly<Record<ZodiacElement, string>> = {
  fire: 'Fire',
  earth: 'Earth',
  air: 'Air',
  water: 'Water',
};

export const ELEMENT_THEMES: Readonly<Record<ZodiacElement, { readonly dominant: string; readonly sparse: string; readonly reflection: string }>> = {
  fire: {
    dominant: 'strong Fire emphasis traditionally points toward spontaneity, candour, enthusiasm and learning through direct action',
    sparse: 'lighter Fire emphasis traditionally suggests pacing initiative thoughtfully rather than acting on impulse',
    reflection: 'Where does taking a direct first step energise me, and where do I prefer steady preparation?',
  },
  earth: {
    dominant: 'strong Earth emphasis traditionally highlights practicality, patience, reliability and building tangible results over time',
    sparse: 'lighter Earth emphasis traditionally invites conscious routines and grounding anchors so ideas turn into lasting habits',
    reflection: 'Which practical habits help turn my ideas into something steady and livable?',
  },
  air: {
    dominant: 'strong Air emphasis traditionally centres on perspective, conversation, pattern-making and connecting ideas with people',
    sparse: 'lighter Air emphasis traditionally points toward trusting lived experience and intuition while intentionally making room for outside dialogue',
    reflection: 'How does talking an idea through—or stepping back for perspective—clarify my choices?',
  },
  water: {
    dominant: 'strong Water emphasis traditionally emphasizes emotional depth, intuition, memory and sensitivity to relational atmosphere',
    sparse: 'lighter Water emphasis traditionally favours clear analysis or practical action while benefiting from deliberate space to check in with feelings',
    reflection: 'What helps me stay attuned to my feelings without being overwhelmed by them?',
  },
};

export const MODE_LABELS: Readonly<Record<ZodiacMode, string>> = {
  cardinal: 'Cardinal',
  fixed: 'Fixed',
  mutable: 'Mutable',
};

export const MODE_THEMES: Readonly<Record<ZodiacMode, string>> = {
  cardinal: 'initiating change, setting direction and opening new chapters',
  fixed: 'sustaining effort, deepening commitment and holding steady through pressure',
  mutable: 'adapting, synthesizing perspectives and refining plans as conditions shift',
};

const LUNAR_PHASE_THEMES: Readonly<Record<LunarPhaseId, { readonly theme: string; readonly reflection: string }>> = {
  new: {
    theme: 'being born near a New Moon is traditionally linked with an instinct for fresh starts, subjective focus and learning directly from experience',
    reflection: 'Where do I feel drawn to begin from a clean slate rather than following an established script?',
  },
  'waxing-crescent': {
    theme: 'a Waxing Crescent birth Moon is traditionally associated with curiosity, perseverance and testing emerging ideas against familiar patterns',
    reflection: 'Which emerging interest or goal deserves patient, early-stage effort?',
  },
  'first-quarter': {
    theme: 'a First Quarter birth Moon is traditionally read as a turning-point temperament—decisive, action-oriented and energized by constructive challenge',
    reflection: 'How do I handle moments that call for a clear choice between two directions?',
  },
  'waxing-gibbous': {
    theme: 'a Waxing Gibbous birth Moon is traditionally linked with craft, analysis and wanting to refine work until it feels ready to share',
    reflection: 'Where does my desire to improve something help me, and where can I let it be good enough?',
  },
  full: {
    theme: 'being born near a Full Moon is traditionally associated with vivid relational awareness—holding conscious identity and emotional response in clear dialogue',
    reflection: 'How do close relationships mirror qualities I am learning to integrate in myself?',
  },
  'waning-gibbous': {
    theme: 'a Waning Gibbous birth Moon is traditionally linked with sharing hard-won insights, mentoring and translating personal experience into wider meaning',
    reflection: 'What have I learned through experience that feels meaningful to pass along?',
  },
  'last-quarter': {
    theme: 'a Last Quarter birth Moon is traditionally associated with quiet re-evaluation, independent judgment and letting go of approaches that no longer fit',
    reflection: 'Which inherited habit or assumption am I ready to rethink on my own terms?',
  },
  'waning-crescent': {
    theme: 'a Waning Crescent birth Moon is traditionally linked with reflection, synthesis and a contemplative appreciation for closure and renewal',
    reflection: 'What kind of quiet space helps me integrate what I have lived through?',
  },
};

export function lunarPhaseSynthesis(phase: LunarPhaseId) {
  return LUNAR_PHASE_THEMES[phase];
}

export function tightnessTier(orbDeg: number, allowedOrbDeg: number): TightnessTier {
  if (allowedOrbDeg <= 0) return 'tight';
  const ratio = orbDeg / allowedOrbDeg;
  if (orbDeg <= 1.5 || ratio <= 0.25) return 'tight';
  if (orbDeg <= 4 || ratio <= 0.6) return 'moderate';
  return 'wide';
}

export function tightnessPhrase(tier: TightnessTier): string {
  switch (tier) {
    case 'tight': return 'very close (tight orb)';
    case 'moderate': return 'moderately close';
    case 'wide': return 'wider orb (background emphasis)';
  }
}

export function composePlacementSynthesis(input: {
  readonly planetId: PlanetId;
  readonly signIndex: number;
  readonly formattedPosition: string;
  readonly houseNumber: HouseId | null;
  readonly retrograde: boolean;
  readonly isDateOnly?: boolean;
}): { readonly symbolismBasis: string; readonly synthesis: string; readonly reflection: string; readonly sources: readonly SourceId[] } {
  const bMeta = bodyMeta(input.planetId);
  const bEntry = bodyEntry(input.planetId)!;
  const sMeta = signMeta(input.signIndex);
  const sEntry = signEntry(input.signIndex)!;
  const hMeta = input.houseNumber ? houseMeta(input.houseNumber) : null;
  const hEntry = input.houseNumber ? houseEntry(input.houseNumber) : null;
  const name = planetName(input.planetId);

  const basisParts = [
    `${name} (${bEntry.tagline.toLowerCase()})`,
    `${sMeta.name} (${titleCase(sMeta.mode)} ${ELEMENT_LABELS[sMeta.element]}: ${sMeta.keywords})`,
  ];
  if (hMeta && hEntry) {
    basisParts.push(`House ${hMeta.number} (${hEntry.tagline.toLowerCase()}, ${hMeta.group})`);
  }
  const symbolismBasis = basisParts.join(' · ');

  const sentences: string[] = [];
  if (bMeta.generationalSign) {
    if (hMeta) {
      sentences.push(
        `Because ${name} moves slowly, ${name} in ${sMeta.name} describes a shared generational backdrop coloured by ${sMeta.stylePhrase} themes. `
        + `In your chart, House ${hMeta.number} (${hMeta.group}) makes ${bMeta.drivePhrase} personal—bringing those themes into ${hMeta.arenaPhrase}.`,
      );
    } else {
      sentences.push(
        `Because ${name} stays in one sign for years, ${name} in ${sMeta.name} reflects a generational tone shaped by ${sMeta.stylePhrase} qualities; `
        + `its aspects to personal planets show where ${bMeta.drivePhrase} becomes individual in your chart.`,
      );
    }
  } else if (hMeta) {
    const angularClause = hMeta.group === 'angular'
      ? ` Because House ${hMeta.number} is angular, this placement carries visible weight in the overall chart.`
      : '';
    sentences.push(
      `With natal ${name} at ${input.formattedPosition} in House ${hMeta.number}, traditional symbolism colours ${bMeta.drivePhrase} `
      + `with ${indefiniteArticle(`${sMeta.stylePhrase} ${sMeta.name} style`)}, directed toward ${hMeta.arenaPhrase}.${angularClause}`,
    );
  } else {
    const where = input.isDateOnly ? `in ${sMeta.name} across your birth date` : `at ${input.formattedPosition}`;
    sentences.push(
      `With natal ${name} ${where}, traditional symbolism shapes ${bMeta.drivePhrase} through ${indefiniteArticle(`${sMeta.stylePhrase} ${sMeta.name} lens`)}, `
      + `highlighting ${sMeta.keywords}.`,
    );
  }

  if (input.retrograde && bMeta.retrogradeNuance) {
    sentences.push(bMeta.retrogradeNuance);
  }

  const reflection = hEntry?.reflection && bMeta.generationalSign
    ? hEntry.reflection
    : bEntry.reflection ?? sEntry.reflection ?? `How do ${sMeta.name} qualities show up in ${bMeta.focusPhrase}?`;

  const sourceSet = new Set<SourceId>([...bEntry.sources, ...sEntry.sources, ...(hEntry?.sources ?? [])]);
  return { symbolismBasis, synthesis: sentences.join(' '), reflection, sources: [...sourceSet] };
}

export function composeBoundaryDayPlacement(input: {
  readonly planetId: PlanetId;
  readonly signSequence: readonly number[];
  readonly startFormatted: string;
  readonly endFormatted: string;
}): { readonly symbolismBasis: string; readonly synthesis: string; readonly reflection: string; readonly sources: readonly SourceId[] } {
  const bEntry = bodyEntry(input.planetId)!;
  const bMeta = bodyMeta(input.planetId);
  const name = planetName(input.planetId);
  const signs = input.signSequence.map(signMeta);
  const route = signs.map(sign => sign.name).join(' → ');
  const uniqueIndices = [...new Set(input.signSequence)];
  const possibilities = uniqueIndices.map(index => {
    const sign = signMeta(index);
    return `${sign.name} (${sign.stylePhrase})`;
  });
  const crossing = signs.length === 2
    ? `crossed from ${signs[0].name} into ${signs[1].name}`
    : `followed the sign sequence ${route}`;
  const symbolismBasis = `${name} (${bEntry.tagline.toLowerCase()}) · Sign boundary day (${route})`;
  const synthesis =
    `On your birth date, ${name} ${crossing} (${input.startFormatted} to ${input.endFormatted}). `
    + `Without a recorded birth time, the chart cannot confirm whether ${bMeta.drivePhrase} aligns with `
    + `${possibilities.join(' or ')}. Adding even an approximate birth time helps resolve this boundary.`;
  const reflection = bEntry.reflection ?? 'Which of these signs feels closer to how you recognise yourself?';
  const sourceSet = new Set<SourceId>([...bEntry.sources, ...uniqueIndices.flatMap(index => signEntry(index)!.sources)]);
  return { symbolismBasis, synthesis, reflection, sources: [...sourceSet] };
}

export function composeAngleSynthesis(input: {
  readonly angle: AngleId;
  readonly signIndex: number;
  readonly formattedPosition: string;
  readonly oppositeLabel: string;
  readonly inHouse: HouseId | null;
  readonly houseSystemLabel: string;
}): { readonly symbolismBasis: string; readonly synthesis: string; readonly reflection: string; readonly sources: readonly SourceId[] } {
  const entry = angleEntry(input.angle)!;
  const sMeta = signMeta(input.signIndex);
  const sEntry = signEntry(input.signIndex)!;
  const oppositeSign = signMeta((input.signIndex + 6) % 12);

  const symbolismBasis = `${entry.longName ?? entry.name} (${entry.tagline.toLowerCase()}) · ${sMeta.name} (${titleCase(sMeta.mode)} ${ELEMENT_LABELS[sMeta.element]})`;

  let synthesis: string;
  if (input.angle === 'asc') {
    synthesis =
      `An Ascendant at ${input.formattedPosition} frames your outward approach and first impressions through ${indefiniteArticle(`${sMeta.stylePhrase} ${sMeta.name} lens`)}, `
      + `emphasizing ${sMeta.keywords}. Directly across the horizon sits the Descendant in ${oppositeSign.name} (${input.oppositeLabel}), `
      + `traditionally linking partnership themes with ${oppositeSign.stylePhrase} qualities.`;
  } else {
    const houseNote = input.inHouse && input.inHouse !== 10
      ? ` Under ${input.houseSystemLabel}, the Midheaven falls in House ${input.inHouse}, linking public aims with ${houseMeta(input.inHouse).arenaPhrase}.`
      : '';
    synthesis =
      `A Midheaven at ${input.formattedPosition} places ${sMeta.name} at the meridian—traditionally associating vocation, public standing and long-term direction `
      + `with ${indefiniteArticle(`${sMeta.stylePhrase} approach`)} (${sMeta.keywords}). Opposite it, the Imum Coeli in ${oppositeSign.name} (${input.oppositeLabel}) grounds private roots in ${oppositeSign.stylePhrase} values.${houseNote}`;
  }

  const sourceSet = new Set<SourceId>([...entry.sources, ...sEntry.sources]);
  return {
    symbolismBasis,
    synthesis,
    reflection: entry.reflection ?? sEntry.reflection ?? 'How do I want to meet the world and contribute publicly?',
    sources: [...sourceSet],
  };
}

export function composeChartRulerSynthesis(input: {
  readonly ascSignIndex: number;
  readonly rulerId: PlanetId;
  readonly modernCoRulerId: PlanetId | null;
  readonly rulerSignIndex: number;
  readonly rulerFormatted: string;
  readonly rulerHouse: HouseId | null;
}): { readonly symbolismBasis: string; readonly synthesis: string; readonly reflection: string; readonly sources: readonly SourceId[] } {
  const ascSign = signMeta(input.ascSignIndex);
  const rulerMeta = bodyMeta(input.rulerId);
  const rulerEntry = bodyEntry(input.rulerId)!;
  const rulerSign = signMeta(input.rulerSignIndex);
  const hMeta = input.rulerHouse ? houseMeta(input.rulerHouse) : null;
  const rulerName = planetName(input.rulerId);

  const coRulerClause = input.modernCoRulerId
    ? ` (with ${planetName(input.modernCoRulerId)} often read alongside it as modern co-ruler)`
    : '';
  const houseClause = hMeta
    ? ` in House ${hMeta.number}, routing first-house themes of personal approach directly into ${hMeta.arenaPhrase}`
    : '';

  const symbolismBasis = `Ascendant in ${ascSign.name} → traditional ruler ${rulerName} (${rulerEntry.tagline.toLowerCase()}) in ${rulerSign.name}${hMeta ? ` · House ${hMeta.number}` : ''}`;
  const synthesis =
    `Because ${ascSign.name} is rising, ${rulerName} acts as the traditional chart ruler${coRulerClause}. `
    + `With ${rulerName} placed at ${input.rulerFormatted}${houseClause}, the chart links how you step into the world with `
    + `${rulerMeta.drivePhrase} expressed in ${indefiniteArticle(`${rulerSign.stylePhrase} ${rulerSign.name} style`)}.`;
  const reflection = hMeta
    ? `How does investing in ${hMeta.arenaPhrase} strengthen your overall sense of direction?`
    : `How does ${rulerMeta.focusPhrase} shape the way you approach new situations?`;

  const sourceSet = new Set<SourceId>([
    ...angleEntry('asc')!.sources,
    ...signEntry(input.ascSignIndex)!.sources,
    ...rulerEntry.sources,
    ...signEntry(input.rulerSignIndex)!.sources,
    ...(hMeta ? houseEntry(hMeta.number)!.sources : []),
  ]);
  return { symbolismBasis, synthesis, reflection, sources: [...sourceSet] };
}

/** Curated pair-specific hooks for high-impact luminary, personal and Saturn/outer combinations. */
const PAIR_NUCLEI: Readonly<Record<string, Readonly<Record<AspectTone, string>>>> = {
  'moon|sun': {
    blend: 'Conscious identity and emotional instincts travel closely together, creating unified focus and strong alignment between outer aims and inner needs.',
    support: 'Conscious purpose and emotional habits naturally reinforce one another, making it easier to feel at home with the direction you choose.',
    tense: 'Conscious goals and emotional comfort pull in distinct directions, inviting ongoing awareness so neither ambition nor emotional needs are neglected.',
  },
  'mercury|sun': {
    blend: 'Core identity and thinking style work hand in hand, giving communication personal conviction and making ideas central to self-expression.',
    support: 'Self-expression and communication cooperate smoothly, helping you articulate priorities clearly.',
    tense: 'Personal perspective and analytical distance can compete for the lead, encouraging reflection before committing to a viewpoint.',
  },
  'sun|venus': {
    blend: 'Identity and personal values intertwine closely, highlighting warmth, aesthetic discernment and relational awareness in how you present yourself.',
    support: 'Core vitality and appreciation harmonize easily, lending natural grace to creative and social expression.',
    tense: 'Personal direction and the wish for harmony can tug against each other, asking for honest boundaries in relationships.',
  },
  'mars|sun': {
    blend: 'Vitality and initiative fuse directly, underlining candour, decisiveness and a preference for learning through active effort.',
    support: 'Purpose and drive cooperate cleanly, helping you follow through on plans with steady confidence.',
    tense: 'Strong willpower and urgency can generate friction, inviting constructive outlets where drive serves clear priorities.',
  },
  'jupiter|sun': {
    blend: 'Identity and appetite for growth amplify one another, supporting generosity, big-picture vision and willingness to reach further.',
    support: 'Purpose and optimism flow together easily, opening doors through curiosity, learning and breadth of perspective.',
    tense: 'Enthusiasm can stretch past practical limits, rewarding grounded pacing alongside ambitious goals.',
  },
  'saturn|sun': {
    blend: 'Identity and responsibility sit side by side, emphasizing self-discipline, seriousness of purpose and earned competence over time.',
    support: 'Vitality and structure support each other steadily, helping long-term effort build durable confidence.',
    tense: 'Self-expression meets high internal standards and careful scrutiny, motivating steady mastery while inviting patience with yourself.',
  },
  'mercury|moon': {
    blend: 'Feelings and thoughts mingle immediately, helping you put emotional nuance into words and notice tone as closely as facts.',
    support: 'Emotional instincts and everyday reasoning talk easily to one another, supporting perceptive communication.',
    tense: 'What feels right emotionally and what looks logical on paper can diverge, inviting time to let both perspectives speak.',
  },
  'moon|venus': {
    blend: 'Emotional needs and affection blend naturally, emphasizing warmth, sensitivity to beauty and care for the atmosphere around you.',
    support: 'Comfort and relational ease reinforce one another, supporting kindness, hospitality and aesthetic enjoyment.',
    tense: 'Inner security and the desire to please others can pull apart, inviting honest clarity about what genuinely nourishes you.',
  },
  'mars|moon': {
    blend: 'Feelings and action ignite quickly together, pairing emotional honesty with protective energy and direct responsiveness.',
    support: 'Instinct and courage cooperate smoothly, helping you act decisively on behalf of what matters to you.',
    tense: 'Emotional reactivity and urgency can spike under pressure, benefiting from physical or creative outlets that channel heat constructively.',
  },
  'moon|saturn': {
    blend: 'Emotional life and responsibility are closely linked, favouring loyalty, composure and careful stewardship of trust.',
    support: 'Feelings and structure steady each other, supporting dependable care and calm resilience in demanding seasons.',
    tense: 'Emotional vulnerability meets caution and high expectations, inviting self-compassion alongside practical boundaries.',
  },
  'mars|venus': {
    blend: 'Desire, affection and initiative combine vividly, bringing creative spark and directness to relationships and passions.',
    support: 'Receptivity and drive work together gracefully, balancing warmth with confident follow-through.',
    tense: 'Connection and independence pull in lively contrast, energizing creativity when both closeness and autonomy have room.',
  },
  'jupiter|saturn': {
    blend: 'Expansion and realism sit together, pairing vision with practical architecture so ambitious aims stay grounded.',
    support: 'Growth and structure balance one another cleanly, supporting steady, sustainable progress.',
    tense: 'The urge to expand and the duty to consolidate alternate in emphasis, calling for disciplined timing rather than all-or-nothing leaps.',
  },
};

function pairKey(a: PlanetId, b: PlanetId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function composePlanetAspectSynthesis(input: {
  readonly from: PlanetId;
  readonly to: PlanetId;
  readonly aspect: AspectId;
  readonly orbDeg: number;
  readonly allowedOrbDeg: number;
  readonly fromHouse: HouseId | null;
  readonly toHouse: HouseId | null;
  readonly isDateOnly?: boolean;
}): { readonly symbolismBasis: string; readonly synthesis: string; readonly reflection: string; readonly sources: readonly SourceId[] } {
  const aMeta = aspectMeta(input.aspect);
  const aEntry = aspectEntry(input.aspect)!;
  const fEntry = bodyEntry(input.from)!;
  const tEntry = bodyEntry(input.to)!;
  const fMeta = bodyMeta(input.from);
  const tMeta = bodyMeta(input.to);
  const tier = tightnessTier(input.orbDeg, input.allowedOrbDeg);

  const symbolismBasis = `${planetName(input.from)} (${fEntry.tagline.toLowerCase()}) · ${aEntry.name} (${aMeta.toneLabel.toLowerCase()}) · ${planetName(input.to)} (${tEntry.tagline.toLowerCase()})`;

  const nucleus = PAIR_NUCLEI[pairKey(input.from, input.to)]?.[aMeta.tone];
  const baseLine = nucleus
    ?? `This ${aEntry.name.toLowerCase()} between ${planetName(input.from)} and ${planetName(input.to)} ${aMeta.natalDynamic}—linking ${fMeta.drivePhrase} with ${tMeta.drivePhrase}.`;

  const houseLink = input.fromHouse && input.toHouse && input.fromHouse !== input.toHouse
    ? ` In your chart it connects House ${input.fromHouse} (${houseEntry(input.fromHouse)!.tagline.toLowerCase()}) with House ${input.toHouse} (${houseEntry(input.toHouse)!.tagline.toLowerCase()}).`
    : input.fromHouse && input.toHouse && input.fromHouse === input.toHouse
      ? ` Both planets share House ${input.fromHouse} (${houseEntry(input.fromHouse)!.tagline.toLowerCase()}), concentrating this interplay in one arena.`
      : '';

  const orbNote = input.isDateOnly
    ? ` This contact held across the full birth date (orb ${input.orbDeg.toFixed(1)}° or tighter).`
    : ` At ${input.orbDeg.toFixed(2)}° orb (${tightnessPhrase(tier)}), traditional guidance suggests ${aMeta.guidancePhrase}.`;

  const reflection = aEntry.reflection
    ?? `How do ${planetName(input.from)} themes and ${planetName(input.to)} themes interact in your day-to-day choices?`;

  const sourceSet = new Set<SourceId>([...aEntry.sources, ...fEntry.sources, ...tEntry.sources]);
  return {
    symbolismBasis,
    synthesis: `${baseLine}${houseLink}${orbNote}`,
    reflection,
    sources: [...sourceSet],
  };
}

export function composeAngleAspectSynthesis(input: {
  readonly planetId: PlanetId;
  readonly angle: AngleId;
  readonly aspect: AspectId;
  readonly orbDeg: number;
  readonly allowedOrbDeg: number;
}): { readonly symbolismBasis: string; readonly synthesis: string; readonly reflection: string; readonly sources: readonly SourceId[] } {
  const aMeta = aspectMeta(input.aspect);
  const aEntry = aspectEntry(input.aspect)!;
  const bEntry = bodyEntry(input.planetId)!;
  const bMeta = bodyMeta(input.planetId);
  const angEntry = angleEntry(input.angle)!;
  const angleLabel = angEntry.longName ?? angEntry.name;
  const angleDomain = input.angle === 'asc'
    ? 'outward presence, first impressions and personal approach'
    : 'vocation, public standing and visible life direction';
  const tier = tightnessTier(input.orbDeg, input.allowedOrbDeg);

  const symbolismBasis = `${planetName(input.planetId)} (${bEntry.tagline.toLowerCase()}) · ${aEntry.name} (${aMeta.toneLabel.toLowerCase()}) · ${angleLabel}`;
  const synthesis =
    `Natal ${planetName(input.planetId)} forming a ${aEntry.name.toLowerCase()} to your ${angleLabel} (${input.orbDeg.toFixed(2)}° orb, ${tightnessPhrase(tier)}) `
    + `${aMeta.natalDynamic}, weaving ${bMeta.drivePhrase} directly into ${angleDomain}. `
    + `Traditional readings give extra prominence to contacts with the chart angles and suggest ${aMeta.guidancePhrase}.`;
  const reflection = angEntry.reflection ?? bEntry.reflection ?? `How does ${bMeta.focusPhrase} shape your ${angleDomain}?`;

  const sourceSet = new Set<SourceId>([...aEntry.sources, ...bEntry.sources, ...angEntry.sources]);
  return { symbolismBasis, synthesis, reflection, sources: [...sourceSet] };
}
