import type { Entry, SourceId } from './types';

const sources: SourceId[] = ['wiki-sign', 'wiki-tropical', 'wiki-triplicity', 'ptolemy', 'wiki-symbols'];
const ELEMENTS = ['Fire', 'Earth', 'Air', 'Water'] as const;
const MODES = ['Cardinal', 'Fixed', 'Mutable'] as const;

interface SignSource {
  readonly name: string;
  readonly symbol: string;
  readonly sun: string;
  readonly ruler: string;
  readonly keywords: string;
  readonly reading: string;
  readonly reflection: string;
}

const SIGN_SOURCES: readonly SignSource[] = [
  { name: 'Aries', symbol: '♈', sun: 'around March 20 to April 19', ruler: 'Mars',
    keywords: 'initiative, directness, courage and starting things',
    reading: 'Aries is the first sign of the zodiac, so it is read as a beginning: an impulse to act first and refine later.',
    reflection: 'What do I want to begin, and what is stopping me?' },
  { name: 'Taurus', symbol: '♉', sun: 'around April 20 to May 20', ruler: 'Venus',
    keywords: 'steadiness, the senses, patience and material security',
    reading: 'Taurus is read as a preference for what is steady, tangible and reliable, and a reluctance to be hurried.',
    reflection: 'What makes me feel secure, and what do I hold on to?' },
  { name: 'Gemini', symbol: '♊', sun: 'around May 21 to June 20', ruler: 'Mercury',
    keywords: 'curiosity, variety, conversation and exchange of ideas',
    reading: 'Gemini is read as a restless, curious style that connects things and likes variety.',
    reflection: 'What am I curious about right now?' },
  { name: 'Cancer', symbol: '♋', sun: 'around June 21 to July 22', ruler: 'the Moon',
    keywords: 'protection, belonging, feeling and caring for others',
    reading: 'Cancer is read as a protective, feeling-led style that cares about home, family and belonging.',
    reflection: 'Who or what do I feel responsible for protecting?' },
  { name: 'Leo', symbol: '♌', sun: 'around July 23 to August 22', ruler: 'the Sun',
    keywords: 'creative self-expression, warmth, generosity and recognition',
    reading: 'Leo is read as a wish to express oneself openly and to be seen and appreciated for it.',
    reflection: 'How do I like to express myself creatively?' },
  { name: 'Virgo', symbol: '♍', sun: 'around August 23 to September 22', ruler: 'Mercury',
    keywords: 'refinement, service, practical detail and improvement',
    reading: 'Virgo is read as a careful, practical style that notices detail and wants things to work well.',
    reflection: 'What small improvement would make daily life easier?' },
  { name: 'Libra', symbol: '♎', sun: 'around September 23 to October 22', ruler: 'Venus',
    keywords: 'balance, fairness, partnership and harmony',
    reading: 'Libra is read as an instinct to weigh both sides and to look for balance in relationships.',
    reflection: 'Where do I need more balance between my needs and others’?' },
  { name: 'Scorpio', symbol: '♏', sun: 'around October 23 to November 21', ruler: 'Mars (and, in modern astrology, Pluto)',
    keywords: 'intensity, depth, privacy and transformation',
    reading: 'Scorpio is read as an intense, private style that looks beneath the surface and does not like half-measures.',
    reflection: 'What am I keeping private, and why?' },
  { name: 'Sagittarius', symbol: '♐', sun: 'around November 22 to December 21', ruler: 'Jupiter',
    keywords: 'exploration, belief, freedom and the big picture',
    reading: 'Sagittarius is read as an expansive, searching style that wants meaning, travel and room to roam.',
    reflection: 'What would I explore if I had the time?' },
  { name: 'Capricorn', symbol: '♑', sun: 'around December 22 to January 19', ruler: 'Saturn',
    keywords: 'ambition, structure, endurance and practical achievement',
    reading: 'Capricorn is read as a disciplined, long-view style that builds step by step toward a goal.',
    reflection: 'What long-term goal am I willing to work toward?' },
  { name: 'Aquarius', symbol: '♒', sun: 'around January 20 to February 18', ruler: 'Saturn (and, in modern astrology, Uranus)',
    keywords: 'independence, ideals, community and innovation',
    reading: 'Aquarius is read as an independent, idea-led style that cares about the group and about doing things differently.',
    reflection: 'Where do I want to think for myself?' },
  { name: 'Pisces', symbol: '♓', sun: 'around February 19 to March 19', ruler: 'Jupiter (and, in modern astrology, Neptune)',
    keywords: 'empathy, imagination, intuition and dissolving boundaries',
    reading: 'Pisces is read as a porous, imaginative style that picks up on mood and wants to merge or retreat.',
    reflection: 'What do I sense that I have not yet put into words?' },
];

export const SIGNS: readonly Entry[] = SIGN_SOURCES.map((sign, index): Entry => {
  const element = ELEMENTS[index % 4];
  const mode = MODES[index % 3];
  const start = index * 30;
  return {
    id: `sign/${index}`, kind: 'sign', name: sign.name, symbol: sign.symbol,
    tagline: `${mode} ${element} sign`,
    summary: `${sign.name} is the ${ordinal(index + 1)} of the twelve zodiac signs. A sign is a 30° slice of the zodiac, which is the band of sky the Sun, Moon and planets appear to travel through.`,
    facts: [
      `${sign.name} covers ecliptic longitude ${start}° to ${start + 30}°, measured from the March equinox. This is the tropical zodiac used on this wheel.`,
      `The Sun is in ${sign.name} ${sign.sun}. The dates move by about a day from year to year.`,
      'Tropical signs are named after constellations but are no longer aligned with them, because the equinox slowly drifts against the stars (precession).',
    ],
    symbolism: [
      `Classified as a ${mode.toLowerCase()} ${element.toLowerCase()} sign. The four elements and three modes are a traditional way of grouping the signs, not a measured property.`,
      `Traditional ruler: ${sign.ruler}. Keywords the tradition attaches to ${sign.name}: ${sign.keywords}.`,
    ],
    reading: `${sign.reading} Remember a sign colours how a planet or house expresses itself; it is one layer of a chart, not a verdict.`,
    reflection: sign.reflection,
    sources,
    see: ['concept/degrees'],
  };
});

function ordinal(n: number) {
  const names = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
  return names[n - 1];
}
