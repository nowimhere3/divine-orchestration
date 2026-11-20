import { EPHEMERA_COVERAGE_TT } from '../engine/ephemera';
import type { EngineInstant, EngineResult, EngineWarning, EphemeraEngine, Observer } from '../engine/ephemera';
import { localClock } from '../time/civil-zone';
import { signPosition, wrapDegrees } from '../view/chart-data';
import { jdTtToResolvedTime, wrap180 } from './events';
import { AU_IN_KM, ZODIAC_SIGNS } from './phase';
import type { ZodiacSignName } from './phase';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const SECONDS_PER_DAY = 86_400;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;
const STANDARD_HORIZON_REFRACTION_DEG = 0.5667; // 34 arcminutes

export type VisibilityState = 'above-horizon' | 'near-horizon' | 'below-horizon';

export const VISIBILITY_LABELS: Readonly<Record<VisibilityState, string>> = {
  'above-horizon': 'Above horizon',
  'near-horizon': 'Near horizon',
  'below-horizon': 'Below horizon',
};

/**
 * Sæmundsson's standard atmospheric refraction formula (Meeus Ch. 16, eq. 16.4),
 * taking true/geometric topocentric altitude h_geom in degrees (for h_geom >= -1°).
 * Returns refraction in degrees to add to geometric altitude.
 */
export function saemundssonRefractionDeg(geometricAltitudeDeg: number): number {
  if (!Number.isFinite(geometricAltitudeDeg) || geometricAltitudeDeg < -1) return 0;
  if (geometricAltitudeDeg >= 89.9) return 0;
  const argDeg = geometricAltitudeDeg + 10.3 / (geometricAltitudeDeg + 5.11);
  const rArcmin = 1.02 / Math.tan(argDeg * DEG_TO_RAD);
  return Math.max(0, rArcmin / 60);
}

export function classifyHorizonVisibility(
  geometricAltitudeDeg: number,
  apparentAltitudeDeg: number,
  semiDiameterDeg: number,
): { readonly visibility: VisibilityState; readonly visibilityLabel: string; readonly aboveHorizon: boolean } {
  // Upper limb clears standard refracted horizon when h_geom > -(R_0 + s)
  const upperLimbAbove = geometricAltitudeDeg > -(STANDARD_HORIZON_REFRACTION_DEG + semiDiameterDeg);
  let visibility: VisibilityState;
  if (Math.abs(geometricAltitudeDeg) <= 1 || (upperLimbAbove && apparentAltitudeDeg < 1)) {
    visibility = 'near-horizon';
  } else if (upperLimbAbove) {
    visibility = 'above-horizon';
  } else {
    visibility = 'below-horizon';
  }
  return {
    visibility,
    visibilityLabel: VISIBILITY_LABELS[visibility],
    aboveHorizon: upperLimbAbove,
  };
}

export interface UpperTransitEvent {
  readonly jdUt: number;
  readonly jdTt: number;
  readonly epochMs: number;
  readonly utc: string | null;
  readonly historicalUt1Iso: string | null;
  readonly culminationGeometricAltitudeDeg: number;
  readonly culminationApparentAltitudeDeg: number;
  readonly culminationAboveHorizon: boolean;
}

export interface MoonSkyState {
  readonly observer: Observer;
  readonly geocentricLongitudeDeg: number;
  readonly geocentricLatitudeDeg: number;
  readonly geocentricSignIndex: number;
  readonly geocentricSignName: ZodiacSignName;
  readonly geocentricFormatted: string;
  readonly topocentricLongitudeDeg: number;
  readonly topocentricLatitudeDeg: number;
  readonly topocentricDistanceAu: number;
  readonly topocentricDistanceKm: number;
  readonly topocentricSignIndex: number;
  readonly topocentricSignName: ZodiacSignName;
  readonly topocentricFormatted: string;
  /** Signed parallax longitude shift (λ_topo − λ_geo) in degrees. */
  readonly parallaxDeltaLonDeg: number;
  /** Signed parallax latitude shift (β_topo − β_geo) in degrees. */
  readonly parallaxDeltaLatDeg: number;
  readonly signDiffers: boolean;
  readonly signDifferenceNote: string | null;
  readonly rightAscensionDeg: number;
  readonly declinationDeg: number;
  readonly localSiderealTimeDeg: number;
  readonly hourAngleDeg: number;
  readonly geometricAltitudeDeg: number;
  readonly refractionDeg: number;
  readonly apparentAltitudeDeg: number;
  readonly azimuthDeg: number;
  readonly semiDiameterDeg: number;
  readonly visibility: VisibilityState;
  readonly visibilityLabel: string;
  readonly aboveHorizon: boolean;
  /** Upper meridian passage falling on the selected instant's local calendar date in displayZone (null if lunar-day gap). */
  readonly localDateTransit: UpperTransitEvent | null;
  /** Next upper meridian passage at or after the selected instant. */
  readonly nextTransit: UpperTransitEvent | null;
  /** Nearest upper meridian passage to the selected instant. */
  readonly nearestTransit: UpperTransitEvent | null;
  readonly warnings: readonly EngineWarning[];
}

function formatSignedDegrees(deltaDeg: number): string {
  const sign = deltaDeg >= 0 ? '+' : '−';
  return `${sign}${Math.abs(deltaDeg).toFixed(2)}°`;
}

function localDateInZone(epochMs: number, zone: string): string {
  if (zone === 'UTC') return new Date(epochMs).toISOString().slice(0, 10);
  try {
    return localClock(epochMs, zone).date;
  } catch {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
}

function evaluateHourAngleAtUt(
  engine: EphemeraEngine,
  jdUt: number,
  deltaTYearHint: number,
  observer: Observer,
): { hourAngleDeg: number; jdTt: number } | null {
  const deltaT = engine.modelDeltaTSeconds(deltaTYearHint);
  const jdTt = jdUt + deltaT / SECONDS_PER_DAY;
  if (jdTt < EPHEMERA_COVERAGE_TT.start || jdTt > EPHEMERA_COVERAGE_TT.end) return null;
  const instant: EngineInstant = { jdUt, jdTt, deltaTYear: deltaTYearHint };
  // At upper meridian passage (H = 0), sin(H) = 0 so topocentric RA equals geocentric RA.
  const geo = engine.position('Moon', instant);
  if (geo.status !== 'ok') return null;
  const eq = engine.equatorial(geo.value.longitude, geo.value.latitude, instant);
  if (eq.status !== 'ok') return null;
  const st = engine.siderealTime(instant);
  if (st.status !== 'ok') return null;
  const lst = wrapDegrees(st.value.gastDeg + observer.longitudeDeg);
  return {
    hourAngleDeg: wrap180(lst - eq.value.rightAscensionDeg),
    jdTt,
  };
}

function buildUpperTransitEvent(
  engine: EphemeraEngine,
  jdUt: number,
  deltaTYearHint: number,
  observer: Observer,
  semiDiameterDeg: number,
): UpperTransitEvent | null {
  const deltaT = engine.modelDeltaTSeconds(deltaTYearHint);
  const jdTt = jdUt + deltaT / SECONDS_PER_DAY;
  const resolved = jdTtToResolvedTime(engine, jdTt);
  const transitInstant: EngineInstant = {
    jdUt,
    jdTt,
    deltaTYear: resolved.instant.deltaTYear,
  };
  const topo = engine.topocentric('Moon', transitInstant, observer);
  if (topo.status !== 'ok') return null;
  const eq = engine.equatorial(topo.value.longitude, topo.value.latitude, transitInstant);
  if (eq.status !== 'ok') return null;
  const st = engine.siderealTime(transitInstant);
  if (st.status !== 'ok') return null;

  const lst = wrapDegrees(st.value.gastDeg + observer.longitudeDeg);
  const H = wrap180(lst - eq.value.rightAscensionDeg) * DEG_TO_RAD;
  const phi = observer.latitudeDeg * DEG_TO_RAD;
  const dec = eq.value.declinationDeg * DEG_TO_RAD;
  const sinAlt = Math.max(-1, Math.min(1, Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)));
  const geomAlt = Math.asin(sinAlt) * RAD_TO_DEG;
  const appAlt = geomAlt + saemundssonRefractionDeg(geomAlt);
  const vis = classifyHorizonVisibility(geomAlt, appAlt, semiDiameterDeg);

  return {
    jdUt,
    jdTt,
    epochMs: resolved.epochMs,
    utc: resolved.utc,
    historicalUt1Iso: resolved.historicalUt1Iso,
    culminationGeometricAltitudeDeg: geomAlt,
    culminationApparentAltitudeDeg: appAlt,
    culminationAboveHorizon: vis.aboveHorizon,
  };
}

/**
 * Finds all upper meridian passages (H = 0 with rising H) in [jdUt - windowDays, jdUt + windowDays].
 */
export function findUpperTransitsInWindow(
  engine: EphemeraEngine,
  instant: EngineInstant,
  observer: Observer,
  semiDiameterDeg = 0.26,
  windowDays = 1.25,
): readonly UpperTransitEvent[] {
  const stepDays = 2 / 24; // 2-hour sampling (~29° of hour angle per step)
  const startUt = instant.jdUt - windowDays;
  const endUt = instant.jdUt + windowDays;
  const samples: { t: number; h: number }[] = [];

  for (let t = startUt; t <= endUt + 1e-9; t += stepDays) {
    const yearHint = instant.deltaTYear + (t - instant.jdUt) / 365.2425;
    const sample = evaluateHourAngleAtUt(engine, t, yearHint, observer);
    if (sample) samples.push({ t, h: sample.hourAngleDeg });
  }

  const events: UpperTransitEvent[] = [];
  for (let i = 0; i < samples.length - 1; i += 1) {
    let a = samples[i].t;
    let b = samples[i + 1].t;
    let ha = samples[i].h;
    let hb = samples[i + 1].h;

    // Upper meridian passage crosses smoothly from H <= 0 to H >= 0 (never the +180 -> -180 lower transit jump).
    if (ha <= 0 && hb >= 0 && (hb - ha) < 90) {
      let root = a === b ? a : a - ha * (b - a) / (hb - ha);
      for (let iter = 0; iter < 8; iter += 1) {
        const yearHint = instant.deltaTYear + (root - instant.jdUt) / 365.2425;
        const cur = evaluateHourAngleAtUt(engine, root, yearHint, observer);
        if (!cur) break;
        const h = cur.hourAngleDeg;
        if (Math.abs(h) < 1e-5 || (b - a) < 1e-8) break;
        if (h < 0) {
          a = root;
          ha = h;
        } else {
          b = root;
          hb = h;
        }
        const secant = a - ha * (b - a) / (hb - ha);
        root = secant > a + 1e-9 && secant < b - 1e-9 ? secant : (a + b) / 2;
      }

      if (!events.some(existing => Math.abs(existing.jdUt - root) < 0.01)) {
        const yearHint = instant.deltaTYear + (root - instant.jdUt) / 365.2425;
        const event = buildUpperTransitEvent(engine, root, yearHint, observer, semiDiameterDeg);
        if (event) events.push(event);
      }
    }
  }

  return events.sort((x, y) => x.jdUt - y.jdUt);
}

export function calculateMoonSky(
  engine: EphemeraEngine,
  instant: EngineInstant,
  observer: Observer,
  displayZone = 'UTC',
): EngineResult<MoonSkyState, EngineInstant & Observer & { displayZone: string }> {
  const settings = { ...instant, ...observer, displayZone };
  const geoRes = engine.position('Moon', instant);
  if (geoRes.status === 'unavailable') {
    return {
      engine: geoRes.engine,
      settings,
      warnings: geoRes.warnings,
      status: 'unavailable',
      reason: geoRes.reason,
    };
  }
  const topoRes = engine.topocentric('Moon', instant, observer);
  if (topoRes.status === 'unavailable') {
    return {
      engine: topoRes.engine,
      settings,
      warnings: topoRes.warnings,
      status: 'unavailable',
      reason: topoRes.reason,
    };
  }
  const phenRes = engine.phenomena('Moon', instant);
  if (phenRes.status === 'unavailable') {
    return {
      engine: phenRes.engine,
      settings,
      warnings: phenRes.warnings,
      status: 'unavailable',
      reason: phenRes.reason,
    };
  }
  const eqRes = engine.equatorial(topoRes.value.longitude, topoRes.value.latitude, instant);
  if (eqRes.status === 'unavailable') {
    return {
      engine: eqRes.engine,
      settings,
      warnings: eqRes.warnings,
      status: 'unavailable',
      reason: eqRes.reason,
    };
  }
  const stRes = engine.siderealTime(instant);
  if (stRes.status === 'unavailable') {
    return {
      engine: stRes.engine,
      settings,
      warnings: stRes.warnings,
      status: 'unavailable',
      reason: stRes.reason,
    };
  }

  const warnings = [
    ...new Set([
      ...geoRes.warnings,
      ...topoRes.warnings,
      ...phenRes.warnings,
      ...eqRes.warnings,
      ...stRes.warnings,
    ]),
  ];

  const geocentricLongitudeDeg = wrapDegrees(geoRes.value.longitude);
  const geocentricLatitudeDeg = geoRes.value.latitude;
  const geocentricSignIndex = Math.floor(geocentricLongitudeDeg / 30) % 12;
  const geocentricSignName = ZODIAC_SIGNS[geocentricSignIndex];
  const geocentricFormatted = signPosition(geocentricLongitudeDeg);

  const topocentricLongitudeDeg = wrapDegrees(topoRes.value.longitude);
  const topocentricLatitudeDeg = topoRes.value.latitude;
  const topocentricSignIndex = Math.floor(topocentricLongitudeDeg / 30) % 12;
  const topocentricSignName = ZODIAC_SIGNS[topocentricSignIndex];
  const topocentricFormatted = signPosition(topocentricLongitudeDeg);

  const parallaxDeltaLonDeg = wrap180(topocentricLongitudeDeg - geocentricLongitudeDeg);
  const parallaxDeltaLatDeg = topocentricLatitudeDeg - geocentricLatitudeDeg;
  const signDiffers = topocentricSignIndex !== geocentricSignIndex;
  const signDifferenceNote = signDiffers
    ? `Local parallax (${formatSignedDegrees(parallaxDeltaLonDeg)}) shifts the topocentric Moon across the sign boundary into ${topocentricSignName} (${topocentricFormatted}), while the geocentric chart Moon is in ${geocentricSignName} (${geocentricFormatted}). All chart wheel positions, aspects and exports stay geocentric.`
    : null;

  const rightAscensionDeg = wrapDegrees(eqRes.value.rightAscensionDeg);
  const declinationDeg = eqRes.value.declinationDeg;
  const localSiderealTimeDeg = wrapDegrees(stRes.value.gastDeg + observer.longitudeDeg);
  const hourAngleDeg = wrap180(localSiderealTimeDeg - rightAscensionDeg);

  const phiRad = observer.latitudeDeg * DEG_TO_RAD;
  const decRad = declinationDeg * DEG_TO_RAD;
  const hRad = hourAngleDeg * DEG_TO_RAD;

  const sinAlt = Math.max(
    -1,
    Math.min(1, Math.sin(phiRad) * Math.sin(decRad) + Math.cos(phiRad) * Math.cos(decRad) * Math.cos(hRad)),
  );
  const geometricAltitudeDeg = Math.asin(sinAlt) * RAD_TO_DEG;
  const azimuthDeg = wrapDegrees(
    Math.atan2(
      -Math.sin(hRad) * Math.cos(decRad),
      Math.cos(phiRad) * Math.sin(decRad) - Math.sin(phiRad) * Math.cos(decRad) * Math.cos(hRad),
    ) * RAD_TO_DEG,
  );
  const refractionDeg = saemundssonRefractionDeg(geometricAltitudeDeg);
  const apparentAltitudeDeg = geometricAltitudeDeg + refractionDeg;
  const semiDiameterDeg = phenRes.value.diameterDeg / 2;
  const vis = classifyHorizonVisibility(geometricAltitudeDeg, apparentAltitudeDeg, semiDiameterDeg);

  const transits = findUpperTransitsInWindow(engine, instant, observer, semiDiameterDeg, 1.3);
  const currentEpochMs = Math.round((instant.jdUt - UNIX_EPOCH_JD) * MS_PER_DAY);
  const targetLocalDate = localDateInZone(currentEpochMs, displayZone);

  const localDateTransit = transits.find(t => localDateInZone(t.epochMs, displayZone) === targetLocalDate) ?? null;
  const nextTransit = transits.find(t => t.jdUt >= instant.jdUt - 1e-6) ?? null;
  const nearestTransit = transits.length
    ? [...transits].sort((a, b) => Math.abs(a.jdUt - instant.jdUt) - Math.abs(b.jdUt - instant.jdUt))[0]
    : null;

  return {
    engine: geoRes.engine,
    settings,
    warnings,
    status: 'ok',
    value: {
      observer,
      geocentricLongitudeDeg,
      geocentricLatitudeDeg,
      geocentricSignIndex,
      geocentricSignName,
      geocentricFormatted,
      topocentricLongitudeDeg,
      topocentricLatitudeDeg,
      topocentricDistanceAu: topoRes.value.distance,
      topocentricDistanceKm: topoRes.value.distance * AU_IN_KM,
      topocentricSignIndex,
      topocentricSignName,
      topocentricFormatted,
      parallaxDeltaLonDeg,
      parallaxDeltaLatDeg,
      signDiffers,
      signDifferenceNote,
      rightAscensionDeg,
      declinationDeg,
      localSiderealTimeDeg,
      hourAngleDeg,
      geometricAltitudeDeg,
      refractionDeg,
      apparentAltitudeDeg,
      azimuthDeg,
      semiDiameterDeg,
      visibility: vis.visibility,
      visibilityLabel: vis.visibilityLabel,
      aboveHorizon: vis.aboveHorizon,
      localDateTransit,
      nextTransit,
      nearestTransit,
      warnings,
    },
  };
}
