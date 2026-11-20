import type { Entry, SourceId } from './types';

const sources = (...extra: SourceId[]): SourceId[] => ['wiki-house', 'ptolemy', 'britannica-astrology', ...extra];

/** The two chart angles drawn on the wheel. */
export const ANGLES: Readonly<Record<string, Entry>> = {
  asc: {
    id: 'angle/asc', kind: 'angle', name: 'ASC', longName: 'Ascendant', symbol: 'ASC', tagline: 'Ascendant',
    summary: 'The Ascendant (ASC, or "rising sign") is the point of the zodiac that was rising over the eastern horizon at the birthplace at the moment of birth.',
    facts: [
      'It is the ecliptic point crossing the eastern horizon at the birth time and place, so it needs both.',
      'The Ascendant moves through the whole zodiac in a day, changing sign roughly every two hours. A few minutes of birth time can move it by several degrees.',
      'The point directly opposite it, on the western horizon, is the Descendant.',
    ],
    symbolism: [
      'Traditionally linked with outward manner, first impressions and the "lens" through which a person approaches the world.',
      'The Ascendant starts the first house, so it begins the whole house pattern of the chart.',
    ],
    reading: 'Read the Ascendant’s sign as a style of meeting the world. It is often said to be what others notice first, which is a tradition rather than a measurement.',
    reflection: 'How do other people tend to describe my first impression?',
    sources: sources('wiki-ascendant'), see: ['concept/house-systems'],
  },
  mc: {
    id: 'angle/mc', kind: 'angle', name: 'MC', longName: 'Midheaven', symbol: 'MC', tagline: 'Midheaven',
    summary: 'The Midheaven (MC, from the Latin Medium Coeli, "middle of the sky") is the point of the zodiac at the top of the sky, crossing the local meridian at the moment of birth.',
    facts: [
      'It is the ecliptic point on the local meridian, the great circle that runs overhead from north to south, so it also needs both birth time and place.',
      'It is where the zodiac crosses the meridian above the horizon. That is not the same as the point straight overhead (the zenith).',
      'The point directly opposite it, below the ground, is the Imum Coeli (IC).',
    ],
    symbolism: [
      'Traditionally linked with public life, vocation, reputation and the direction a person is working toward.',
      'It marks the top of the chart, and is closely tied to the tenth house.',
    ],
    reading: 'Read the Midheaven’s sign as a style of public life and aspiration. In some house systems it is the start of the tenth house; in Whole Sign it is simply a point inside one of the houses.',
    reflection: 'What kind of recognition or contribution do I care about?',
    sources: sources('wiki-midheaven'), see: ['concept/house-systems'],
  },
};
