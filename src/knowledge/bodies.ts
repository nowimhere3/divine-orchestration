import type { Entry, SourceId } from './types';

/** The ten chart bodies, keyed by the same ids as the calculation layer. */
const lights: SourceId[] = ['wiki-planets-astrology', 'ptolemy', 'wiki-symbols'];
const planets: SourceId[] = ['nasa-planets', 'wiki-planets-astrology', 'ptolemy', 'wiki-symbols'];
const retro = ['concept/retrograde'];

export const BODIES: Readonly<Record<string, Entry>> = {
  sun: {
    id: 'body/sun', kind: 'body', name: 'Sun', symbol: '☉', tagline: 'Core identity and vitality',
    summary: 'The Sun is the star at the centre of the solar system. On the wheel it marks where the Sun sits along the zodiac at the chosen moment.',
    facts: [
      'The Sun is a star, not a planet. Astrology calls it a "luminary" (a light-giver) and counts it among the chart’s bodies by tradition.',
      'Seen from Earth it appears to travel once around the zodiac each year, about 1° a day.',
      'It never appears to move backwards, so the Sun is never retrograde.',
    ],
    symbolism: [
      'Traditionally linked with identity, purpose, vitality and the conscious will.',
      'Paired with the Moon as one of the two "lights"; the Sun is often read as the centre of gravity of a chart.',
    ],
    reading: 'Look at the Sun’s sign for the style of self-expression the tradition emphasises, and at its house for the area of life where that expression is said to show most.',
    reflection: 'Where do I feel most like myself?',
    sources: lights,
  },
  moon: {
    id: 'body/moon', kind: 'body', name: 'Moon', symbol: '☽', tagline: 'Emotions, habits and needs',
    summary: 'The Moon is Earth’s natural satellite. It is the fastest-moving body on the wheel, so its position changes noticeably within a few hours.',
    facts: [
      'The Moon orbits Earth in about 27.3 days and crosses roughly 12–15° of the zodiac each day.',
      'Its phases repeat about every 29.5 days.',
      'It never appears to move backwards, so the Moon is never retrograde.',
    ],
    symbolism: [
      'Traditionally linked with feelings, instinctive reactions, habits, comfort and memory.',
      'The second "luminary", associated with the body’s rhythms and with what feels nourishing or familiar.',
    ],
    reading: 'Read the Moon’s sign for the emotional tone the tradition associates with it, and its house for where those needs are said to be most felt. Because it moves quickly, an uncertain birth time matters most here.',
    reflection: 'What helps me feel settled?',
    sources: [...lights, 'usno-phases', 'meeus-algorithms'],
    see: ['concept/moon-phases', 'concept/lunar-parallax'],
  },
  mercury: {
    id: 'body/mercury', kind: 'body', name: 'Mercury', symbol: '☿', tagline: 'Thinking and communication',
    summary: 'Mercury is the smallest planet and the closest to the Sun, so it is always near the Sun in the sky and in a chart.',
    facts: [
      'Mercury orbits the Sun in about 88 days.',
      'It never appears more than about 28° from the Sun, so it sits in the same sign as the Sun or a neighbouring one.',
      'It appears to move backwards three or four times a year, for about three weeks each time.',
    ],
    symbolism: [
      'Traditionally linked with thought, speech, writing, learning, curiosity, trade and short journeys.',
      'Named for the messenger god, which is why it stands for exchange of information.',
    ],
    reading: 'Mercury’s sign is read as a style of thinking and talking, and its house as the area of life where ideas and conversations are most active.',
    reflection: 'How do I naturally explain things to others?',
    sources: planets, see: retro,
  },
  venus: {
    id: 'body/venus', kind: 'body', name: 'Venus', symbol: '♀', tagline: 'Affection, values and attraction',
    summary: 'Venus is the brightest planet in the night sky and, like Mercury, stays within a limited distance of the Sun.',
    facts: [
      'Venus orbits the Sun in about 225 days.',
      'It never appears more than about 47° from the Sun.',
      'It appears to move backwards about every 19 months, for roughly six weeks.',
    ],
    symbolism: [
      'Traditionally linked with affection, attraction, pleasure, beauty, harmony and what a person values.',
      'Associated with how people relate warmly to one another and what they find worth cherishing.',
    ],
    reading: 'Venus’s sign is read as a style of caring and liking, and its house as the area of life where appreciation and closeness are most emphasised.',
    reflection: 'What do I find beautiful or worth cherishing?',
    sources: planets, see: retro,
  },
  mars: {
    id: 'body/mars', kind: 'body', name: 'Mars', symbol: '♂', tagline: 'Drive, action and courage',
    summary: 'Mars is the red planet, the next planet out from Earth. Its slow, wide orbit makes it spend about two months in each sign.',
    facts: [
      'Mars orbits the Sun in about 687 days (1.9 years).',
      'Its red colour comes from iron oxide, rusty dust on its surface.',
      'It appears to move backwards about every 26 months, for roughly two and a half months.',
    ],
    symbolism: [
      'Traditionally linked with energy, desire, assertion, competition, courage and conflict.',
      'The planet of "going after" something, and of how anger and ambition are expressed.',
    ],
    reading: 'Mars’s sign is read as the manner of taking action, and its house as the area of life where effort and drive are most directed.',
    reflection: 'What do I act on without having to be persuaded?',
    sources: planets, see: retro,
  },
  jupiter: {
    id: 'body/jupiter', kind: 'body', name: 'Jupiter', symbol: '♃', tagline: 'Growth, optimism and meaning',
    summary: 'Jupiter is the largest planet. It takes about a year to cross one sign, so it changes sign slowly.',
    facts: [
      'Jupiter orbits the Sun in about 11.9 years.',
      'It is more than twice as massive as all the other planets combined.',
      'It appears to move backwards for about four months each year.',
    ],
    symbolism: [
      'Traditionally linked with expansion, generosity, optimism, belief, learning and good fortune.',
      'Classically called the "greater benefic", the planet associated with abundance and growth.',
    ],
    reading: 'Jupiter’s sign is read as a style of growth and enthusiasm, and its house as the area of life where opportunity and meaning are traditionally sought.',
    reflection: 'What am I hopeful about, and what would help it grow?',
    sources: planets, see: retro,
  },
  saturn: {
    id: 'body/saturn', kind: 'body', name: 'Saturn', symbol: '♄', tagline: 'Structure and responsibility',
    summary: 'Saturn is the ringed planet and the outermost of the planets known to the ancients. It spends two and a half years or so in each sign.',
    facts: [
      'Saturn orbits the Sun in about 29.5 years.',
      'It appears to move backwards for about four and a half months each year.',
      'It is the farthest planet visible to the naked eye.',
    ],
    symbolism: [
      'Traditionally linked with boundaries, time, discipline, duty, patience and maturity.',
      'Classically called the "greater malefic" for its association with limits and delay; modern writers more often stress structure and earned mastery.',
    ],
    reading: 'Saturn’s sign is read as where a person tends to be careful or self-demanding, and its house as the area of life where responsibility is said to be felt most.',
    reflection: 'What am I building, and what does it need to last?',
    sources: planets, see: retro,
  },
  uranus: {
    id: 'body/uranus', kind: 'body', name: 'Uranus', symbol: '♅', tagline: 'Change, surprise and independence',
    summary: 'Uranus is a faint, distant planet that was not known until 1781, when it was found with a telescope. It stays about seven years in each sign.',
    facts: [
      'Uranus orbits the Sun in about 84 years.',
      'It was discovered by William Herschel in 1781, the first planet found with a telescope.',
      'It rotates tilted almost on its side.',
    ],
    symbolism: [
      'Traditionally linked with sudden change, innovation, independence, rebellion and the unexpected.',
      'One of the "outer" or modern planets, so its meanings were assigned after its discovery, by later astrologers.',
    ],
    reading: 'Because Uranus changes sign so slowly, its sign usually describes a whole generation; its house and its aspects are where it becomes personal.',
    reflection: 'Where would a fresh approach or more freedom help?',
    sources: planets, see: retro,
  },
  neptune: {
    id: 'body/neptune', kind: 'body', name: 'Neptune', symbol: '♆', tagline: 'Imagination, ideals and dissolving boundaries',
    summary: 'Neptune is the most distant major planet. It was found in 1846 after its position was predicted by calculation, and stays about 14 years in each sign.',
    facts: [
      'Neptune orbits the Sun in about 165 years.',
      'Its existence was predicted from irregularities in Uranus’s orbit before it was observed.',
      'It is too faint to see without a telescope.',
    ],
    symbolism: [
      'Traditionally linked with imagination, spirituality, compassion, dreams, illusion and ambiguity.',
      'Another "outer" planet whose meanings come from modern astrology.',
    ],
    reading: 'Neptune’s sign usually describes a generation’s ideals; its house and aspects show where its themes of longing, vagueness or compassion are traditionally placed.',
    reflection: 'What do I long for, and what is actually in front of me?',
    sources: planets, see: retro,
  },
  pluto: {
    id: 'body/pluto', kind: 'body', name: 'Pluto', symbol: '♇', tagline: 'Transformation and deep change',
    summary: 'Pluto is a small, distant world found in 1930. It has been classed as a dwarf planet since 2006, but astrology still reads it as part of the chart.',
    facts: [
      'Pluto orbits the Sun in about 248 years, on an elongated path, so the time it spends in a sign varies from about 12 to 31 years.',
      'It was discovered by Clyde Tombaugh in 1930.',
      'In 2006 the International Astronomical Union classified it as a dwarf planet.',
    ],
    symbolism: [
      'Traditionally linked with transformation, power, endings and renewal, and with what is hidden or buried.',
      'An "outer" planet whose meanings were assigned after its discovery.',
    ],
    reading: 'Pluto’s sign describes a generation; its house and aspects are where its themes of deep change are traditionally said to become personal.',
    reflection: 'What am I ready to let go of?',
    sources: [...planets, 'iau-2006'], see: retro,
  },
};
