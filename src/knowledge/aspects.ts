import type { Entry, SourceId } from './types';

const sources: SourceId[] = ['wiki-aspect', 'ptolemy', 'britannica-astrology', 'wiki-symbols'];

/** The five major aspects, keyed by the ids the calculation layer uses. */
export const ASPECTS: Readonly<Record<string, Entry>> = {
  conjunction: {
    id: 'aspect/conjunction', kind: 'aspect', name: 'Conjunction', symbol: '☌', tagline: '0° relationship',
    summary: 'A conjunction is when two bodies sit at (nearly) the same place in the zodiac, so they appear together.',
    facts: [
      'The two bodies have almost the same ecliptic longitude, an angle of 0° between them.',
      'It is a statement about position along the zodiac. The bodies can still be far apart in space and in height above or below the ecliptic.',
    ],
    symbolism: [
      'Traditionally read as a blending: the two themes act together and strengthen one another.',
      'Whether that feels easy or awkward is said to depend on the bodies involved, which is why it is called neutral in tone.',
    ],
    reading: 'Treat the pair as one combined influence rather than two separate ones. The closer the angle is to exact, the stronger the tradition says the blend is.',
    reflection: 'Which two themes in my life tend to show up together?',
    sources, see: ['concept/orb'],
  },
  sextile: {
    id: 'aspect/sextile', kind: 'aspect', name: 'Sextile', symbol: '⚹', tagline: '60° relationship',
    summary: 'A sextile is when two bodies are about one sixth of the circle apart, which is two signs.',
    facts: [
      'The angle between the two bodies is about 60°, a sixth of the 360° circle.',
      'Bodies in a sextile are usually in signs of compatible elements (fire with air, earth with water).',
    ],
    symbolism: [
      'Traditionally read as supportive: a friendly link that offers opportunities.',
      'The tradition says it tends to need a little effort to use, unlike the more automatic trine.',
    ],
    reading: 'Read a sextile as a possible cooperation between two themes, a connection that is available if you choose to use it.',
    reflection: 'What easy opportunity have I not yet taken up?',
    sources, see: ['concept/orb'],
  },
  square: {
    id: 'aspect/square', kind: 'aspect', name: 'Square', symbol: '□', tagline: '90° relationship',
    summary: 'A square is when two bodies are about a quarter of the circle apart, which is three signs.',
    facts: [
      'The angle between the two bodies is about 90°, a quarter of the circle.',
      'Bodies in a square are usually in signs of the same mode (cardinal, fixed or mutable) but different elements.',
    ],
    symbolism: [
      'Traditionally read as tension or friction: two themes that pull in different directions.',
      'Many astrologers also say squares drive action, because the friction asks to be worked through.',
    ],
    reading: 'Read a square as a point of friction that can be a source of motivation. It is not a verdict that things will go badly.',
    reflection: 'Which two parts of me want different things?',
    sources, see: ['concept/orb'],
  },
  trine: {
    id: 'aspect/trine', kind: 'aspect', name: 'Trine', symbol: '△', tagline: '120° relationship',
    summary: 'A trine is when two bodies are about a third of the circle apart, which is four signs.',
    facts: [
      'The angle between the two bodies is about 120°, a third of the circle.',
      'Bodies in a trine are usually in signs of the same element (all fire, all earth, all air or all water).',
    ],
    symbolism: [
      'Traditionally read as harmonious: two themes that flow together with little effort.',
      'The tradition adds that ease can be taken for granted, so a trine is often read as a talent that benefits from being used.',
    ],
    reading: 'Read a trine as a natural flow between two themes. It marks something that comes easily, not a guarantee.',
    reflection: 'What comes naturally to me that I could use more deliberately?',
    sources, see: ['concept/orb'],
  },
  opposition: {
    id: 'aspect/opposition', kind: 'aspect', name: 'Opposition', symbol: '☍', tagline: '180° relationship',
    summary: 'An opposition is when two bodies are on opposite sides of the circle, six signs apart.',
    facts: [
      'The angle between the two bodies is about 180°, half the circle.',
      'Bodies in an opposition are in opposite signs, which share a mode and are paired as fire with air or earth with water.',
    ],
    symbolism: [
      'Traditionally read as tension of a polarity: two themes that face each other and need balancing.',
      'It is often described as the most "aware" aspect, because each side is easy to see in the other.',
    ],
    reading: 'Read an opposition as a see-saw between two themes. The usual advice is to look for balance rather than choosing one side.',
    reflection: 'Where do I swing between two extremes?',
    sources, see: ['concept/orb'],
  },
};
