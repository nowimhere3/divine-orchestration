import { Body, HouseSystem, fromWasm } from '@astrologer/ephemera/ephemeris.mjs';
import type { Position } from '@astrologer/ephemera';

export const EPHEMERA_COVERAGE_TT = Object.freeze({
  start: 2287185.5, // 1550-01-01, proleptic Gregorian
  end: 2688955.5, // 2650-01-04, last endpoint of the bundled Pluto fit
});

const engine = Object.freeze({
  name: 'Ephemera',
  version: '0.4.1',
  dataMode: '1as',
  frame: 'apparent geocentric tropical ecliptic of date',
} as const);

const planets = {
  Sun: Body.Sun, Moon: Body.Moon, Mercury: Body.Mercury, Venus: Body.Venus,
  Mars: Body.Mars, Jupiter: Body.Jupiter, Saturn: Body.Saturn,
  Uranus: Body.Uranus, Neptune: Body.Neptune, Pluto: Body.Pluto,
} as const;

export type PlanetName = keyof typeof planets;
export type HouseSystemName = keyof typeof HouseSystem;

/** Resolved by the caller. UT means UT1, and deltaTYear is the fractional model year. */
export interface EngineInstant {
  readonly jdUt: number;
  readonly jdTt: number;
  readonly deltaTYear: number;
}

export interface Observer {
  readonly longitudeDeg: number; // East positive
  readonly latitudeDeg: number; // North positive
}

export interface SearchOptions {
  /** Chronological direction, independent of the body's direction of motion. */
  readonly direction: 1 | -1;
  readonly maxDays: number;
}

export type EngineWarning =
  | 'near-coverage-edge'
  | 'polar-house-fallback'
  | 'search-clamped-to-coverage'
  | 'crossing-uses-modeled-delta-t';

export type UnavailableReason =
  | 'invalid-input'
  | 'outside-coverage'
  | 'unsupported-body'
  | 'calculation-unavailable'
  | 'no-event-returned';

export type EngineResult<Value, Settings> = {
  readonly engine: typeof engine;
  readonly settings: Readonly<Settings>;
  readonly warnings: readonly EngineWarning[];
} & (
  | { readonly status: 'ok'; readonly value: Value }
  | { readonly status: 'unavailable'; readonly reason: UnavailableReason }
);

export type PlanetPosition = Readonly<Position & { retrograde: boolean }>;

export interface BodyPhenomena {
  readonly phaseAngleDeg: number;
  /** Illuminated fraction of the apparent disk, 0..1. */
  readonly illumination: number;
  /** 3D angular separation from the Sun, 0..180 degrees. */
  readonly elongationDeg: number;
  /** Apparent angular diameter, degrees. */
  readonly diameterDeg: number;
  readonly magnitude: number;
}

export interface EquatorialCoordinates {
  readonly rightAscensionDeg: number;
  readonly declinationDeg: number;
}

export interface HouseCusps {
  /** Twelve tropical longitudes in degrees, with house one at index zero. */
  readonly cuspsDeg: readonly number[];
  readonly ascendantDeg: number;
  readonly midheavenDeg: number;
  readonly effectiveSystem: HouseSystemName;
  readonly fallback: boolean;
}

interface SearchSettings extends SearchOptions {
  readonly body: string;
  readonly searchedDays: number;
}

export interface EphemeraEngine {
  /** Ephemera's modeled TT minus UT1, in seconds. Civil-time resolution belongs to the caller. */
  modelDeltaTSeconds(deltaTYear: number): number;
  position(body: string, instant: EngineInstant): EngineResult<PlanetPosition, EngineInstant & { body: string }>;
  houses(instant: EngineInstant, observer: Observer, requestedSystem: HouseSystemName):
    EngineResult<HouseCusps, EngineInstant & Observer & { requestedSystem: HouseSystemName }>;
  crossing(body: string, longitudeDeg: number, jdUt: number, options: SearchOptions):
    EngineResult<{ readonly jdUt: number }, SearchSettings & { jdUt: number; longitudeDeg: number }>;
  station(body: string, jdTt: number, options: SearchOptions):
    EngineResult<{ readonly jdTt: number; readonly turns: 'retrograde' | 'direct' }, SearchSettings & { jdTt: number }>;
  phenomena(body: string, instant: EngineInstant):
    EngineResult<BodyPhenomena, EngineInstant & { body: string }>;
  topocentric(body: string, instant: EngineInstant, observer: Observer, elevationM?: number):
    EngineResult<PlanetPosition, EngineInstant & Observer & { body: string; elevationM: number }>;
  siderealTime(instant: EngineInstant):
    EngineResult<{ readonly gastDeg: number }, EngineInstant>;
  equatorial(longitudeDeg: number, latitudeDeg: number, instant: EngineInstant):
    EngineResult<EquatorialCoordinates, EngineInstant & { longitudeDeg: number; latitudeDeg: number }>;
}

function unavailable<Settings>(settings: Settings, warnings: readonly EngineWarning[], reason: UnavailableReason) {
  return { engine, settings, warnings, status: 'unavailable', reason } as const;
}

function calculated<Value, Settings>(settings: Settings, warnings: readonly EngineWarning[], value: Value) {
  return { engine, settings, warnings, status: 'ok', value } as const;
}

function positionBody(body: string) {
  return Object.hasOwn(planets, body) ? planets[body as PlanetName] : undefined;
}

function within(jd: number, coverage: { start: number; end: number }) {
  return jd >= coverage.start && jd <= coverage.end;
}

function edgeWarnings(jd: number, coverage: { start: number; end: number } = EPHEMERA_COVERAGE_TT): EngineWarning[] {
  return within(jd, coverage) && Math.min(jd - coverage.start, coverage.end - jd) < 365
    ? ['near-coverage-edge']
    : [];
}

function invalidInstant(instant: EngineInstant): UnavailableReason | undefined {
  if (![instant.jdUt, instant.jdTt, instant.deltaTYear].every(Number.isFinite)) return 'invalid-input';
  if (!within(instant.jdTt, EPHEMERA_COVERAGE_TT)) return 'outside-coverage';
}

function searchWindow(jd: number, { direction, maxDays }: SearchOptions, coverage: { start: number; end: number }) {
  const warnings = edgeWarnings(jd, coverage);
  if (!Number.isFinite(jd) || !Number.isFinite(maxDays) || maxDays <= 0 || (direction !== 1 && direction !== -1)) {
    return { searchedDays: 0, warnings, reason: 'invalid-input' } as const;
  }
  if (!within(jd, coverage)) return { searchedDays: 0, warnings, reason: 'outside-coverage' } as const;

  const availableDays = direction === 1 ? coverage.end - jd : jd - coverage.start;
  const searchedDays = Math.min(maxDays, availableDays);
  if (searchedDays < maxDays) warnings.push('search-clamped-to-coverage');
  return { searchedDays, warnings };
}

function inSearchWindow(eventJd: number, startJd: number, direction: 1 | -1, days: number) {
  const endJd = startJd + direction * days;
  return within(eventJd, { start: Math.min(startJd, endJd), end: Math.max(startJd, endJd) });
}

/** Instantiate a private engine from the approved package's embedded 1as WASM bytes. */
export async function createEphemeraEngine(wasm: BufferSource | WebAssembly.Module): Promise<EphemeraEngine> {
  const eph = await fromWasm(wasm);
  // Match the native UT crossing search's fractional-year convention at the data boundaries.
  const coverageUt = {
    start: boundaryUt(EPHEMERA_COVERAGE_TT.start),
    end: boundaryUt(EPHEMERA_COVERAGE_TT.end),
  };

  function boundaryUt(jdTt: number) {
    const { year } = eph.calendarDate(jdTt);
    return eph.ttToUt(jdTt, year + (jdTt - eph.julianDate(year, 1, 1)) / 365.25);
  }

  return {
    modelDeltaTSeconds(deltaTYear) {
      if (!Number.isFinite(deltaTYear)) throw new RangeError('Delta-T model year must be finite.');
      return eph.deltaT(deltaTYear);
    },

    position(body, instant) {
      const settings = { ...instant, body };
      const warnings = edgeWarnings(instant.jdTt);
      const invalid = invalidInstant(instant);
      if (invalid) return unavailable(settings, warnings, invalid);
      const id = positionBody(body);
      if (id === undefined) return unavailable(settings, warnings, 'unsupported-body');

      // Use the resolved TT supplied by the caller, preserving even an observed Delta-T.
      const position = eph.positionTT(id, instant.jdTt, { apparent: true });
      if (!position || !Object.values(position).every(Number.isFinite)) {
        return unavailable(settings, warnings, 'calculation-unavailable');
      }
      return calculated(settings, warnings, { ...position, retrograde: position.longitudeSpeed < 0 });
    },

    houses(instant, observer, requestedSystem) {
      const settings = { ...instant, ...observer, requestedSystem };
      const warnings = edgeWarnings(instant.jdTt);
      const invalid = invalidInstant(instant);
      if (invalid) return unavailable(settings, warnings, invalid);
      const { latitudeDeg, longitudeDeg } = observer;
      if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) >= 90 ||
          !Number.isFinite(longitudeDeg) || Math.abs(longitudeDeg) > 180 ||
          !Object.hasOwn(HouseSystem, requestedSystem)) {
        return unavailable(settings, warnings, 'invalid-input');
      }

      const result = eph.housesInfo(instant.jdUt, longitudeDeg, latitudeDeg, HouseSystem[requestedSystem]);
      if (!result || result.cusps.length !== 12 || !result.cusps.every(Number.isFinite)) {
        return unavailable(settings, warnings, 'calculation-unavailable');
      }
      const { asc, mc } = eph.ascMc(instant.jdUt, longitudeDeg, latitudeDeg);
      if (!Number.isFinite(asc) || !Number.isFinite(mc)) {
        return unavailable(settings, warnings, 'calculation-unavailable');
      }
      if (result.fallback) warnings.push('polar-house-fallback');
      return calculated(settings, warnings, {
        cuspsDeg: result.cusps,
        ascendantDeg: asc,
        midheavenDeg: mc,
        effectiveSystem: result.fallback ? 'Porphyry' : requestedSystem,
        fallback: result.fallback,
      });
    },

    crossing(body, longitudeDeg, jdUt, options) {
      const { searchedDays, warnings, reason } = searchWindow(jdUt, options, coverageUt);
      const settings = { ...options, body, longitudeDeg, jdUt, searchedDays };
      if (reason) return unavailable(settings, warnings, reason);
      if (!Number.isFinite(longitudeDeg) || longitudeDeg < 0 || longitudeDeg >= 360) {
        return unavailable(settings, warnings, 'invalid-input');
      }
      const id = positionBody(body);
      if (id === undefined) return unavailable(settings, warnings, 'unsupported-body');
      if (!searchedDays) return unavailable(settings, warnings, 'no-event-returned');

      warnings.push('crossing-uses-modeled-delta-t');
      const event = eph.longitudeCrossing(id, longitudeDeg, jdUt, options.direction, searchedDays);
      return event === null || !inSearchWindow(event, jdUt, options.direction, searchedDays)
        ? unavailable(settings, warnings, 'no-event-returned')
        : calculated(settings, warnings, { jdUt: event });
    },

    station(body, jdTt, options) {
      const { searchedDays, warnings, reason } = searchWindow(jdTt, options, EPHEMERA_COVERAGE_TT);
      const settings = { ...options, body, jdTt, searchedDays };
      if (reason) return unavailable(settings, warnings, reason);
      const id = positionBody(body);
      if (id === undefined || body === 'Sun' || body === 'Moon') {
        return unavailable(settings, warnings, 'unsupported-body');
      }
      if (!searchedDays) return unavailable(settings, warnings, 'no-event-returned');

      const event = eph.station(id, jdTt, options.direction, searchedDays);
      return !event || !inSearchWindow(event.jd, jdTt, options.direction, searchedDays)
        ? unavailable(settings, warnings, 'no-event-returned')
        : calculated(settings, warnings, { jdTt: event.jd, turns: event.turns });
    },

    phenomena(body, instant) {
      const settings = { ...instant, body };
      const warnings = edgeWarnings(instant.jdTt);
      const invalid = invalidInstant(instant);
      if (invalid) return unavailable(settings, warnings, invalid);
      const id = positionBody(body);
      if (id === undefined) return unavailable(settings, warnings, 'unsupported-body');

      const result = eph.phenomena(id, instant.jdTt);
      if (!result || !Object.values(result).every(Number.isFinite)) {
        return unavailable(settings, warnings, 'calculation-unavailable');
      }
      return calculated(settings, warnings, {
        phaseAngleDeg: result.phaseAngle,
        illumination: result.phase,
        elongationDeg: result.elongation,
        diameterDeg: result.diameter,
        magnitude: result.magnitude,
      });
    },

    topocentric(body, instant, observer, elevationM = 0) {
      const settings = { ...instant, ...observer, body, elevationM };
      const warnings = edgeWarnings(instant.jdTt);
      const invalid = invalidInstant(instant);
      if (invalid) return unavailable(settings, warnings, invalid);
      const { latitudeDeg, longitudeDeg } = observer;
      if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) > 90 ||
          !Number.isFinite(longitudeDeg) || Math.abs(longitudeDeg) > 180 ||
          !Number.isFinite(elevationM)) {
        return unavailable(settings, warnings, 'invalid-input');
      }
      const id = positionBody(body);
      if (id === undefined) return unavailable(settings, warnings, 'unsupported-body');

      const position = eph.topocentric(id, instant.jdUt, longitudeDeg, latitudeDeg, elevationM, {
        year: instant.deltaTYear,
      });
      if (!position || !Object.values(position).every(Number.isFinite)) {
        return unavailable(settings, warnings, 'calculation-unavailable');
      }
      return calculated(settings, warnings, { ...position, retrograde: position.longitudeSpeed < 0 });
    },

    siderealTime(instant) {
      const warnings = edgeWarnings(instant.jdTt);
      const invalid = invalidInstant(instant);
      if (invalid) return unavailable(instant, warnings, invalid);
      const gastDeg = eph.siderealTime(instant.jdUt);
      if (!Number.isFinite(gastDeg)) {
        return unavailable(instant, warnings, 'calculation-unavailable');
      }
      return calculated(instant, warnings, { gastDeg });
    },

    equatorial(longitudeDeg, latitudeDeg, instant) {
      const settings = { ...instant, longitudeDeg, latitudeDeg };
      const warnings = edgeWarnings(instant.jdTt);
      const invalid = invalidInstant(instant);
      if (invalid) return unavailable(settings, warnings, invalid);
      if (!Number.isFinite(longitudeDeg) || !Number.isFinite(latitudeDeg)) {
        return unavailable(settings, warnings, 'invalid-input');
      }
      const result = eph.eclipticToEquatorial(longitudeDeg, latitudeDeg, instant.jdTt);
      if (!result || !Number.isFinite(result.rightAscension) || !Number.isFinite(result.declination)) {
        return unavailable(settings, warnings, 'calculation-unavailable');
      }
      return calculated(settings, warnings, {
        rightAscensionDeg: result.rightAscension,
        declinationDeg: result.declination,
      });
    },
  };
}
