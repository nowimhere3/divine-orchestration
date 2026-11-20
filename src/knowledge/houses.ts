import type { Entry, SourceId } from './types';

const sources: SourceId[] = ['wiki-house', 'lilly', 'ptolemy', 'britannica-astrology'];

interface HouseSource {
  readonly tagline: string;
  readonly topics: string;
  readonly reading: string;
  readonly reflection: string;
}

const HOUSE_SOURCES: readonly HouseSource[] = [
  { tagline: 'Self and beginnings', topics: 'the self, the body, appearance, first impressions and how a person starts things',
    reading: 'The first house is where the Ascendant sits. Planets here are read as strongly colouring how a person comes across.',
    reflection: 'How do I tend to meet new situations?' },
  { tagline: 'Resources and values', topics: 'money, possessions, earning, and what a person values and feels secure with',
    reading: 'The second house is read as the practical ground of a life: what you own, earn and rely on.',
    reflection: 'What do I truly value, and does my time reflect it?' },
  { tagline: 'Communication and surroundings', topics: 'everyday communication, siblings, neighbours, early schooling and short journeys',
    reading: 'The third house is read as the immediate environment: talking, learning, local contacts and getting around.',
    reflection: 'Who do I talk to most, and what do we talk about?' },
  { tagline: 'Home and roots', topics: 'home, family, ancestry, the private foundations of a life and the endings of things',
    reading: 'The fourth house is read as the base a person returns to: home, family history and inner security.',
    reflection: 'Where do I feel most at home?' },
  { tagline: 'Creativity and pleasure', topics: 'creativity, play, romance, hobbies, children and joy',
    reading: 'The fifth house is read as what a person does for the pleasure of it: creating, playing and loving.',
    reflection: 'What do I do just because I enjoy it?' },
  { tagline: 'Work routines and health', topics: 'daily work, routines, service, health habits and the practical craft of living',
    reading: 'The sixth house is read as the daily grind made useful: habits, duties, skills and looking after the body.',
    reflection: 'Which daily routine supports me, and which drains me?' },
  { tagline: 'Partnerships', topics: 'committed partnerships, marriage, close one-to-one relationships and open rivals',
    reading: 'The seventh house sits opposite the first. It is read as what a person meets in others, and what they look for in a partner.',
    reflection: 'What do I look for in a close partnership?' },
  { tagline: 'Shared resources and change', topics: 'shared money, debts, inheritance, intimacy, loss and transformation',
    reading: 'The eighth house is read as what is shared or merged with others, including money, trust and deep change.',
    reflection: 'What do I find hard to share or let go of?' },
  { tagline: 'Learning and horizons', topics: 'travel, higher learning, philosophy, religion, publishing and a person’s worldview',
    reading: 'The ninth house is read as the search for meaning and the wider world beyond daily life.',
    reflection: 'What belief or subject do I want to understand more deeply?' },
  { tagline: 'Career and public life', topics: 'career, reputation, public standing, authority and life direction',
    reading: 'The tenth house sits at the top of the chart. It is read as what a person is known for and works toward in public.',
    reflection: 'What do I want to be known for?' },
  { tagline: 'Community and hopes', topics: 'friends, groups, networks, causes and a person’s hopes for the future',
    reading: 'The eleventh house is read as belonging to groups and sharing aims with like-minded people.',
    reflection: 'Which communities do I want to be part of?' },
  { tagline: 'Solitude and the unseen', topics: 'solitude, retreat, the unconscious, hidden matters and what lies behind the scenes',
    reading: 'The twelfth house is read as what happens out of public view: rest, privacy, hidden patterns and endings.',
    reflection: 'What do I need time alone to understand?' },
];

const GROUPS = ['angular', 'succedent', 'cadent'] as const;

export const HOUSES: readonly Entry[] = HOUSE_SOURCES.map((house, index): Entry => {
  const number = index + 1;
  const group = GROUPS[index % 3];
  return {
    id: `house/${number}`, kind: 'house', name: `House ${number}`, symbol: String(number), tagline: house.tagline,
    summary: `House ${number} is the ${ordinalWord(number)} of twelve sectors that divide the sky around the birthplace. Where it falls depends on the birth time and place.`,
    facts: [
      'The houses are twelve sectors of the sky as seen from one place on Earth. Unlike signs, they are not always equal slices of the zodiac, and they turn through the zodiac about once a day.',
      'A house needs a birth time and a location. Without them there are no houses, only signs.',
      `House ${number} is numbered counter-clockwise from the Ascendant (house 1), which sits at the left of the wheel.`,
    ],
    symbolism: [
      `Traditional topics: ${house.topics}.`,
      `House ${number} is traditionally called ${group}, and it is linked with the ${ordinalWord(number)} sign of the zodiac in the "natural" order.`,
    ],
    reading: `${house.reading} A planet in a house is read as bringing its own theme to that area of life.`,
    reflection: house.reflection,
    sources,
    see: ['concept/house-systems'],
  };
});

function ordinalWord(n: number) {
  const names = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
  return names[n - 1];
}
