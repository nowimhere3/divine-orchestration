import { albertaRule } from './civil-zone';
import { resolveBirthTime } from './resolve';

export interface TimeZoneEntry {
  readonly id: string;
  readonly label: string;
  readonly region: string;
  readonly keywords: readonly string[];
  readonly featured?: boolean;
}

export interface ZoneDescription {
  readonly valid: boolean;
  readonly title: string;
  readonly detail: string;
  readonly known: boolean;
}

export const TIME_ZONE_CATALOG: readonly TimeZoneEntry[] = [
  {
    id: 'America/Edmonton',
    label: 'Calgary / Edmonton · Alberta',
    region: 'Canada',
    keywords: ['calgary', 'edmonton', 'alberta', 'banff', 'lethbridge', 'red deer', 'mountain', 'mst', 'mdt', 'abt'],
    featured: true,
  },
  {
    id: 'America/Vancouver',
    label: 'Vancouver / Victoria · British Columbia',
    region: 'Canada',
    keywords: ['vancouver', 'victoria', 'bc', 'british columbia', 'pacific', 'pst', 'pdt'],
    featured: true,
  },
  {
    id: 'America/Winnipeg',
    label: 'Winnipeg · Manitoba',
    region: 'Canada',
    keywords: ['winnipeg', 'manitoba', 'central', 'cst', 'cdt'],
  },
  {
    id: 'America/Regina',
    label: 'Regina / Saskatoon · Saskatchewan',
    region: 'Canada',
    keywords: ['regina', 'saskatoon', 'saskatchewan', 'cst'],
  },
  {
    id: 'America/Toronto',
    label: 'Toronto / Ottawa / Montreal · Eastern',
    region: 'Canada',
    keywords: ['toronto', 'ottawa', 'montreal', 'ontario', 'quebec', 'eastern', 'est', 'edt'],
    featured: true,
  },
  {
    id: 'America/Halifax',
    label: 'Halifax · Atlantic',
    region: 'Canada',
    keywords: ['halifax', 'nova scotia', 'atlantic', 'ast', 'adt'],
  },
  {
    id: 'America/St_Johns',
    label: "St. John's · Newfoundland",
    region: 'Canada',
    keywords: ['st johns', 'newfoundland', 'nst', 'ndt'],
  },
  {
    id: 'America/New_York',
    label: 'New York / Boston / Washington · Eastern',
    region: 'United States',
    keywords: ['new york', 'nyc', 'boston', 'washington', 'philadelphia', 'miami', 'atlanta', 'eastern', 'est', 'edt'],
    featured: true,
  },
  {
    id: 'America/Chicago',
    label: 'Chicago / Dallas / Houston · Central',
    region: 'United States',
    keywords: ['chicago', 'dallas', 'houston', 'austin', 'minneapolis', 'central', 'cst', 'cdt'],
  },
  {
    id: 'America/Denver',
    label: 'Denver / Salt Lake City · Mountain',
    region: 'United States',
    keywords: ['denver', 'colorado', 'salt lake', 'utah', 'mountain', 'mst', 'mdt'],
  },
  {
    id: 'America/Phoenix',
    label: 'Phoenix · Arizona',
    region: 'United States',
    keywords: ['phoenix', 'arizona', 'tucson', 'mst'],
  },
  {
    id: 'America/Los_Angeles',
    label: 'Los Angeles / San Francisco / Seattle · Pacific',
    region: 'United States',
    keywords: ['los angeles', 'san francisco', 'seattle', 'portland', 'california', 'pacific', 'pst', 'pdt'],
    featured: true,
  },
  {
    id: 'America/Anchorage',
    label: 'Anchorage · Alaska',
    region: 'United States',
    keywords: ['anchorage', 'alaska', 'akst', 'akdt'],
  },
  {
    id: 'Pacific/Honolulu',
    label: 'Honolulu · Hawaii',
    region: 'United States',
    keywords: ['honolulu', 'hawaii', 'hst'],
  },
  {
    id: 'Europe/London',
    label: 'London / Edinburgh · UK',
    region: 'Europe',
    keywords: ['london', 'edinburgh', 'greenwich', 'uk', 'britain', 'england', 'scotland', 'gmt', 'bst'],
    featured: true,
  },
  {
    id: 'Europe/Dublin',
    label: 'Dublin · Ireland',
    region: 'Europe',
    keywords: ['dublin', 'ireland'],
  },
  {
    id: 'Europe/Paris',
    label: 'Paris · France',
    region: 'Europe',
    keywords: ['paris', 'lyon', 'france', 'cet', 'cest'],
    featured: true,
  },
  {
    id: 'Europe/Berlin',
    label: 'Berlin / Munich · Germany',
    region: 'Europe',
    keywords: ['berlin', 'munich', 'frankfurt', 'hamburg', 'germany', 'cet', 'cest'],
  },
  {
    id: 'Europe/Zurich',
    label: 'Zurich / Geneva · Switzerland',
    region: 'Europe',
    keywords: ['zurich', 'geneva', 'switzerland'],
  },
  {
    id: 'Europe/Rome',
    label: 'Rome / Milan · Italy',
    region: 'Europe',
    keywords: ['rome', 'milan', 'italy'],
  },
  {
    id: 'Europe/Madrid',
    label: 'Madrid / Barcelona · Spain',
    region: 'Europe',
    keywords: ['madrid', 'barcelona', 'spain'],
  },
  {
    id: 'Europe/Amsterdam',
    label: 'Amsterdam · Netherlands',
    region: 'Europe',
    keywords: ['amsterdam', 'netherlands', 'holland'],
  },
  {
    id: 'Europe/Brussels',
    label: 'Brussels · Belgium',
    region: 'Europe',
    keywords: ['brussels', 'belgium'],
  },
  {
    id: 'Europe/Vienna',
    label: 'Vienna · Austria',
    region: 'Europe',
    keywords: ['vienna', 'austria'],
  },
  {
    id: 'Europe/Stockholm',
    label: 'Stockholm · Sweden',
    region: 'Europe',
    keywords: ['stockholm', 'sweden'],
  },
  {
    id: 'Europe/Oslo',
    label: 'Oslo · Norway',
    region: 'Europe',
    keywords: ['oslo', 'norway'],
  },
  {
    id: 'Europe/Copenhagen',
    label: 'Copenhagen · Denmark',
    region: 'Europe',
    keywords: ['copenhagen', 'denmark'],
  },
  {
    id: 'Europe/Lisbon',
    label: 'Lisbon · Portugal',
    region: 'Europe',
    keywords: ['lisbon', 'portugal'],
  },
  {
    id: 'Europe/Athens',
    label: 'Athens · Greece',
    region: 'Europe',
    keywords: ['athens', 'greece'],
  },
  {
    id: 'Europe/Warsaw',
    label: 'Warsaw · Poland',
    region: 'Europe',
    keywords: ['warsaw', 'poland'],
  },
  {
    id: 'Europe/Prague',
    label: 'Prague · Czechia',
    region: 'Europe',
    keywords: ['prague', 'czechia', 'czech'],
  },
  {
    id: 'Europe/Istanbul',
    label: 'Istanbul · Turkey',
    region: 'Europe',
    keywords: ['istanbul', 'ankara', 'turkey'],
  },
  {
    id: 'Europe/Moscow',
    label: 'Moscow · Russia',
    region: 'Europe',
    keywords: ['moscow', 'russia'],
  },
  {
    id: 'Asia/Tokyo',
    label: 'Tokyo / Osaka · Japan',
    region: 'Asia & Middle East',
    keywords: ['tokyo', 'osaka', 'kyoto', 'japan', 'jst'],
    featured: true,
  },
  {
    id: 'Asia/Seoul',
    label: 'Seoul · South Korea',
    region: 'Asia & Middle East',
    keywords: ['seoul', 'korea', 'kst'],
  },
  {
    id: 'Asia/Shanghai',
    label: 'Beijing / Shanghai · China',
    region: 'Asia & Middle East',
    keywords: ['beijing', 'shanghai', 'china', 'cst'],
  },
  {
    id: 'Asia/Hong_Kong',
    label: 'Hong Kong',
    region: 'Asia & Middle East',
    keywords: ['hong kong', 'hkt'],
  },
  {
    id: 'Asia/Taipei',
    label: 'Taipei · Taiwan',
    region: 'Asia & Middle East',
    keywords: ['taipei', 'taiwan'],
  },
  {
    id: 'Asia/Singapore',
    label: 'Singapore',
    region: 'Asia & Middle East',
    keywords: ['singapore', 'sgt'],
  },
  {
    id: 'Asia/Kolkata',
    label: 'Mumbai / Delhi / Kolkata · India',
    region: 'Asia & Middle East',
    keywords: ['mumbai', 'delhi', 'new delhi', 'kolkata', 'bengaluru', 'india', 'ist'],
  },
  {
    id: 'Asia/Bangkok',
    label: 'Bangkok · Thailand',
    region: 'Asia & Middle East',
    keywords: ['bangkok', 'thailand'],
  },
  {
    id: 'Asia/Jakarta',
    label: 'Jakarta · Indonesia',
    region: 'Asia & Middle East',
    keywords: ['jakarta', 'indonesia'],
  },
  {
    id: 'Asia/Manila',
    label: 'Manila · Philippines',
    region: 'Asia & Middle East',
    keywords: ['manila', 'philippines'],
  },
  {
    id: 'Asia/Dubai',
    label: 'Dubai · UAE',
    region: 'Asia & Middle East',
    keywords: ['dubai', 'abu dhabi', 'uae'],
  },
  {
    id: 'Asia/Jerusalem',
    label: 'Jerusalem / Tel Aviv · Israel',
    region: 'Asia & Middle East',
    keywords: ['jerusalem', 'tel aviv', 'israel'],
  },
  {
    id: 'Asia/Riyadh',
    label: 'Riyadh · Saudi Arabia',
    region: 'Asia & Middle East',
    keywords: ['riyadh', 'saudi arabia'],
  },
  {
    id: 'Australia/Sydney',
    label: 'Sydney / Melbourne · Australia',
    region: 'Oceania',
    keywords: ['sydney', 'melbourne', 'canberra', 'australia', 'aest', 'aedt'],
    featured: true,
  },
  {
    id: 'Australia/Brisbane',
    label: 'Brisbane · Queensland',
    region: 'Oceania',
    keywords: ['brisbane', 'queensland', 'australia'],
  },
  {
    id: 'Australia/Perth',
    label: 'Perth · Western Australia',
    region: 'Oceania',
    keywords: ['perth', 'western australia', 'australia'],
  },
  {
    id: 'Pacific/Auckland',
    label: 'Auckland / Wellington · New Zealand',
    region: 'Oceania',
    keywords: ['auckland', 'wellington', 'new zealand', 'nzst', 'nzdt'],
  },
  {
    id: 'America/Mexico_City',
    label: 'Mexico City · Mexico',
    region: 'Latin America',
    keywords: ['mexico city', 'mexico'],
  },
  {
    id: 'America/Sao_Paulo',
    label: 'São Paulo / Rio de Janeiro · Brazil',
    region: 'Latin America',
    keywords: ['sao paulo', 'rio de janeiro', 'brazil'],
  },
  {
    id: 'America/Argentina/Buenos_Aires',
    label: 'Buenos Aires · Argentina',
    region: 'Latin America',
    keywords: ['buenos aires', 'argentina'],
  },
  {
    id: 'America/Bogota',
    label: 'Bogotá · Colombia',
    region: 'Latin America',
    keywords: ['bogota', 'colombia'],
  },
  {
    id: 'America/Lima',
    label: 'Lima · Peru',
    region: 'Latin America',
    keywords: ['lima', 'peru'],
  },
  {
    id: 'America/Santiago',
    label: 'Santiago · Chile',
    region: 'Latin America',
    keywords: ['santiago', 'chile'],
  },
  {
    id: 'Africa/Cairo',
    label: 'Cairo · Egypt',
    region: 'Africa',
    keywords: ['cairo', 'egypt'],
  },
  {
    id: 'Africa/Johannesburg',
    label: 'Johannesburg / Cape Town · South Africa',
    region: 'Africa',
    keywords: ['johannesburg', 'cape town', 'south africa'],
  },
  {
    id: 'Africa/Lagos',
    label: 'Lagos · Nigeria',
    region: 'Africa',
    keywords: ['lagos', 'nigeria'],
  },
  {
    id: 'Africa/Nairobi',
    label: 'Nairobi · Kenya',
    region: 'Africa',
    keywords: ['nairobi', 'kenya'],
  },
  {
    id: 'UTC',
    label: 'UTC · Coordinated Universal Time',
    region: 'Universal',
    keywords: ['utc', 'gmt', 'greenwich', 'universal'],
    featured: true,
  },
];

const catalogById = new Map(TIME_ZONE_CATALOG.map(entry => [entry.id.toLowerCase(), entry]));

function runtimeSupportedZones(): readonly string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf !== 'function') return [];
  try {
    return intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

function entryFromIana(id: string): TimeZoneEntry {
  const known = catalogById.get(id.toLowerCase());
  if (known) return known;
  const parts = id.split('/');
  const city = (parts[parts.length - 1] ?? id).replace(/_/g, ' ');
  const region = parts.length > 1 ? parts[0].replace(/_/g, ' ') : 'IANA';
  return {
    id,
    label: parts.length > 1 ? `${city} · ${region}` : id,
    region,
    keywords: [city.toLowerCase(), region.toLowerCase()],
  };
}

let cachedAll: readonly TimeZoneEntry[] | null = null;

export function allTimeZoneEntries(): readonly TimeZoneEntry[] {
  if (cachedAll) return cachedAll;
  const seen = new Set<string>();
  const list: TimeZoneEntry[] = [];
  for (const entry of TIME_ZONE_CATALOG) {
    seen.add(entry.id.toLowerCase());
    list.push(entry);
  }
  for (const id of runtimeSupportedZones()) {
    if (seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    list.push(entryFromIana(id));
  }
  cachedAll = list;
  return list;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function searchTimeZones(query: string, limit = 16): readonly TimeZoneEntry[] {
  const q = normalize(query);
  const all = allTimeZoneEntries();
  if (!q) return all.filter(entry => entry.featured).slice(0, limit);

  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ entry: TimeZoneEntry; score: number }> = [];

  for (const entry of all) {
    const idNorm = normalize(entry.id);
    const labelNorm = normalize(entry.label);
    const regionNorm = normalize(entry.region);
    const keywordsNorm = entry.keywords.map(normalize);
    const haystack = `${idNorm} ${labelNorm} ${regionNorm} ${keywordsNorm.join(' ')}`;

    if (!tokens.every(token => haystack.includes(token))) continue;

    let score = 0;
    if (idNorm === q) score += 1000;
    else if (keywordsNorm.some(k => k === q) || labelNorm.startsWith(q)) score += 600;
    else if (idNorm.startsWith(q) || keywordsNorm.some(k => k.startsWith(q))) score += 400;
    else if (labelNorm.includes(q)) score += 250;
    else score += 100;

    if (catalogById.has(entry.id.toLowerCase())) score += 50;
    if (entry.featured) score += 20;

    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label));
  return scored.slice(0, limit).map(item => item.entry);
}

export function isValidIanaZone(zone: string): boolean {
  const trimmed = zone.trim();
  if (!trimmed || !/^[a-z][a-z0-9_+\-/]*$/i.test(trimmed)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

function formatOffsetWords(offset: string): string {
  const match = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(offset);
  if (!match) return `offset ${offset}`;
  const [, sign, h, m] = match;
  const hours = Number(h);
  const minutes = Number(m);
  if (hours === 0 && minutes === 0) return 'Same clock as Greenwich (UTC+00:00)';
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  const direction = sign === '-' ? 'behind' : 'ahead of';
  return `Local clock is ${parts.join(' ')} ${direction} Greenwich (UTC${offset})`;
}

export function describeZoneSelection(
  zone: string,
  date: string,
  time: string | null,
  modelDeltaTSeconds: (fractionalYear: number) => number,
): ZoneDescription {
  const trimmed = zone.trim();
  if (!trimmed) {
    return {
      valid: false,
      known: false,
      title: 'No time zone entered',
      detail: 'Search for a city or region, or enter a recorded UTC offset below.',
    };
  }
  if (!isValidIanaZone(trimmed)) {
    return {
      valid: false,
      known: false,
      title: 'Unrecognized time zone',
      detail: 'Choose a location from the list or enter a valid IANA identifier such as America/Edmonton.',
    };
  }

  const catalogMatch = catalogById.get(trimmed.toLowerCase());
  const title = catalogMatch ? `${catalogMatch.label} (${catalogMatch.id})` : `Manual IANA zone (${trimmed})`;

  if (albertaRule(trimmed, date)) {
    return {
      valid: true,
      known: Boolean(catalogMatch),
      title,
      detail: 'Permanent Alberta Time applies from November 2026: 6 hours behind Greenwich (UTC−06:00), with no seasonal clock change.',
    };
  }

  if (date && time !== null) {
    const resolved = resolveBirthTime({ date, time, timeZone: trimmed }, modelDeltaTSeconds);
    if (resolved.kind === 'resolved') {
      const base = formatOffsetWords(resolved.offset.value).replace('-', '−');
      const historical = resolved.warnings.includes('historical-zone-offset-uncertain')
        ? ' Historical zone rules before 1970 are applied from browser IANA data.'
        : '';
      return { valid: true, known: Boolean(catalogMatch), title, detail: `${base}.${historical}` };
    }
    if (resolved.kind === 'unresolved' && resolved.reason === 'ambiguous-wall-time') {
      return {
        valid: true,
        known: Boolean(catalogMatch),
        title,
        detail: 'Valid time zone · clocks turned back at this hour, so choose the recorded offset after calculating.',
      };
    }
    if (resolved.kind === 'unresolved' && resolved.reason === 'nonexistent-wall-time') {
      return {
        valid: true,
        known: Boolean(catalogMatch),
        title,
        detail: 'Valid time zone · that local clock time was skipped by a spring clock change.',
      };
    }
  }

  return {
    valid: true,
    known: Boolean(catalogMatch),
    title,
    detail: 'Valid time zone · standard and daylight rules are applied automatically for the birth date.',
  };
}
