import type { Source, SourceId } from './types';

/**
 * References behind the entries. The text of every entry is original wording written for this
 * application; these sources are cited for the definitions and the traditional associations, and no
 * commercial interpretation text was copied or adapted. Web addresses are given where a stable public
 * page exists; they were reachable when this library was written, except Encyclopaedia Britannica,
 * whose site refuses automated requests and was not machine-checked.
 */
export const SOURCES: Readonly<Record<SourceId, Source>> = {
  'nasa-planets': {
    id: 'nasa-planets', title: 'Planets (Our Solar System)', author: 'NASA Science',
    used: 'Orbital periods, sizes and physical facts for the planets.', url: 'https://science.nasa.gov/solar-system/planets/',
  },
  'iau-2006': {
    id: 'iau-2006', title: 'Resolutions B5 and B6: definition of a planet, and Pluto', author: 'International Astronomical Union, XXVI General Assembly (2006)',
    used: 'Pluto’s classification as a dwarf planet.',
  },
  'wiki-planets-astrology': {
    id: 'wiki-planets-astrology', title: 'Planets in astrology', author: 'Wikipedia contributors',
    used: 'Overview of the traditional associations of the Sun, Moon and planets, and of the luminary/planet distinction.', url: 'https://en.wikipedia.org/wiki/Planets_in_astrology',
  },
  'wiki-sign': {
    id: 'wiki-sign', title: 'Astrological sign', author: 'Wikipedia contributors',
    used: 'The twelve signs, their order, elements, modalities and traditional rulers.', url: 'https://en.wikipedia.org/wiki/Astrological_sign',
  },
  'wiki-tropical': {
    id: 'wiki-tropical', title: 'Tropical zodiac', author: 'Wikipedia contributors',
    used: 'Signs as 30° arcs measured from the March equinox, and their separation from the constellations.', url: 'https://en.wikipedia.org/wiki/Tropical_zodiac',
  },
  'wiki-triplicity': {
    id: 'wiki-triplicity', title: 'Triplicity', author: 'Wikipedia contributors',
    used: 'The grouping of signs into the four elements.', url: 'https://en.wikipedia.org/wiki/Triplicity',
  },
  'wiki-house': {
    id: 'wiki-house', title: 'House (astrology)', author: 'Wikipedia contributors',
    used: 'The twelve houses, their traditional topics, the angular/succedent/cadent grouping, and house systems.', url: 'https://en.wikipedia.org/wiki/House_(astrology)',
  },
  'wiki-aspect': {
    id: 'wiki-aspect', title: 'Astrological aspect', author: 'Wikipedia contributors',
    used: 'The five major aspects, their angles and traditional character, and the idea of an orb.', url: 'https://en.wikipedia.org/wiki/Astrological_aspect',
  },
  'wiki-retrograde': {
    id: 'wiki-retrograde', title: 'Apparent retrograde motion', author: 'Wikipedia contributors',
    used: 'Why planets seem to move backwards against the stars as seen from Earth.', url: 'https://en.wikipedia.org/wiki/Apparent_retrograde_motion',
  },
  'wiki-ecliptic': {
    id: 'wiki-ecliptic', title: 'Ecliptic coordinate system', author: 'Wikipedia contributors',
    used: 'Ecliptic longitude, measured in degrees around the Sun’s apparent yearly path.', url: 'https://en.wikipedia.org/wiki/Ecliptic_coordinate_system',
  },
  'wiki-ascendant': {
    id: 'wiki-ascendant', title: 'Ascendant', author: 'Wikipedia contributors',
    used: 'The Ascendant as the ecliptic point rising on the eastern horizon.', url: 'https://en.wikipedia.org/wiki/Ascendant',
  },
  'wiki-midheaven': {
    id: 'wiki-midheaven', title: 'Midheaven', author: 'Wikipedia contributors',
    used: 'The Midheaven as the ecliptic point on the local meridian.', url: 'https://en.wikipedia.org/wiki/Midheaven',
  },
  'wiki-horoscope': {
    id: 'wiki-horoscope', title: 'Horoscope', author: 'Wikipedia contributors',
    used: 'The natal chart as a diagram of the sky at a moment and place, and the idea of comparing later sky positions to it.', url: 'https://en.wikipedia.org/wiki/Horoscope',
  },
  'wiki-symbols': {
    id: 'wiki-symbols', title: 'Astrological symbols', author: 'Wikipedia contributors',
    used: 'The glyphs used for the bodies, signs and aspects.', url: 'https://en.wikipedia.org/wiki/Astrological_symbols',
  },
  ptolemy: {
    id: 'ptolemy', title: 'Tetrabiblos (2nd century), trans. F. E. Robbins, Loeb Classical Library, 1940', author: 'Claudius Ptolemy',
    used: 'The classical foundations of the planets, signs, elements and aspects in Western astrology.',
    url: 'https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Ptolemy/Tetrabiblos/home.html',
  },
  lilly: {
    id: 'lilly', title: 'Christian Astrology (1647)', author: 'William Lilly',
    used: 'Traditional house topics and planetary significations as taught in the English tradition (public domain).',
  },
  'britannica-astrology': {
    id: 'britannica-astrology', title: 'Astrology', author: 'Encyclopaedia Britannica',
    used: 'General background on the zodiac, houses and aspects.', url: 'https://www.britannica.com/topic/astrology',
  },
};

export const sourcesFor = (ids: readonly SourceId[]) => ids.map(id => SOURCES[id]);
