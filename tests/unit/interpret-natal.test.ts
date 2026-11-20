// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, test } from 'vitest';
import { calculateAspects, createAspectRuleSet } from '../../src/domain/aspects';
import { PLANET_IDS } from '../../src/domain/chart';
import type { HouseFacts, PlanetId, PlanetPosition, TimedChart } from '../../src/domain/chart';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import type { EphemeraEngine } from '../../src/engine/ephemera';
import { createSnapshotV0, renderSnapshotMarkdown, serializeSnapshot } from '../../src/export/snapshot';
import {
  calculateAngleAspects,
  calculateDateOnlyNatalFacts,
  computeBalance,
  inspectorPersonalNatal,
  interpretNatalChart,
  natalSymbolicMeanings,
} from '../../src/interpret';
import { calculateDateOnlyMoonSummary, calculateMoonState } from '../../src/lunar';
import { resolveBirthTime } from '../../src/time/resolve';
import { availablePositions, calculateNatal, chartAspects } from '../../src/view/chart-data';
import type { PositionMap } from '../../src/view/chart-data';

let engine: EphemeraEngine;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm'));
  engine = await createEphemeraEngine(wasm);
});

function pos(lon: number, speed = 1): PlanetPosition {
  return {
    longitudeDeg: ((lon % 360) + 360) % 360,
    latitudeDeg: 0,
    distanceAu: 1,
    longitudeSpeedDegPerDay: speed,
    latitudeSpeedDegPerDay: 0,
    distanceSpeedAuPerDay: 0,
    retrograde: speed < 0,
  };
}

function buildRealReading(options: {
  date: string;
  time: string | null;
  timeZone?: string;
  offsetOverride?: string;
  observer: { latitudeDeg: number; longitudeDeg: number } | null;
  houseSystem: 'WholeSign' | 'Placidus';
  label?: string | null;
  isDemo?: boolean;
}) {
  const resolved = resolveBirthTime(
    {
      date: options.date,
      time: options.time,
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
      ...(options.offsetOverride ? { offsetOverride: options.offsetOverride } : {}),
    },
    engine.modelDeltaTSeconds,
  );
  if (resolved.kind === 'unresolved') throw new Error(`Failed to resolve test birth time: ${resolved.reason}`);
  const chart = { ...calculateNatal(engine, resolved, options.observer, options.houseSystem), label: options.label ?? null };
  const positions = chart.planets.status === 'available' ? availablePositions(chart.planets.value) : new Map();
  const aspects = chartAspects(positions);
  const houses = chart.houses.status === 'available' ? chart.houses.value : null;
  const natalMoonState = resolved.kind === 'resolved'
    ? (() => {
      const m = calculateMoonState(engine, resolved);
      return m.status === 'ok' ? m.value : null;
    })()
    : null;
  const dateOnlyMoonSummary = resolved.kind === 'unknown-time'
    ? calculateDateOnlyMoonSummary(engine, chart.time.input)
    : null;
  const reading = interpretNatalChart({
    chart,
    positions,
    aspects,
    houses,
    natalMoonState,
    dateOnlyMoonSummary,
    engine,
    isDemo: options.isDemo ?? false,
    birthSummary: `${options.date} ${options.time ?? 'birth time unknown'}`,
  });
  return { chart, positions, aspects, houses, reading };
}

describe('U5A personalized natal interpretation', () => {
  test('produces deterministic, verified natal placements, chart ruler, houses and Moon phase for Greenwich J2000', () => {
    const a = buildRealReading({
      date: '2000-01-01', time: '12:00', timeZone: 'Europe/London',
      observer: { latitudeDeg: 51.4779, longitudeDeg: 0 }, houseSystem: 'WholeSign', isDemo: true,
    });
    const b = buildRealReading({
      date: '2000-01-01', time: '12:00', timeZone: 'Europe/London',
      observer: { latitudeDeg: 51.4779, longitudeDeg: 0 }, houseSystem: 'WholeSign', isDemo: true,
    });
    expect(JSON.stringify(a.reading)).toBe(JSON.stringify(b.reading));

    const { reading } = a;
    expect(reading.mode).toBe('complete');
    expect(reading.isDemo).toBe(true);
    expect(reading.houseSystemLabel).toBe('Whole Sign');
    expect(reading.placements).toHaveLength(10);
    // J2000 Greenwich noon: Sun is ~10°22' Capricorn, Moon is in Scorpio, Ascendant is in Aries/Taurus
    expect(reading.coreTrio.sun?.title).toContain('Sun in Capricorn');
    expect(reading.coreTrio.moon?.title).toContain('Moon in Scorpio');
    expect(reading.coreTrio.ascendant).not.toBeNull();
    expect(reading.coreTrio.midheaven).not.toBeNull();
    expect(reading.coreTrio.chartRuler).not.toBeNull();
    expect(reading.coreTrio.natalMoonPhase?.phaseLabel).toMatch(/Waning Crescent/i);
    expect(reading.balance).not.toBeNull();
    expect(reading.balance?.includesAngles).toBe(true);
    expect(reading.themes.some(t => t.kind === 'chart-ruler')).toBe(true);
    expect(reading.themes.some(t => t.kind === 'balance')).toBe(true);
    expect(reading.reflections.length).toBeGreaterThan(0);
    expect(reading.sources.length).toBeGreaterThan(0);
  });

  test('distinguishes Whole Sign and Placidus houses and flags polar fallback', () => {
    const whole = buildRealReading({
      date: '1990-07-15', time: '18:30', timeZone: 'America/Edmonton',
      observer: { latitudeDeg: 51.0447, longitudeDeg: -114.0719 }, houseSystem: 'WholeSign',
    });
    const placidus = buildRealReading({
      date: '1990-07-15', time: '18:30', timeZone: 'America/Edmonton',
      observer: { latitudeDeg: 51.0447, longitudeDeg: -114.0719 }, houseSystem: 'Placidus',
    });
    expect(whole.reading.houseSystemLabel).toBe('Whole Sign');
    expect(placidus.reading.houseSystemLabel).toBe('Placidus');
    // Same planets/signs in both systems
    expect(whole.reading.coreTrio.sun?.signIndex).toBe(placidus.reading.coreTrio.sun?.signIndex);
    expect(whole.reading.coreTrio.ascendant?.signIndex).toBe(placidus.reading.coreTrio.ascendant?.signIndex);

    // Polar Placidus fallback (> 66.5° N)
    const polar = buildRealReading({
      date: '1990-07-15', time: '18:30', timeZone: 'UTC',
      observer: { latitudeDeg: 70.0, longitudeDeg: 25.0 }, houseSystem: 'Placidus',
    });
    expect(polar.reading.houseSystemLabel).toBe('Porphyry');
    expect(polar.reading.sensitivityNotes.some(n => n.includes('Porphyry'))).toBe(true);
  });

  test('omits houses, angles and chart ruler cleanly when birthplace coordinates are missing', () => {
    const { reading } = buildRealReading({
      date: '1992-05-14', time: '09:15', timeZone: 'America/New_York',
      observer: null, houseSystem: 'WholeSign', label: 'No Location',
    });
    expect(reading.mode).toBe('no-houses');
    expect(reading.houseSystemLabel).toBeNull();
    expect(reading.coreTrio.sun).not.toBeNull();
    expect(reading.coreTrio.moon).not.toBeNull();
    expect(reading.coreTrio.ascendant).toBeNull();
    expect(reading.coreTrio.midheaven).toBeNull();
    expect(reading.coreTrio.chartRuler).toBeNull();
    expect(reading.coreTrio.natalMoonPhase).not.toBeNull();
    expect(reading.placements.every(p => p.houseNumber === null)).toBe(true);
    expect(reading.omittedNotes.some(n => n.includes('Birthplace coordinates are not set'))).toBe(true);
    expect(reading.balance?.includesAngles).toBe(false);
  });

  test('handles unknown birth time conservatively with confirmed signs, boundary-day detection and omitted houses/angles', () => {
    // 2024-03-20 is the March equinox (Sun crosses Pisces -> Aries at ~03:06 UTC!)
    const { reading } = buildRealReading({
      date: '2024-03-20', time: null, timeZone: 'UTC',
      observer: null, houseSystem: 'WholeSign', label: 'Equinox Date Only',
    });
    expect(reading.mode).toBe('date-only');
    expect(reading.coreTrio.ascendant).toBeNull();
    expect(reading.coreTrio.midheaven).toBeNull();
    expect(reading.coreTrio.chartRuler).toBeNull();
    expect(reading.placements.every(p => p.houseNumber === null)).toBe(true);
    expect(reading.omittedNotes.some(n => n.includes('Birth time is unknown'))).toBe(true);

    // Sun crossed Pisces -> Aries on 2024-03-20 UTC
    const sun = reading.placements.find(p => p.planetId === 'sun')!;
    expect(sun.status).toBe('boundary-day');
    expect(sun.title).toContain('Pisces → Aries');
    expect(sun.signIndex).toBeNull();
    expect(reading.sensitivityNotes.some(n => n.includes('Sun'))).toBe(true);

    // Outer planets stayed confirmed in one sign all day
    const saturn = reading.placements.find(p => p.planetId === 'saturn')!;
    expect(saturn.status).toBe('confirmed-sign');
    expect(saturn.signIndex).not.toBeNull();

    // Confirmed non-Moon aspects never include the Moon
    expect(reading.aspects.every(a => !a.fromLabel.includes('Moon') && !a.toLabel.includes('Moon'))).toBe(true);

    // Also verify calculateDateOnlyNatalFacts directly on a non-ingress Sun day
    const stable = calculateDateOnlyNatalFacts(engine, { date: '2000-01-01', time: null, timeZone: 'Europe/London' });
    expect(stable.status).toBe('ok');
    expect(stable.planets.find(p => p.planetId === 'sun')?.status).toBe('confirmed');
  });

  test('detects stelliums, T-Square, Grand Trine, Grand Cross, angle aspects and focal planet deterministically', () => {
    const houses: HouseFacts = {
      cusps: Array.from({ length: 12 }, (_, i) => ({ houseId: (i + 1) as HouseFacts['cusps'][number]['houseId'], longitudeDeg: i * 30 })),
      ascendantDeg: 10, // 10° Aries
      midheavenDeg: 280, // 10° Capricorn
      effectiveSystem: 'WholeSign',
      fallback: false,
    };

    // Synthetic chart:
    // Grand Cross in Cardinal signs: Sun 10° Aries (0°+10), Mars 10° Cancer (100°), Saturn 10° Libra (190°), Jupiter 10° Capricorn (280°)
    // Plus 3 planets in Aries (Sun 10°, Mercury 12°, Venus 15°) => Sign & House 1 Stellium!
    // Grand Trine in Fire: Sun 10° Aries (10°), Moon 10° Leo (130°), Uranus 10° Sagittarius (250°)
    const map: PositionMap = new Map<PlanetId, PlanetPosition>([
      ['sun', pos(10)],
      ['mercury', pos(12, -0.5)], // Retrograde personal planet
      ['venus', pos(15)],
      ['mars', pos(100)],
      ['moon', pos(130)],
      ['saturn', pos(190)],
      ['uranus', pos(250)],
      ['jupiter', pos(280)],
      ['neptune', pos(315)],
      ['pluto', pos(255)],
    ]);

    const aspects = calculateAspects(
      PLANET_IDS.map(planetId => ({ chartId: 'natal', planetId, longitudeDeg: map.get(planetId)!.longitudeDeg })),
    );
    const angleAspects = calculateAngleAspects(map, houses);
    expect(angleAspects.some(a => a.planetId === 'sun' && a.angle === 'asc' && a.aspect === 'conjunction' && a.orbDeg === 0)).toBe(true);
    expect(angleAspects.some(a => a.planetId === 'jupiter' && a.angle === 'mc' && a.aspect === 'conjunction' && a.orbDeg === 0)).toBe(true);

    const balance = computeBalance(map, houses);
    expect(balance?.dominantElement).toBe('fire');
    expect(balance?.dominantMode).toBe('cardinal');

    const resolved = resolveBirthTime({ date: '2000-03-30', time: '12:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
    if (resolved.kind !== 'resolved') throw new Error('expected resolved');
    const chart: TimedChart = {
      id: 'natal', label: 'Synthetic Pattern Chart', kind: 'natal', time: resolved,
      settings: { zodiac: 'tropical', requestedHouseSystem: 'WholeSign', observer: { latitudeDeg: 51, longitudeDeg: 0 } },
      planets: { status: 'available', value: PLANET_IDS.map(planetId => ({ planetId, position: { status: 'available', value: map.get(planetId)! } })) },
      houses: { status: 'available', value: houses },
      warnings: [],
    };
    const reading = interpretNatalChart({
      chart, positions: map, aspects, houses, natalMoonState: null, dateOnlyMoonSummary: null,
      isDemo: false, birthSummary: 'Synthetic fixture',
    });

    expect(reading.themes.some(t => t.id === 'theme/stellium-sign-0')).toBe(true);
    expect(reading.themes.some(t => t.id === 'theme/stellium-house-1')).toBe(true);
    expect(reading.themes.some(t => t.title.startsWith('Grand Cross'))).toBe(true);
    expect(reading.themes.some(t => t.title.startsWith('Grand Trine'))).toBe(true);
    expect(reading.themes.some(t => t.kind === 'angular')).toBe(true);
    expect(reading.themes.some(t => t.kind === 'retrograde')).toBe(true);

    // T-Square check (without Grand Cross): opposition Sun 10° Aries – Saturn 10° Libra, apex Mars 10° Cancer
    const tMap: PositionMap = new Map<PlanetId, PlanetPosition>([
      ['sun', pos(10)],
      ['saturn', pos(190)],
      ['mars', pos(100)],
      ['moon', pos(45)],
      ['mercury', pos(25)],
      ['venus', pos(55)],
      ['jupiter', pos(145)],
      ['uranus', pos(230)],
      ['neptune', pos(300)],
      ['pluto', pos(335)],
    ]);
    const tAspects = calculateAspects(
      PLANET_IDS.map(planetId => ({ chartId: 'natal', planetId, longitudeDeg: tMap.get(planetId)!.longitudeDeg })),
    );
    const tReading = interpretNatalChart({
      chart, positions: tMap, aspects: tAspects, houses, natalMoonState: null, dateOnlyMoonSummary: null,
      isDemo: false, birthSummary: 'T-Square fixture',
    });
    expect(tReading.themes.some(t => t.title === 'T-Square focused on Mars')).toBe(true);
  });

  test('provides concise Inspector notes for natal items only and keeps wording honest and non-commercial', () => {
    const { reading, aspects } = buildRealReading({
      date: '1988-11-04', time: '06:45', timeZone: 'America/Edmonton',
      observer: { latitudeDeg: 53.5461, longitudeDeg: -113.4938 }, houseSystem: 'Placidus', label: 'Edmonton Profile',
    });

    const sunNote = inspectorPersonalNatal(reading, 'natal/sun');
    expect(sunNote?.heading).toBe('In this chart');
    expect(sunNote?.synthesis).toContain('Scorpio');

    const ascNote = inspectorPersonalNatal(reading, 'angle/asc');
    expect(ascNote?.heading).toBe('In this chart');
    expect(ascNote?.synthesis).toContain('Ascendant');

    const natalAspect = aspects[0];
    const aspNote = inspectorPersonalNatal(reading, natalAspect.id);
    expect(aspNote?.heading).toBe('In this chart');
    expect(aspNote?.factBadge).toContain('orb');

    // Transit items and concepts must not receive natal "In this chart" blocks
    expect(inspectorPersonalNatal(reading, 'transit/sun')).toBeNull();
    expect(inspectorPersonalNatal(reading, 'concept/orb')).toBeNull();

    // Anti-fatalism & zero-commercial-copy lint across all generated synthesis prose
    const prose = [
      reading.overview.synthesis,
      ...reading.themes.map(t => t.synthesis),
      ...reading.placements.map(p => p.synthesis),
      ...reading.aspects.map(a => a.synthesis),
      reading.coreTrio.ascendant?.synthesis ?? '',
      reading.coreTrio.midheaven?.synthesis ?? '',
      reading.coreTrio.chartRuler?.synthesis ?? '',
      reading.coreTrio.natalMoonPhase?.synthesis ?? '',
    ].join(' ');
    expect(prose).not.toMatch(/\byou will\b|\bwill happen\b|\bdestined\b|\bguaranteed\b|\bdoomed\b|\bdefinitely\b/i);
    const serialized = JSON.stringify(reading).toLowerCase();
    for (const banned of ['chani', 'co-star', 'costar']) {
      expect(serialized).not.toContain(banned);
    }
  });

  test('exports optional SnapshotV0 interpretations with strict privacy redaction and schema compliance', () => {
    const { chart, aspects, reading } = buildRealReading({
      date: '1985-06-22', time: '14:20', timeZone: 'America/Edmonton',
      observer: { latitudeDeg: 53.5461, longitudeDeg: -113.4938 }, houseSystem: 'Placidus', label: 'Secret Name',
    });
    const privateChart = { ...chart, id: 'private-natal-1985' };
    const remappedAspects = aspects.map(a => ({
      ...a,
      from: { ...a.from, chartId: 'private-natal-1985' },
      to: { ...a.to, chartId: 'private-natal-1985' },
      id: JSON.stringify(['private-natal-1985', a.from.planetId, 'private-natal-1985', a.to.planetId, a.aspect]),
    }));
    const meanings = natalSymbolicMeanings(reading, 'private-natal-1985');
    expect(meanings.length).toBeGreaterThan(5);

    const snapshot = createSnapshotV0({
      engine: { name: 'Ephemera', version: '0.4.1', dataMode: '1as', frame: 'apparent geocentric tropical ecliptic of date' },
      aspectRules: createAspectRuleSet(),
      charts: [privateChart],
      aspects: remappedAspects,
      context: { selectedAt: null, referenceAt: null, eventSearch: null },
    }, { redactBirthDetails: true, includeRedactedNatalSynthesis: true });

    const json = serializeSnapshot(snapshot);
    const md = renderSnapshotMarkdown(snapshot);

    for (const secret of ['Secret Name', '1985-06-22', '14:20', 'America/Edmonton', '53.5461', '-113.4938', 'private-natal-1985']) {
      expect(json).not.toContain(secret);
      expect(md).not.toContain(secret);
    }
    expect(snapshot.interpretations.length).toBe(meanings.length);
    expect(snapshot.interpretations.every(item =>
      typeof item.factId === 'string' && item.factId.length > 0
      && typeof item.tradition === 'string'
      && item.ruleSetVersion === 'u5a-v1'
      && typeof item.description === 'string' && item.description.length > 20
      && Array.isArray(item.sources) && item.sources.length > 0,
    )).toBe(true);
    expect(snapshot.interpretations[0].factId).toBe('chart-1/overview');

    // Also verify date-only redacted export never leaks birth date!
    const dateOnly = buildRealReading({
      date: '2024-03-20', time: null, timeZone: 'UTC', observer: null, houseSystem: 'WholeSign', label: 'Hidden Equinox',
    });
    const dateOnlyInput = {
      engine: null,
      aspectRules: createAspectRuleSet(),
      charts: [dateOnly.chart],
      aspects: [],
      context: { selectedAt: null, referenceAt: null, eventSearch: null },
    };
    const dateOnlyOptions = { redactBirthDetails: true, includeRedactedNatalSynthesis: true };
    const dateOnlySnap = createSnapshotV0(dateOnlyInput, { ...dateOnlyOptions, dateOnlyEngine: engine });
    expect(dateOnlySnap.interpretations.find(item => item.factId === 'chart-1/sun')?.description).toContain('crossed from Pisces into Aries');
    for (const format of [serializeSnapshot(dateOnlySnap), renderSnapshotMarkdown(dateOnlySnap)]) {
      expect(format).not.toContain('2024-03-20');
      expect(format).not.toContain('Hidden Equinox');
    }
    expect(createSnapshotV0(dateOnlyInput, { ...dateOnlyOptions, dateOnlyEngine: { ...engine } }).interpretations).toEqual([]);
  });

  // --- U5A Precision Corrections regression tests (Codex release blockers 1–4) ---

  test('Blocker 1a: rejects date-only aspect when interior orb exceeds allowed orb (1917-05-05 Mercury square Uranus)', () => {
    const facts = calculateDateOnlyNatalFacts(engine, { date: '1917-05-05', time: null, timeZone: 'UTC' });
    expect(facts.status).toBe('ok');
    const mercUranusSq = facts.confirmedAspects.find(
      a => ((a.from === 'mercury' && a.to === 'uranus') || (a.from === 'uranus' && a.to === 'mercury')) && a.aspect === 'square',
    );
    expect(mercUranusSq).toBeUndefined();
  });

  test('Blocker 1b: detects synthetic Mercury station crossing 30° and returning as a boundary day, not confirmed Aries', () => {
    const startRes = resolveBirthTime({ date: '2024-04-01', time: '00:00:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
    const endRes = resolveBirthTime({ date: '2024-04-01', time: '23:59:59', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
    if (startRes.kind !== 'resolved' || endRes.kind !== 'resolved') throw new Error('expected resolved');
    const midTt = (startRes.jdTt + endRes.jdTt) / 2;
    const halfSpan = (endRes.jdTt - startRes.jdTt) / 2;

    const syntheticEngine: EphemeraEngine = {
      ...engine,
      station(body, jdTt, options) {
        if (body === 'Mercury') {
          return {
            engine: engine.position('Sun', startRes).engine,
            settings: { ...options, body, jdTt, searchedDays: options.maxDays },
            warnings: [],
            status: 'ok',
            value: { jdTt: midTt, turns: 'retrograde' },
          };
        }
        return engine.station(body, jdTt, options);
      },
      position(body, instant) {
        if (body === 'Mercury') {
          // Parabola: 29.90° at both endpoints, peaking at 30.10° (Taurus!) at noon with speed = 0.
          const u = (instant.jdTt - midTt) / halfSpan; // -1..+1
          const longitude = 30.10 - 0.20 * u * u;
          const longitudeSpeed = (-0.40 * u) / halfSpan;
          return {
            engine: engine.position('Sun', instant).engine,
            settings: { ...instant, body },
            warnings: [],
            status: 'ok',
            value: {
              longitude, latitude: 0, distance: 1,
              longitudeSpeed, latitudeSpeed: 0, distanceSpeed: 0,
              retrograde: longitudeSpeed < 0,
            },
          };
        }
        return engine.position(body, instant);
      },
    };

    const facts = calculateDateOnlyNatalFacts(syntheticEngine, { date: '2024-04-01', time: null, timeZone: 'UTC' });
    const mercury = facts.planets.find(p => p.planetId === 'mercury')!;
    expect(mercury.status).toBe('boundary-day');
    expect(mercury.visitedSignIndices).toEqual([0, 1, 0]);
    expect([mercury.startSignIndex, mercury.endSignIndex]).toEqual([0, 0]);
    expect(mercury.stationedDuringDay).toBe(true);
    expect(mercury.maxLongitudeDeg).toBeCloseTo(30.10, 4);
    expect(mercury.minLongitudeDeg).toBeCloseTo(29.90, 4);

    const time = resolveBirthTime({ date: '2024-04-01', time: null, timeZone: 'UTC' }, engine.modelDeltaTSeconds);
    if (time.kind !== 'unknown-time') throw new Error('expected unknown birth time');
    const reading = interpretNatalChart({
      chart: calculateNatal(engine, time, null, 'WholeSign'), engine: syntheticEngine,
      positions: new Map(), aspects: [], houses: null, isDemo: false, birthSummary: '',
      natalMoonState: null, dateOnlyMoonSummary: null,
    });
    expect(reading.placements.find(p => p.planetId === 'mercury')?.title).toContain('Aries → Taurus → Aries');
  });

  test('describes the Mercury ingress on 2024-08-15 in chronological retrograde order', () => {
    const { reading } = buildRealReading({
      date: '2024-08-15', time: null, timeZone: 'UTC', observer: null, houseSystem: 'WholeSign',
    });
    const mercury = reading.dateOnlyFacts!.planets.find(p => p.planetId === 'mercury')!;
    expect(mercury.startFormatted).toContain('Virgo');
    expect(mercury.endFormatted).toContain('Leo');
    expect([mercury.startSignIndex, mercury.endSignIndex]).toEqual([5, 4]);
    expect(reading.placements.find(p => p.planetId === 'mercury')?.synthesis).toContain('crossed from Virgo into Leo');
  });

  test('includes the solar ingress in the last fractional second of the civil day', () => {
    const birth = { date: '2024-03-19', time: null, offsetOverride: '-03:06:25' };
    const finalSample = resolveBirthTime({ ...birth, time: '23:59:59.999' }, engine.modelDeltaTSeconds);
    if (finalSample.kind !== 'resolved') throw new Error('expected a resolved instant');
    const sun = engine.position('Sun', finalSample);
    if (sun.status !== 'ok') throw new Error('expected a solar longitude');
    expect(sun.value.longitude).toBeLessThan(1);
    expect(calculateDateOnlyNatalFacts(engine, birth).planets.find(p => p.planetId === 'sun')).toMatchObject({
      status: 'boundary-day', startSignIndex: 11, endSignIndex: 0,
    });
  });

  test('excludes a sign ingress at the next civil midnight', () => {
    const boundary = resolveBirthTime({ date: '2024-03-21', time: '00:00', timeZone: 'UTC' }, engine.modelDeltaTSeconds);
    if (boundary.kind !== 'resolved') throw new Error('expected a resolved midnight');
    const syntheticEngine: EphemeraEngine = {
      ...engine,
      position(body, instant) {
        const sample = engine.position(body, instant);
        if (body !== 'Sun' || sample.status !== 'ok') return sample;
        return { ...sample, value: { ...sample.value, longitude: 30 + 12 * (instant.jdTt - boundary.jdTt) } };
      },
    };
    const day = calculateDateOnlyNatalFacts(syntheticEngine, { date: '2024-03-20', time: null, timeZone: 'UTC' });
    expect(day.planets.find(p => p.planetId === 'sun')).toMatchObject({
      status: 'confirmed', startSignIndex: 0, endSignIndex: 0,
    });
  });

  test('Blocker 1c: captures interior orb minimum (1900-01-05 Mercury–Neptune opposition) and station degree extreme (2024-04-01 Mercury)', () => {
    const oppFacts = calculateDateOnlyNatalFacts(engine, { date: '1900-01-05', time: null, timeZone: 'UTC' });
    const mercNepOpp = oppFacts.confirmedAspects.find(
      a => ((a.from === 'mercury' && a.to === 'neptune') || (a.from === 'neptune' && a.to === 'mercury')) && a.aspect === 'opposition',
    );
    expect(mercNepOpp).toBeDefined();
    // Noon alone is ~0.12383°; interior minimum must be well below endpoint 0.57754°.
    expect(mercNepOpp!.minOrbDeg).toBeLessThan(0.15);

    const stFacts = calculateDateOnlyNatalFacts(engine, { date: '2024-04-01', time: null, timeZone: 'UTC' });
    const mercury = stFacts.planets.find(p => p.planetId === 'mercury')!;
    expect(mercury.status).toBe('confirmed');
    expect(mercury.stationedDuringDay).toBe(true);
    expect(mercury.maxLongitudeDeg!).toBeGreaterThan(mercury.startLongitudeDeg!);
    expect(mercury.maxLongitudeDeg!).toBeGreaterThan(mercury.endLongitudeDeg!);
  });

  test('Blocker 1d: rejects skipped local date Pacific/Apia 2011-12-30 and honors offsetOverride over timeZone on 2024-03-20', () => {
    const skipped = buildRealReading({
      date: '2011-12-30', time: null, timeZone: 'Pacific/Apia',
      observer: null, houseSystem: 'WholeSign',
    });
    expect(skipped.reading.dateOnlyFacts?.status).toBe('unavailable');
    expect(skipped.reading.dateOnlyFacts?.unavailableReason).toBe('skipped-civil-date');
    expect(skipped.reading.mode).toBe('unavailable');
    expect(skipped.reading.placements).toHaveLength(0);
    expect(skipped.reading.overview.headline).toContain('Skipped');

    // Explicit offsetOverride '-10:00' overrides timeZone 'UTC' on 2024-03-20 -> Sun is already in Aries all day!
    const overridden = calculateDateOnlyNatalFacts(engine, {
      date: '2024-03-20', time: null, timeZone: 'UTC', offsetOverride: '-10:00',
    });
    expect(overridden.status).toBe('ok');
    const sun = overridden.planets.find(p => p.planetId === 'sun')!;
    expect(sun.status).toBe('confirmed');
    expect(sun.startSignIndex).toBe(0); // Aries
  });

  test('Blocker 2: includes confirmed Leo Moon in Fire balance (2024-03-20) and refuses single Moon phase on transition day (2024-01-04)', () => {
    const equinox = buildRealReading({
      date: '2024-03-20', time: null, timeZone: 'UTC',
      observer: null, houseSystem: 'WholeSign',
    });
    const moon = equinox.reading.placements.find(p => p.planetId === 'moon')!;
    expect(moon.status).toBe('confirmed-sign');
    expect(moon.title).toContain('Leo');
    expect(equinox.reading.balance?.elements.fire.bodies).toContain('Moon');
    expect(equinox.reading.balance?.elements.fire.bodies).toContain('Mercury');
    expect(equinox.reading.balance?.elements.fire.count).toBeGreaterThanOrEqual(2);

    const transition = buildRealReading({
      date: '2024-01-04', time: null, timeZone: 'UTC',
      observer: null, houseSystem: 'WholeSign',
    });
    expect(transition.reading.dateOnlyFacts?.moonPhaseChanged).toBe(true);
    expect(transition.reading.coreTrio.natalMoonPhase?.phaseLabel).toBe('Last Quarter → Waning Crescent');
    expect(transition.reading.coreTrio.natalMoonPhase?.synthesis).toContain('does not assign a single definitive natal Moon phase');
    expect(transition.reading.coreTrio.natalMoonPhase?.synthesis).not.toContain('a Last Quarter birth Moon is traditionally associated');
  });

  test('Blocker 3: relabels Whole Sign house-group emphasis without physical horizon claims while preserving Placidus and Porphyry axes (2024-01-03 Greenwich)', () => {
    const ws = buildRealReading({
      date: '2024-01-03', time: '12:00', timeZone: 'Europe/London',
      observer: { latitudeDeg: 51.4779, longitudeDeg: 0 }, houseSystem: 'WholeSign',
    });
    const wsHemi = ws.reading.themes.find(t => t.kind === 'hemisphere')!;
    expect(wsHemi).toBeDefined();
    expect(wsHemi.title).toBe('Whole Sign house-group emphasis');
    expect(wsHemi.factsSummary).toContain('8 of 10 planets in Houses 7–12 (Whole Sign upper houses)');
    expect(wsHemi.factsSummary).not.toMatch(/\babove the horizon\b/i);
    expect(wsHemi.synthesis).not.toMatch(/\babove the horizon\b/i);

    const pl = buildRealReading({
      date: '2024-01-03', time: '12:00', timeZone: 'Europe/London',
      observer: { latitudeDeg: 51.4779, longitudeDeg: 0 }, houseSystem: 'Placidus',
    });
    const plHemi = pl.reading.themes.find(t => t.kind === 'hemisphere')!;
    expect(plHemi).toBeDefined();
    expect(plHemi.factsSummary).toContain('7 of 10 planets in Southern (above the ASC–DSC horizon axis, Houses 7–12)');

    const polar = buildRealReading({
      date: '2024-01-03', time: '12:00', timeZone: 'Europe/London',
      observer: { latitudeDeg: 70.0, longitudeDeg: 0 }, houseSystem: 'Placidus',
    });
    expect(polar.reading.houseSystemLabel).toBe('Porphyry');
    const polarHemi = polar.reading.themes.find(t => t.kind === 'hemisphere');
    if (polarHemi) {
      expect(polarHemi.factsSummary).toContain('ASC–DSC');
    }
  });

  test('Blocker 4 edge case: preserves valid U5A redacted interpretations for integer coordinates and profile names matching astrological terms', () => {
    const built = buildRealReading({
      date: '2000-01-01', time: '12:00', timeZone: 'UTC',
      observer: { latitudeDeg: 10, longitudeDeg: 12 }, houseSystem: 'WholeSign', label: 'Leo',
    });
    const meanings = natalSymbolicMeanings(built.reading, built.chart.id);
    const snap = createSnapshotV0({
      engine: null,
      aspectRules: createAspectRuleSet(),
      charts: [built.chart],
      aspects: built.aspects,
      context: { selectedAt: null, referenceAt: null, eventSearch: null },
    }, { redactBirthDetails: true, includeRedactedNatalSynthesis: true });
    expect(snap.interpretations.length).toBe(meanings.length);
  });
});
