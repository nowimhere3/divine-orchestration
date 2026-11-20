import { Temporal } from '@js-temporal/polyfill';
import { angularSeparation, createAspectRuleSet, MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectId } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { PlanetId } from '../domain/chart';
import type { EngineInstant, EphemeraEngine } from '../engine/ephemera';
import { calculateMoonState, LUNAR_PHASE_LABELS, ZODIAC_SIGNS } from '../lunar';
import type { DateOnlyMoonSummary, LunarPhaseId, MoonState } from '../lunar';
import { albertaRule } from '../time/civil-zone';
import { instantFromTt } from '../time/ephemeris-time';
import { resolveBirthTime } from '../time/resolve';
import type { BirthTimeInput, ResolvedInstant } from '../time/resolve';
import { planetName, signPosition, wrapDegrees } from '../view/chart-data';
import type { DateOnlyAspectFact, DateOnlyNatalFacts, DateOnlyPlanetFact, DateOnlyUnavailableReason } from './types';

const ASPECT_IDS = Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[];
const GRID_STEPS = 24; // Hourly interior sampling across the full civil day.
const STATION_BISECT_ITERS = 18;
const GOLDEN_ITERS = 22;
const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;
const TIME_EPS = 1e-7; // ~8.6 ms in days

function signedArc(to: number, from: number): number {
  const delta = to - from;
  return delta >= 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
}

type DayBoundsResult =
  | { readonly status: 'ok'; readonly start: ResolvedInstant; readonly endExclusive: ResolvedInstant; readonly zoneLabel: string }
  | { readonly status: 'unavailable'; readonly reason: DateOnlyUnavailableReason; readonly zoneLabel: string };

function resolveUtcEpoch(epochMs: number, modelDeltaTSeconds: (year: number) => number) {
  const iso = new Date(epochMs).toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  return resolveBirthTime({ date, time, offsetOverride: '+00:00' }, modelDeltaTSeconds);
}

/**
 * Resolves the [start, next civil-day boundary) instants while honoring the
 * existing birth-time resolution contract:
 *  - Explicit `offsetOverride` takes precedence over `timeZone` (matching `resolveBirthTime`).
 *  - Skipped local civil dates (e.g. Pacific/Apia 2011-12-30) return `unavailable` rather
 *    than silently falling back to UTC.
 *  - Invalid dates, zones, or offsets return `unavailable` without silent fallback.
 */
function resolveDayBounds(engine: EphemeraEngine, birth: BirthTimeInput): DayBoundsResult {
  const fallbackZoneLabel = birth.timeZone ?? (birth.offsetOverride ? `UTC${birth.offsetOverride}` : 'UTC');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth.date) || birth.date.startsWith('0000')) {
    return { status: 'unavailable', reason: 'invalid-input', zoneLabel: fallbackZoneLabel };
  }
  let plainDate: Temporal.PlainDate;
  try {
    plainDate = Temporal.PlainDate.from(birth.date);
  } catch {
    return { status: 'unavailable', reason: 'invalid-input', zoneLabel: fallbackZoneLabel };
  }
  const nextDate = plainDate.add({ days: 1 });
  const resolvedBounds = (start: ReturnType<typeof resolveBirthTime>, endExclusive: ReturnType<typeof resolveBirthTime>, zoneLabel: string): DayBoundsResult =>
    start.kind === 'resolved' && endExclusive.kind === 'resolved' && start.jdTt < endExclusive.jdTt
      ? { status: 'ok', start, endExclusive, zoneLabel }
      : { status: 'unavailable', reason: 'invalid-input', zoneLabel };
  const fixedOffsetBounds = (offsetOverride: string, zoneLabel: string, timeZone?: string) => {
    const midnight = (date: string) => resolveBirthTime({
      date, time: '00:00:00', offsetOverride, ...(timeZone !== undefined ? { timeZone } : {}),
    }, engine.modelDeltaTSeconds);
    return resolvedBounds(midnight(birth.date), midnight(nextDate.toString()), zoneLabel);
  };

  // 1. Explicit offsetOverride takes precedence over timeZone (exact resolveBirthTime contract).
  if (birth.offsetOverride !== undefined) {
    const zoneLabel = birth.timeZone
      ? `${birth.timeZone} (recorded offset ${birth.offsetOverride})`
      : `UTC${birth.offsetOverride}`;
    return fixedOffsetBounds(birth.offsetOverride, zoneLabel, birth.timeZone);
  }

  // 2. Named IANA time zone (no offsetOverride).
  if (birth.timeZone !== undefined) {
    const tz = birth.timeZone;
    if (!/^[a-z][a-z0-9_+\-/]*$/i.test(tz)) {
      return { status: 'unavailable', reason: 'invalid-input', zoneLabel: tz };
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      return { status: 'unavailable', reason: 'invalid-input', zoneLabel: tz };
    }

    // Honor permanent Alberta Time (ABT, UTC-06:00) from 2026-11-01 onward.
    if (albertaRule(tz, birth.date)) {
      return fixedOffsetBounds('-06:00', tz);
    }

    try {
      const startZdt = plainDate.toZonedDateTime(tz);
      if (startZdt.toPlainDate().toString() !== birth.date) {
        // Entire calendar date was skipped by a time-zone transition (e.g. Pacific/Apia 2011-12-30).
        return { status: 'unavailable', reason: 'skipped-civil-date', zoneLabel: tz };
      }
      const nextDayStart = nextDate.toZonedDateTime(tz);
      return resolvedBounds(
        resolveUtcEpoch(startZdt.epochMilliseconds, engine.modelDeltaTSeconds),
        resolveUtcEpoch(nextDayStart.epochMilliseconds, engine.modelDeltaTSeconds),
        tz,
      );
    } catch {
      return { status: 'unavailable', reason: 'invalid-input', zoneLabel: tz };
    }
  }

  // 3. No time zone or offset supplied: evaluate UTC day honestly.
  return fixedOffsetBounds('+00:00', 'UTC');
}

interface BodySample {
  readonly tt: number;
  readonly lon: number;
  readonly speed: number;
  readonly retrograde: boolean;
}

function emptyMoonSummary(reason: string): DateOnlyMoonSummary {
  return {
    status: 'unavailable',
    phaseSummary: 'Unavailable',
    illuminationSummary: 'Unavailable',
    signSummary: 'Unavailable',
    signChanged: false,
    startState: null,
    endState: null,
    fullSummary: reason,
  };
}

function uniqueSorted(values: readonly number[], minSpacing = 0): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1] > minSpacing) out.push(v);
  }
  return out;
}

/** The ephemeris accepts positive IEEE-754 Julian days; use the closest instant inside the day. */
function lastInstantBefore(boundaryTt: number): number {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, boundaryTt);
  bits.setBigUint64(0, bits.getBigUint64(0) - 1n);
  return bits.getFloat64(0);
}

/**
 * Evaluates all ten bodies across the validated half-open civil-day interval
 * using hourly interior sampling, exact planetary station refinement, and golden-section
 * refinement of interior aspect orb extrema.
 */
export function calculateDateOnlyNatalFacts(
  engine: EphemeraEngine,
  birth: BirthTimeInput,
): DateOnlyNatalFacts {
  const bounds = resolveDayBounds(engine, birth);

  if (bounds.status === 'unavailable') {
    const msg = bounds.reason === 'skipped-civil-date'
      ? `The date ${birth.date} did not occur in ${bounds.zoneLabel}.`
      : 'Moon on birth date unavailable.';
    return {
      status: 'unavailable',
      unavailableReason: bounds.reason,
      birthDate: birth.date,
      zoneLabel: bounds.zoneLabel,
      planets: PLANET_IDS.map(planetId => ({
        planetId,
        status: 'unavailable',
        startSignIndex: null,
        endSignIndex: null,
        visitedSignIndices: [],
        startLongitudeDeg: null,
        endLongitudeDeg: null,
        minLongitudeDeg: null,
        maxLongitudeDeg: null,
        startFormatted: null,
        endFormatted: null,
        minFormatted: null,
        maxFormatted: null,
        retrogradeStart: null,
        retrogradeEnd: null,
        stationedDuringDay: false,
      })),
      confirmedAspects: [],
      moonSummary: emptyMoonSummary(msg),
      moonPhases: [],
      moonPhaseChanged: false,
    };
  }

  const startTt = bounds.start.jdTt;
  const endTt = lastInstantBefore(bounds.endExclusive.jdTt);
  const durationDays = endTt - startTt;
  const gridTts = Array.from({ length: GRID_STEPS + 1 }, (_, i) =>
    i === GRID_STEPS ? endTt : startTt + (durationDays * i) / GRID_STEPS,
  );

  const instantAt = (tt: number): EngineInstant => instantFromTt(tt, engine.modelDeltaTSeconds);

  const sampleCaches = new Map<PlanetId, Map<number, BodySample | null>>();
  const sampleBody = (planetId: PlanetId, tt: number): BodySample | null => {
    let cache = sampleCaches.get(planetId);
    if (!cache) {
      cache = new Map();
      sampleCaches.set(planetId, cache);
    }
    if (cache.has(tt)) return cache.get(tt)!;
    const res = engine.position(planetName(planetId), instantAt(tt));
    const val = res.status === 'ok'
      ? { tt, lon: wrapDegrees(res.value.longitude), speed: res.value.longitudeSpeed, retrograde: res.value.retrograde }
      : null;
    cache.set(tt, val);
    return val;
  };

  const stationTimesByPlanet = new Map<PlanetId, number[]>();
  const planets: DateOnlyPlanetFact[] = [];
  const availablePlanets: PlanetId[] = [];

  for (const planetId of PLANET_IDS) {
    const gridSamples = gridTts.map(tt => sampleBody(planetId, tt));
    if (gridSamples.some(s => s === null)) {
      planets.push({
        planetId,
        status: 'unavailable',
        startSignIndex: null,
        endSignIndex: null,
        visitedSignIndices: [],
        startLongitudeDeg: null,
        endLongitudeDeg: null,
        minLongitudeDeg: null,
        maxLongitudeDeg: null,
        startFormatted: null,
        endFormatted: null,
        minFormatted: null,
        maxFormatted: null,
        retrogradeStart: null,
        retrogradeEnd: null,
        stationedDuringDay: false,
      });
      continue;
    }

    availablePlanets.push(planetId);
    const validGrid = gridSamples as BodySample[];
    const stations: number[] = [];

    // 1. Check native engine station solver (for non-luminaries).
    if (planetId !== 'sun' && planetId !== 'moon' && durationDays > 0) {
      const st = engine.station(planetName(planetId), startTt, { direction: 1, maxDays: durationDays });
      if (st.status === 'ok' && st.value.jdTt >= startTt && st.value.jdTt <= endTt) {
        stations.push(st.value.jdTt);
      }
    }

    // 2. Also detect and bisect any speed sign change between hourly samples (handles synthetic stations too).
    for (let i = 0; i < validGrid.length - 1; i += 1) {
      const left = validGrid[i];
      const right = validGrid[i + 1];
      if (left.speed === 0) {
        stations.push(left.tt);
        continue;
      }
      if ((left.speed < 0 && right.speed > 0) || (left.speed > 0 && right.speed < 0)) {
        let a = left.tt;
        let b = right.tt;
        let fa = left.speed;
        for (let iter = 0; iter < STATION_BISECT_ITERS; iter += 1) {
          const mid = (a + b) / 2;
          const m = sampleBody(planetId, mid);
          if (!m) break;
          if (Math.abs(m.speed) < 1e-9 || b - a < TIME_EPS) {
            a = b = mid;
            break;
          }
          if ((fa < 0) === (m.speed < 0)) {
            a = mid;
            fa = m.speed;
          } else {
            b = mid;
          }
        }
        stations.push((a + b) / 2);
      }
    }

    const uniqueStations = uniqueSorted(stations, TIME_EPS);
    stationTimesByPlanet.set(planetId, uniqueStations);
    const trackTts = uniqueSorted([...gridTts, ...uniqueStations]);
    const track = trackTts.map(tt => sampleBody(planetId, tt)).filter((s): s is BodySample => s !== null);

    // Unwrap continuous ecliptic longitude along the full day track to capture exact interior extrema.
    let unwrapped = track[0].lon;
    let minUnwrapped = unwrapped;
    let maxUnwrapped = unwrapped;
    const signIndex = (lon: number) => Math.floor(lon / 30);
    const startSignIndex = signIndex(track[0].lon);
    const visitedSignIndices = [startSignIndex];
    let currentSign = startSignIndex;
    for (let i = 1; i < track.length; i += 1) {
      const motion = signedArc(track[i].lon, track[i - 1].lon);
      unwrapped += motion;
      if (unwrapped < minUnwrapped) minUnwrapped = unwrapped;
      if (unwrapped > maxUnwrapped) maxUnwrapped = unwrapped;
      const nextSign = signIndex(track[i].lon);
      const step = motion < 0 ? -1 : 1;
      while (currentSign !== nextSign) {
        currentSign = (currentSign + step + 12) % 12;
        visitedSignIndices.push(currentSign);
      }
    }

    const startSample = track[0];
    const endSample = track[track.length - 1];
    const minLon = wrapDegrees(minUnwrapped);
    const maxLon = wrapDegrees(maxUnwrapped);
    const stationedDuringDay = uniqueStations.some(t => t > startTt + TIME_EPS && t < endTt - TIME_EPS)
      || track.some(s => s.retrograde !== startSample.retrograde);

    planets.push({
      planetId,
      status: visitedSignIndices.length === 1 ? 'confirmed' : 'boundary-day',
      startSignIndex,
      endSignIndex: signIndex(endSample.lon),
      visitedSignIndices,
      startLongitudeDeg: startSample.lon,
      endLongitudeDeg: endSample.lon,
      minLongitudeDeg: minLon,
      maxLongitudeDeg: maxLon,
      startFormatted: signPosition(startSample.lon),
      endFormatted: signPosition(endSample.lon),
      minFormatted: signPosition(minLon),
      maxFormatted: signPosition(maxLon),
      retrogradeStart: startSample.retrograde,
      retrogradeEnd: endSample.retrograde,
      stationedDuringDay,
    });
  }

  // Confirmed non-Moon planetary aspects holding across the ENTIRE day [startTt, endTt].
  const { orbsDeg } = createAspectRuleSet();
  const nonMoon = availablePlanets.filter(id => id !== 'moon');
  const confirmedAspects: DateOnlyAspectFact[] = [];

  for (let i = 0; i < nonMoon.length; i += 1) {
    const from = nonMoon[i];
    for (let j = i + 1; j < nonMoon.length; j += 1) {
      const to = nonMoon[j];
      const pairTts = uniqueSorted([
        ...gridTts,
        ...(stationTimesByPlanet.get(from) ?? []),
        ...(stationTimesByPlanet.get(to) ?? []),
      ]);

      const sepAt = (tt: number): number | null => {
        const a = sampleBody(from, tt);
        const b = sampleBody(to, tt);
        return a && b ? angularSeparation(a.lon, b.lon) : null;
      };

      const seps = pairTts.map(sepAt);
      if (seps.some(s => s === null)) continue;
      const validSeps = seps as number[];

      // Helper to refine an interior extremum (min or max) of orb(t) = |sep(t) - targetAngle| via golden-section.
      const refineExtremum = (a0: number, b0: number, targetAngle: number, mode: 'min' | 'max'): number => {
        let a = a0;
        let b = b0;
        const f = (t: number) => {
          const s = sepAt(t);
          return s === null ? (mode === 'min' ? Infinity : -Infinity) : Math.abs(s - targetAngle);
        };
        let c = b - GOLDEN_RATIO * (b - a);
        let d = a + GOLDEN_RATIO * (b - a);
        let fc = f(c);
        let fd = f(d);
        for (let iter = 0; iter < GOLDEN_ITERS && b - a > TIME_EPS; iter += 1) {
          const chooseLeft = mode === 'min' ? fc < fd : fc > fd;
          if (chooseLeft) {
            b = d;
            d = c;
            fd = fc;
            c = b - GOLDEN_RATIO * (b - a);
            fc = f(c);
          } else {
            a = c;
            c = d;
            fc = fd;
            d = a + GOLDEN_RATIO * (b - a);
            fd = f(d);
          }
        }
        const mid = (a + b) / 2;
        const fm = f(mid);
        return mode === 'min' ? Math.min(fc, fd, fm) : Math.max(fc, fd, fm);
      };

      let chosen: { aspect: AspectId; minOrb: number; maxOrb: number } | undefined;

      for (const aspect of ASPECT_IDS) {
        const target = MAJOR_ASPECT_ANGLES[aspect];
        const allowed = orbsDeg[aspect];
        const residuals = validSeps.map(s => s - target);
        const orbs = residuals.map(Math.abs);

        let minOrb = Math.min(...orbs);
        let maxOrb = Math.max(...orbs);

        // Quick reject if any grid sample already exceeds the allowed orb.
        if (maxOrb > allowed) continue;

        // Check for exact sign-change crossings inside any interval (gives true minOrb = 0).
        for (let k = 0; k < residuals.length - 1; k += 1) {
          if (residuals[k] === 0 || residuals[k + 1] === 0 || (residuals[k] < 0) !== (residuals[k + 1] < 0)) {
            minOrb = 0;
            break;
          }
        }

        // Refine all interior local minima and maxima (and near-boundary peaks).
        for (let k = 1; k < orbs.length - 1; k += 1) {
          if (minOrb > 0 && orbs[k] <= orbs[k - 1] && orbs[k] <= orbs[k + 1]) {
            const refinedMin = refineExtremum(pairTts[k - 1], pairTts[k + 1], target, 'min');
            if (refinedMin < minOrb) minOrb = refinedMin;
          }
          if (orbs[k] >= orbs[k - 1] && orbs[k] >= orbs[k + 1]) {
            const refinedMax = refineExtremum(pairTts[k - 1], pairTts[k + 1], target, 'max');
            if (refinedMax > maxOrb) maxOrb = refinedMax;
          }
        }

        // Also check boundary intervals [0,1] and [n-2,n-1] for interior extrema near day edges.
        if (orbs.length >= 2) {
          if (minOrb > 0 && orbs[0] <= orbs[1]) {
            minOrb = Math.min(minOrb, refineExtremum(pairTts[0], pairTts[1], target, 'min'));
          }
          if (orbs[0] > allowed - 0.1 || orbs[1] > allowed - 0.1) {
            maxOrb = Math.max(maxOrb, refineExtremum(pairTts[0], pairTts[1], target, 'max'));
          }
          const last = orbs.length - 1;
          if (minOrb > 0 && orbs[last] <= orbs[last - 1]) {
            minOrb = Math.min(minOrb, refineExtremum(pairTts[last - 1], pairTts[last], target, 'min'));
          }
          if (orbs[last] > allowed - 0.1 || orbs[last - 1] > allowed - 0.1) {
            maxOrb = Math.max(maxOrb, refineExtremum(pairTts[last - 1], pairTts[last], target, 'max'));
          }
        }

        if (maxOrb <= allowed && (!chosen || maxOrb < chosen.maxOrb)) {
          chosen = { aspect, minOrb, maxOrb };
        }
      }

      if (!chosen) continue;
      confirmedAspects.push({
        id: JSON.stringify(['date-only', from, to, chosen.aspect]),
        from,
        to,
        aspect: chosen.aspect,
        exactAngleDeg: MAJOR_ASPECT_ANGLES[chosen.aspect],
        minOrbDeg: chosen.minOrb,
        maxOrbDeg: chosen.maxOrb,
        allowedOrbDeg: orbsDeg[chosen.aspect],
      });
    }
  }

  confirmedAspects.sort((a, b) => a.maxOrbDeg - b.maxOrbDeg || a.id.localeCompare(b.id));

  // Full-day Moon state & phase stability over the exact same validated civil day.
  const moonStates: MoonState[] = [];
  for (const tt of gridTts) {
    const res = calculateMoonState(engine, instantAt(tt));
    if (res.status === 'ok') moonStates.push(res.value);
  }
  const moonPhases: LunarPhaseId[] = [];
  for (const state of moonStates) {
    if (moonPhases[moonPhases.length - 1] !== state.phase) moonPhases.push(state.phase);
  }
  const moonPhaseChanged = moonPhases.length > 1;

  let moonSummary: DateOnlyMoonSummary;
  if (moonStates.length === gridTts.length && moonStates.length >= 2) {
    const s = moonStates[0];
    const e = moonStates[moonStates.length - 1];
    const moonPlanet = planets.find(p => p.planetId === 'moon');
    const signChanged = moonPlanet ? moonPlanet.status === 'boundary-day' : s.signIndex !== e.signIndex;
    const minIllum = Math.round(Math.min(...moonStates.map(m => m.illuminationPercent)));
    const maxIllum = Math.round(Math.max(...moonStates.map(m => m.illuminationPercent)));
    const illuminationSummary = minIllum === maxIllum ? `${minIllum}% lit` : `${minIllum}%–${maxIllum}% lit`;
    const phaseSummary = moonPhases.map(p => LUNAR_PHASE_LABELS[p]).join(' → ');
    const signRangeNames = moonPlanet && moonPlanet.visitedSignIndices.length > 1
      ? moonPlanet.visitedSignIndices.map(idx => ZODIAC_SIGNS[idx]).join(' → ')
      : s.signName;
    const signSummary = `${signRangeNames} (${moonPlanet?.minFormatted ?? s.formattedPosition} to ${moonPlanet?.maxFormatted ?? e.formattedPosition})`;
    moonSummary = {
      status: 'ok',
      phaseSummary,
      illuminationSummary,
      signSummary,
      signChanged,
      startState: s,
      endState: e,
      fullSummary: `Moon on birth date: ${phaseSummary} · ${illuminationSummary} · ${signSummary} (birth time unknown; exact degree & local sky unavailable)`,
    };
  } else {
    moonSummary = emptyMoonSummary('Moon on birth date unavailable (outside ephemeris coverage).');
  }

  const anyAvailable = availablePlanets.length > 0;
  return {
    status: anyAvailable ? 'ok' : 'unavailable',
    ...(anyAvailable ? {} : { unavailableReason: 'outside-coverage' as const }),
    birthDate: birth.date,
    zoneLabel: bounds.zoneLabel,
    planets,
    confirmedAspects,
    moonSummary,
    moonPhases,
    moonPhaseChanged,
  };
}
