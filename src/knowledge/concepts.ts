import type { Entry } from './types';

/** Ideas that appear throughout the app: retrograde, orb, degrees, natal charts, transits and house systems. */
export const CONCEPTS: Readonly<Record<string, Entry>> = {
  retrograde: {
    id: 'concept/retrograde', kind: 'concept', name: 'Retrograde', symbol: '℞', tagline: 'Apparent backward motion',
    summary: 'A planet is retrograde when, seen from Earth, it seems to move backwards through the zodiac for a while.',
    facts: [
      'It is an appearance caused by the changing viewpoint of Earth, much as a slower car seems to drift backwards when you overtake it. The planet is not actually reversing.',
      'Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune and Pluto all do this on a regular schedule. The Sun and Moon never do.',
      'In this app a body is marked retrograde when its calculated speed along the zodiac is negative.',
    ],
    symbolism: [
      'Traditionally read as a turning inward or a time to review, revisit and redo, rather than to push ahead.',
      'Popular astrology often attaches warnings to Mercury retrograde in particular. That is a modern folk tradition, not something the astronomy implies.',
    ],
    reading: 'Treat the ℞ symbol as a note that the body is in its backward-looking phase. It changes how astrologers describe the planet’s themes, not whether it is "good" or "bad".',
    reflection: 'What would it mean to revisit something instead of pushing forward?',
    sources: ['wiki-retrograde', 'nasa-planets', 'wiki-planets-astrology'],
  },
  orb: {
    id: 'concept/orb', kind: 'concept', name: 'Orb', tagline: 'How close to exact',
    summary: 'An orb is how far a pair of bodies can be from an exact aspect angle and still count as that aspect.',
    facts: [
      'If two bodies are 123° apart, a trine (120°) has an orb of 3°. A smaller orb means a closer, more exact aspect.',
      'The allowed orb is a convention. Different astrologers and software use different values, and this app uses its own defaults, shown in each aspect’s details.',
      'Orbs are measured in degrees of ecliptic longitude.',
    ],
    symbolism: [
      'Tradition says an aspect is stronger the closer it is to exact, and fades toward the edge of its orb.',
      'Some astrologers allow wider orbs when the Sun or Moon is involved.',
    ],
    reading: 'Use the orb as a measure of how tight a connection is. The orb meter in the Inspector fills as an aspect gets closer to exact.',
    sources: ['wiki-aspect', 'britannica-astrology'],
  },
  degrees: {
    id: 'concept/degrees', kind: 'concept', name: 'Degrees', tagline: 'Reading positions like 10°22′ Capricorn',
    summary: 'Positions on the wheel are written as degrees and minutes within a sign. "10°22′ Capricorn" means 10 degrees and 22 minutes past the start of Capricorn.',
    facts: [
      'The zodiac is a circle of 360°. Each sign is a 30° arc, so every position is a number from 0° up to 30° within a sign.',
      'A degree is divided into 60 arcminutes (′). 10°22′ is a little over ten and a third degrees.',
      'The full position can also be given as ecliptic longitude, counted from 0° at the March equinox (the start of Aries) up to 360°.',
    ],
    symbolism: [
      'Astrologers pay attention to a planet that is very early or very late in a sign (near 0° or 29°), and to exact degrees shared by two bodies. Those are traditions, not measurements.',
    ],
    reading: 'The sign tells you which 30° slice a body is in; the degrees tell you how far through it. To compare two bodies, subtract their longitudes.',
    sources: ['wiki-ecliptic', 'wiki-tropical'],
  },
  'natal-chart': {
    id: 'concept/natal-chart', kind: 'concept', name: 'Natal chart', tagline: 'The sky at the moment of birth',
    summary: 'A natal chart is a diagram of where the Sun, Moon and planets were in the zodiac, and which houses and angles applied, at a person’s time and place of birth.',
    facts: [
      'Its planetary positions depend only on the moment of birth. The houses and angles also depend on the birth place and the local time.',
      'Without a birth time, the signs of most bodies are still known but houses, angles and the Moon’s exact position are not reliable.',
      'The chart is a calculated map of the sky, not a record of anything that happened to the person.',
    ],
    symbolism: [
      'Astrologers treat the natal chart as a symbolic portrait of a person’s themes, traditionally called a horoscope.',
      'Nothing here is a prediction or a diagnosis. Interpretation is a reflective tradition.',
    ],
    reading: 'On this wheel the natal chart is the inner ring of lilac glyphs. Use it as the fixed reference that later sky positions are compared to.',
    reflection: 'Which themes in my chart do I recognise, and which do not feel like me?',
    sources: ['wiki-horoscope', 'britannica-astrology'], see: ['concept/transits'],
  },
  transits: {
    id: 'concept/transits', kind: 'concept', name: 'Transits', tagline: 'Today’s sky against your natal chart',
    summary: 'Transits are the current positions of the planets, compared with the positions in a natal chart.',
    facts: [
      'Transit positions come from the Time Machine date and time and are the real positions of the planets at that moment.',
      'Aspects between a transiting planet and a natal planet are measured the same way as aspects inside the natal chart.',
      'Slow planets such as Saturn, Uranus, Neptune and Pluto stay close to one natal position for months, while the Moon passes through in hours.',
    ],
    symbolism: [
      'Astrologers read a transit as a trigger or a period of emphasis for the natal theme it touches. That is a tradition about timing, not a forecast of events.',
    ],
    reading: 'On this wheel the gold outer glyphs are the transits. Move the Time Machine to see how they travel around the fixed natal ring.',
    reflection: 'When I look back at a past period, which transits were active?',
    sources: ['wiki-horoscope', 'britannica-astrology', 'wiki-planets-astrology'], see: ['concept/natal-chart'],
  },
  'house-systems': {
    id: 'concept/house-systems', kind: 'concept', name: 'House systems', tagline: 'Whole Sign and Placidus',
    summary: 'A house system is a rule for dividing the sky around the birthplace into twelve houses. Different systems place the boundaries (the cusps) differently.',
    facts: [
      'Whole Sign makes the sign of the Ascendant the whole first house and each following sign the next house, so every house is exactly 30° and cusps fall on sign boundaries.',
      'Placidus divides the time it takes each part of the zodiac to rise and set, which gives houses of unequal size. It cannot be calculated at extreme northern or southern latitudes.',
      'In such places this app shows that Placidus is undefined and uses a fallback system, and says so in the calculation notes.',
    ],
    symbolism: [
      'Whole Sign is an ancient method, while Placidus has been widely used in modern Western astrology. Astrologers disagree about which is better; the choice is a matter of tradition.',
    ],
    reading: 'The planets keep their signs under both systems; the house numbers can change. You can switch systems in the birth details and compare.',
    sources: ['wiki-house', 'britannica-astrology', 'ptolemy'],
  },
  'moon-phases': {
    id: 'concept/moon-phases', kind: 'concept', name: 'Moon phases', symbol: '◐', tagline: 'Phases, illumination and the waxing/waning cycle',
    summary: 'The lunar phases describe how much of the Moon’s sunlit hemisphere faces Earth as the Moon orbits our planet relative to the Sun.',
    facts: [
      'Astronomically, the cycle is measured by geocentric ecliptic elongation: the Moon’s apparent tropical longitude minus the Sun’s (0° to 360°). From 0° to 180° the Moon is waxing (growing in illumination); from 180° to 360° it is waning (shrinking).',
      'The four principal phases are exact instants: New Moon (0°), First Quarter (90°), Full Moon (180°) and Last Quarter (270°). Between them lie the four intermediate phases: Waxing Crescent, Waxing Gibbous, Waning Gibbous and Waning Crescent. In this observatory, principal phase labels apply within ±3° (about ±6 hours) of each exact quarter angle.',
      'Illumination percentage is the sunlit fraction of the apparent lunar disk, calculated from the 3D phase angle i as (1 + cos i) / 2. Because the Moon’s orbit is tilted up to 5.15° from the ecliptic, a non-eclipse Full Moon passes slightly north or south of exact opposition and peaks around 99.7%–99.9% illumination rather than 100%.',
      'A full synodic month (New Moon to New Moon) averages 29.53 days but varies between roughly 29.18 and 29.93 days because Earth and the Moon travel on elliptical orbits. Phase and illumination are geocentric quantities, so they are virtually the same everywhere on Earth at a given UTC moment; only the local clock time differs.',
    ],
    symbolism: [
      'Traditional astrology divides the lunation into a waxing half associated with initiating, gathering and building, and a waning half associated with integrating, reflecting and releasing.',
      'New Moons are traditionally treated as quiet beginnings, Quarter Moons as turning points of decision, and Full Moons as moments of culmination or visibility.',
      'These themes are cultural and reflective traditions, not physical forces, and there is no objective emotional-intensity score attached to any phase or illumination percentage.',
    ],
    reading: 'Use the Lunar Observatory card in the Time Machine or the Moon Inspector to check the exact astronomical phase, illumination, Moon age and upcoming principal phases alongside the Moon’s tropical sign.',
    reflection: 'Am I in a season of starting something new, bringing work to completion, or letting go of what is finished?',
    sources: ['usno-phases', 'jpl-horizons', 'meeus-algorithms', 'wiki-planets-astrology'],
    see: ['concept/lunar-parallax', 'concept/degrees'],
  },
  'lunar-parallax': {
    id: 'concept/lunar-parallax', kind: 'concept', name: 'Lunar parallax & local sky', symbol: '⌖', tagline: 'Geocentric vs topocentric Moon, altitude and meridian passage',
    summary: 'Because the Moon is much closer to Earth than the planets, viewing it from a specific city on Earth’s surface (topocentric) shifts its apparent position by up to 1° compared with viewing it from Earth’s centre (geocentric).',
    facts: [
      'Geocentric coordinates measure the sky from the centre of the Earth; topocentric coordinates measure the sky from an observer’s exact latitude and longitude on the WGS84 Earth ellipsoid.',
      'At a mean distance of about 384,400 km (roughly 60 Earth radii), the Moon exhibits a horizontal parallax of up to ±1.03°. When the geocentric Moon lies within 1° of a 30° zodiac cusp, topocentric parallax can place the locally observed Moon in the adjacent zodiac sign.',
      'To keep natal charts, transit wheels, aspects and snapshots consistent with standard ephemerides, all chart positions in this app remain strictly geocentric. When an observer location is provided, the Lunar Observatory displays topocentric Moon longitude as a clearly labelled additional local measurement and explains any sign-boundary difference.',
      'Local altitude measures how many degrees the topocentric Moon sits above (+) or below (−) the horizon, including standard atmospheric refraction (about +0.57° near the horizon). Upper meridian passage (culmination) is the daily moment when the Moon crosses the observer’s north–south meridian and reaches its highest altitude. Because the Moon moves eastward in orbit, upper meridian passage falls roughly 50 minutes later each day, so once every synodic month a local calendar date has no upper meridian passage.',
    ],
    symbolism: [
      'Astrological tradition uses the universal geocentric zodiacal position for sign and aspect meanings, while treating local horizon visibility (above or below the Earth) and meridian culmination as qualitative context for where the Moon sits in the observer’s sky.',
      'Local sky height and parallax are astronomical geometry, not a measure of personal luck or emotional intensity.',
    ],
    reading: 'Select an observer location in the Lunar Observatory—or view a saved profile with birthplace coordinates—to compare the standard geocentric chart Moon with the local topocentric Moon, its altitude above the horizon and its upper meridian passage.',
    reflection: 'How does looking at the actual sky above my location complement looking at the symbolic wheel?',
    sources: ['jpl-horizons', 'usno-phases', 'meeus-algorithms', 'wiki-ecliptic'],
    see: ['concept/moon-phases', 'concept/natal-chart'],
  },
};
