import type { AspectId } from '../domain/aspects';
import type { HouseId, PlanetId } from '../domain/chart';
import {
  angleEntry, aspectEntry, aspectMeta, bodyEntry, bodyMeta, houseEntry, houseMeta, signEntry, signMeta,
} from '../knowledge';
import type { AspectTone, SourceId } from '../knowledge';
import { formatLunarTimestamp } from '../lunar';
import { planetName } from '../view/chart-data';
import { indefiniteArticle } from './copy-natal';
import type {
  TransitBucket,
  TransitHouseSpan,
  TransitMotionState,
  TransitTargetRef,
  TransitWindowEnrichment,
} from './transit-types';

const TRANSIT_PLANET_ACTION: Readonly<Record<PlanetId, string>> = {
  sun: 'brings brief focus and daytime spotlight',
  moon: 'stirs shifting mood, intuition and short-lived emotional tone',
  mercury: 'activates thoughts, conversations, planning and information flow',
  venus: 'highlights appreciation, warmth, social ease and personal values',
  mars: 'energizes initiative, urgency, candour and physical follow-through',
  jupiter: 'widens perspective, confidence and appetite for growth',
  saturn: 'tests structure, patience, accountability and long-term durability',
  uranus: 'introduces restlessness, fresh perspective and disruption of stale routines',
  neptune: 'softens sharp boundaries, inviting imagination, empathy and discernment',
  pluto: 'deepens focus around renewal, honesty and gradual structural change',
};

const TRANSIT_ASPECT_DYNAMICS: Readonly<Record<AspectId, { readonly verb: string; readonly advice: string }>> = {
  conjunction: {
    verb: 'merges directly with',
    advice: 'giving this combined theme clear priority rather than spreading attention thin',
  },
  sextile: {
    verb: 'opens a constructive channel to',
    advice: 'taking small deliberate steps while the opening is active',
  },
  square: {
    verb: 'creates productive friction with',
    advice: 'adjusting priorities or habits rather than pushing blindly against resistance',
  },
  trine: {
    verb: 'flows smoothly alongside',
    advice: 'putting this natural momentum to intentional use rather than letting it pass unnoticed',
  },
  opposition: {
    verb: 'stands directly across from',
    advice: 'seeking perspective and balance between competing pulls, especially through others',
  },
};

/** Curated transit-planet × natal-planet nuances for highest-impact recurring life transits. */
const TRANSIT_PAIR_NUCLEI: Readonly<Record<string, Readonly<Record<AspectTone, string>>>> = {
  'saturn>sun': {
    blend: 'A serious consolidation cycle for identity and purpose—favouring steady commitments and realistic pacing over shortcuts.',
    support: 'Discipline and core direction reinforce each other cleanly, supporting durable progress on long-term goals.',
    tense: 'Outer responsibilities or self-critique test how your goals are built, rewarding patience and clearer boundaries.',
  },
  'saturn>moon': {
    blend: 'Emotional habits meet quiet sobriety and responsibility—inviting grounded self-care and dependable routines.',
    support: 'Composure and practical support steady emotional life, helping you handle obligations calmly.',
    tense: 'Emotional needs and practical duties can feel at odds, asking for honest boundaries and gentler expectations of yourself.',
  },
  'jupiter>sun': {
    blend: 'Confidence, visibility and curiosity expand around core identity—an inviting season to explore wider possibilities.',
    support: 'Optimism and purpose align smoothly, making it easier to learn, share work and widen your horizons.',
    tense: 'Big ambitions can outpace available bandwidth, rewarding thoughtful selectivity alongside enthusiasm.',
  },
  'jupiter>moon': {
    blend: 'Emotional generosity and appetite for comfort grow—highlighting warmth, belonging and supportive spaces.',
    support: 'Mood and perspective lift easily together, favouring restorative connection and open-hearted planning.',
    tense: 'Feelings or commitments can swell quickly, benefiting from grounded pacing rather than over-promising.',
  },
  'uranus>sun': {
    blend: 'An invigorating push toward authenticity and fresh self-expression, questioning routines that have grown too narrow.',
    support: 'Originality and identity cooperate naturally, making thoughtful experimentation feel liberating.',
    tense: 'Restlessness around expectations or fixed roles invites conscious updates before frustration builds.',
  },
  'uranus>moon': {
    blend: 'Emotional rhythms and home routines seek more breathing room and honest independence.',
    support: 'Fresh perspectives help refresh familiar habits without losing your footing.',
    tense: 'Sudden shifts in mood or domestic routine encourage flexibility and clearer personal space.',
  },
  'neptune>sun': {
    blend: 'Imagination, empathy and subtle re-orientation colour your sense of direction—inviting creative reflection alongside clarity checks.',
    support: 'Intuition and conscious purpose blend gently, supporting artistic, compassionate or contemplative focus.',
    tense: 'Goals can feel hazy or idealistic for a while, rewarding patience and grounding decisions in verifiable details.',
  },
  'neptune>moon': {
    blend: 'Sensitivity to mood, memory and atmosphere deepens—making quiet restoration and clear emotional boundaries helpful.',
    support: 'Compassion and intuition flow softly, enriching creative and reflective time.',
    tense: 'Ambiguity in feelings or expectations asks for gentle realism before drawing firm conclusions.',
  },
  'pluto>sun': {
    blend: 'A gradual, deep restructuring of personal priorities—shedding outdated roles in favour of what feels essential.',
    support: 'Resilience and focused determination strengthen steadily, supporting sustained personal renewal.',
    tense: 'Control, ambition or unspoken pressure come into sharper relief, inviting honest re-examination of what truly matters.',
  },
  'pluto>moon': {
    blend: 'Deep emotional patterns surface for honest reflection and gradual renewal.',
    support: 'Emotional candour and inner steadiness support meaningful, lasting shifts in habits or attachments.',
    tense: 'Intense feelings or attachment dynamics invite patience, perspective and constructive release of old tension.',
  },
  'mars>sun': {
    blend: 'Energy and initiative concentrate directly on personal aims—useful for decisive action when directed intentionally.',
    support: 'Vitality and momentum align cleanly, helping you tackle active priorities efficiently.',
    tense: 'Impatience or friction can flare around goals, rewarding focused physical or practical outlets.',
  },
  'mars>moon': {
    blend: 'Feelings and impulse move quickly together—encouraging candid expression tempered by brief pauses.',
    support: 'Protective energy and instinct cooperate cleanly, helping you act on behalf of what you care about.',
    tense: 'Emotional heat or irritability can spike briefly, easing quickly once channelled into constructive movement.',
  },
};

function motionClause(motion: TransitMotionState, retrograde: boolean, bucket: TransitBucket): string {
  const retroTag = retrograde ? ' while moving retrograde (inviting review and revisiting)' : '';
  switch (motion) {
    case 'exact':
      return `This contact is at its exact peak right now${retroTag}.`;
    case 'stationary':
      return `The transiting planet is nearly stationary inside orb, prolonging emphasis around this turning point.`;
    case 'applying':
      return bucket === 'lunar-brief'
        ? 'The contact is applying, building over the next few hours toward its brief peak.'
        : `The contact is applying (tightening toward exact)${retroTag}, so its themes are building in focus.`;
    case 'separating':
      return bucket === 'lunar-brief'
        ? 'The contact is separating, fading over the next few hours.'
        : `The contact is separating (widening past exact)${retroTag}, shifting emphasis toward integrating what surfaced.`;
  }
}

function passContextClause(enrichment: TransitWindowEnrichment | null, displayZone: string): string {
  if (!enrichment || !enrichment.passes.length) return '';
  const exactPasses = enrichment.passes.filter(p => p.state !== 'near-miss');
  const clipped = enrichment.clippedStart || enrichment.clippedEnd;
  if (exactPasses.length > 1) {
    const formatted = exactPasses.map(p =>
      `${formatLunarTimestamp(p.epochMs, displayZone)}${p.retrograde ? ' (℞)' : ''}`,
    ).join('; ');
    return clipped
      ? ` At least ${exactPasses.length} exact contacts occur inside the current search window (${formatted}); this transit series extends beyond the search horizon.`
      : ` Retrograde motion creates a ${exactPasses.length}-pass series with exact contacts on ${formatted}.`;
  }
  if (exactPasses.length === 1) {
    const p = exactPasses[0];
    return clipped
      ? ` An exact contact occurs on ${formatLunarTimestamp(p.epochMs, displayZone)}${p.retrograde ? ' (℞ pass)' : ''} inside a transit series that extends beyond the current search horizon.`
      : ` Exact contact occurs on ${formatLunarTimestamp(p.epochMs, displayZone)}${p.retrograde ? ' (℞ pass)' : ''}.`;
  }
  const near = enrichment.passes[0];
  if (near?.state === 'near-miss') {
    return ` The planet stations inside orb as a near miss (${near.residualDeg !== null ? `${near.residualDeg.toFixed(2)}°` : 'short'} of exact) on ${formatLunarTimestamp(near.epochMs, displayZone)} without reaching an exact hit.`;
  }
  return '';
}

export function composeTransitAspectSynthesis(input: {
  readonly transitId: PlanetId;
  readonly target: TransitTargetRef;
  readonly aspect: AspectId;
  readonly motion: TransitMotionState;
  readonly bucket: TransitBucket;
  readonly retrograde: boolean;
  readonly orbDeg: number;
  readonly transitHouse: HouseId | null;
  readonly targetHouse: HouseId | null;
  readonly enrichment: TransitWindowEnrichment | null;
  readonly displayZone: string;
  readonly approximateDateOnly?: boolean;
}): { readonly symbolismBasis: string; readonly synthesis: string; readonly reflection: string; readonly sources: readonly SourceId[] } {
  const tEntry = bodyEntry(input.transitId)!;
  const aEntry = aspectEntry(input.aspect)!;
  const aMeta = aspectMeta(input.aspect);
  const dyn = TRANSIT_ASPECT_DYNAMICS[input.aspect];
  const tName = planetName(input.transitId);

  let targetName: string;
  let targetTagline: string;
  let targetDrive: string;
  let targetSources: readonly SourceId[];

  if (input.target.kind === 'angle') {
    const ang = angleEntry(input.target.angle)!;
    targetName = `natal ${ang.longName ?? ang.name}`;
    targetTagline = ang.tagline.toLowerCase();
    targetDrive = input.target.angle === 'asc'
      ? 'outward presence, first impressions and personal approach'
      : 'vocation, public standing and visible life direction';
    targetSources = ang.sources;
  } else {
    const nEntry = bodyEntry(input.target.planetId)!;
    const nMeta = bodyMeta(input.target.planetId);
    targetName = `natal ${planetName(input.target.planetId)}`;
    targetTagline = nEntry.tagline.toLowerCase();
    targetDrive = nMeta.drivePhrase;
    targetSources = nEntry.sources;
  }

  const symbolismBasis = `Transit ${tName} (${tEntry.tagline.toLowerCase()}) · ${aEntry.name} (${aMeta.toneLabel.toLowerCase()}) · ${targetName[0].toUpperCase()}${targetName.slice(1)} (${targetTagline})`;

  const pairLookup = input.target.kind === 'planet' ? `${input.transitId}>${input.target.planetId}` : '';
  const nucleus = pairLookup ? TRANSIT_PAIR_NUCLEI[pairLookup]?.[aMeta.tone] : undefined;

  const coreLine = nucleus
    ?? `Transiting ${tName} ${TRANSIT_PLANET_ACTION[input.transitId]} and ${dyn.verb} your ${targetName}, touching ${targetDrive}.`;

  const houseParts: string[] = [];
  if (input.transitHouse) {
    houseParts.push(`House ${input.transitHouse} (${houseEntry(input.transitHouse)!.tagline.toLowerCase()})`);
  }
  if (input.targetHouse && input.targetHouse !== input.transitHouse) {
    houseParts.push(`House ${input.targetHouse} (${houseEntry(input.targetHouse)!.tagline.toLowerCase()})`);
  }
  const houseClause = houseParts.length === 2
    ? ` In your chart this bridges ${houseParts[0]} and ${houseParts[1]}.`
    : houseParts.length === 1
      ? ` This activity plays out through ${houseParts[0]}.`
      : '';

  const motionText = input.approximateDateOnly
    ? ' Because birth time is unknown, orb tightness and exact pass timing remain approximate across the birth date.'
    : ` ${motionClause(input.motion, input.retrograde, input.bucket)}`;

  const passText = input.approximateDateOnly ? '' : passContextClause(input.enrichment, input.displayZone);
  const adviceLine = ` Traditional timing guidance suggests ${dyn.advice}.`;

  const reflection = input.target.kind === 'angle'
    ? (angleEntry(input.target.angle)?.reflection ?? `How can you respond constructively as ${tName} themes meet your ${targetName}?`)
    : `Where in ${targetDrive} would ${dyn.advice} serve you best right now?`;

  const sources = new Set<SourceId>([...tEntry.sources, ...aEntry.sources, ...targetSources, 'wiki-horoscope']);
  return {
    symbolismBasis,
    synthesis: `${coreLine}${houseClause}${motionText}${passText}${adviceLine}`,
    reflection,
    sources: [...sources],
  };
}

export function composeTransitHouseSynthesis(input: {
  readonly planetId: PlanetId;
  readonly houseNumber: HouseId;
  readonly signIndex: number;
  readonly retrograde: boolean;
  readonly span: TransitHouseSpan | null;
  readonly displayZone: string;
}): { readonly symbolismBasis: string; readonly synthesis: string; readonly sources: readonly SourceId[] } {
  const bEntry = bodyEntry(input.planetId)!;
  const hMeta = houseMeta(input.houseNumber);
  const hEntry = houseEntry(input.houseNumber)!;
  const sMeta = signMeta(input.signIndex);
  const name = planetName(input.planetId);

  const symbolismBasis = `Transit ${name} (${bEntry.tagline.toLowerCase()}) in ${sMeta.name} · Natal House ${hMeta.number} (${hEntry.tagline.toLowerCase()}, ${hMeta.group})`;
  const retroNote = input.retrograde
    ? ' Because it is currently retrograde, emphasis leans toward reviewing, refining or revisiting matters already underway here.'
    : '';

  let spanNote = '';
  if (input.span) {
    const enterText = input.span.enteredAtEpochMs !== null
      ? formatLunarTimestamp(input.span.enteredAtEpochMs, input.displayZone)
      : null;
    const exitText = input.span.exitsAtEpochMs !== null
      ? formatLunarTimestamp(input.span.exitsAtEpochMs, input.displayZone)
      : null;
    if (enterText && exitText) {
      spanNote = ` Current stay runs from ${enterText} until ${exitText}${input.span.includesRetrogradeReentry ? ' (involving a retrograde cusp crossing)' : ''}.`;
    } else if (enterText) {
      spanNote = ` Entered this house on ${enterText} and remains here beyond the current search window.`;
    } else if (exitText) {
      spanNote = ` Continues here until ${exitText}.`;
    }
  }

  const synthesis =
    `Transiting ${name} moving through natal House ${hMeta.number} in ${indefiniteArticle(`${sMeta.stylePhrase} ${sMeta.name} tone`)} `
    + `${TRANSIT_PLANET_ACTION[input.planetId]} around ${hMeta.arenaPhrase}.${retroNote}${spanNote}`;

  const sources = new Set<SourceId>([...bEntry.sources, ...hEntry.sources, ...signEntry(input.signIndex)!.sources, 'wiki-horoscope']);
  return { symbolismBasis, synthesis, sources: [...sources] };
}
