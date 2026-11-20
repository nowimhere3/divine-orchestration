import type { EngineInstant, EngineResult, EngineWarning, EphemeraEngine } from '../engine/ephemera';
import { resolveBirthTime } from '../time/resolve';
import type { BirthTimeInput } from '../time/resolve';
import { signPosition, wrapDegrees } from '../view/chart-data';

export const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const;

export type ZodiacSignName = (typeof ZODIAC_SIGNS)[number];

export type LunarPhaseId =
  | 'new'
  | 'waxing-crescent'
  | 'first-quarter'
  | 'waxing-gibbous'
  | 'full'
  | 'waning-gibbous'
  | 'last-quarter'
  | 'waning-crescent';

export type PrincipalPhaseId = 'new' | 'first-quarter' | 'full' | 'last-quarter';

export const PRINCIPAL_PHASE_IDS: readonly PrincipalPhaseId[] = [
  'new', 'first-quarter', 'full', 'last-quarter',
] as const;

export const PRINCIPAL_PHASE_ANGLES: Readonly<Record<PrincipalPhaseId, number>> = {
  'new': 0,
  'first-quarter': 90,
  'full': 180,
  'last-quarter': 270,
};

/**
 * Principal phase labels apply within ±3° of geocentric ecliptic elongation (0°, 90°, 180°, 270°),
 * corresponding to roughly ±6 hours around the exact astronomical phase instant. The four intermediate
 * phases (crescents and gibbous phases) span the 84° quadrants between them.
 */
export const PRINCIPAL_PHASE_HALF_WIDTH_DEG = 3;

export const LUNAR_PHASE_LABELS: Readonly<Record<LunarPhaseId, string>> = {
  'new': 'New Moon',
  'waxing-crescent': 'Waxing Crescent',
  'first-quarter': 'First Quarter',
  'waxing-gibbous': 'Waxing Gibbous',
  'full': 'Full Moon',
  'waning-gibbous': 'Waning Gibbous',
  'last-quarter': 'Last Quarter',
  'waning-crescent': 'Waning Crescent',
};

export const PRINCIPAL_PHASE_LABELS: Readonly<Record<PrincipalPhaseId, string>> = {
  'new': 'New Moon',
  'first-quarter': 'First Quarter',
  'full': 'Full Moon',
  'last-quarter': 'Last Quarter',
};

export const AU_IN_KM = 149_597_870.7;

export interface PhaseClassification {
  readonly phase: LunarPhaseId;
  readonly phaseLabel: string;
  readonly waxing: boolean;
  readonly waxingLabel: 'Waxing' | 'Waning';
  readonly principalPhase: PrincipalPhaseId | null;
}

export function classifyLunarPhase(elongationDeg: number): PhaseClassification {
  const theta = wrapDegrees(elongationDeg);
  const w = PRINCIPAL_PHASE_HALF_WIDTH_DEG;
  const waxing = theta < 180;
  const waxingLabel = waxing ? 'Waxing' : 'Waning';

  let phase: LunarPhaseId;
  let principalPhase: PrincipalPhaseId | null = null;

  if (theta < w || theta >= 360 - w) {
    phase = 'new';
    principalPhase = 'new';
  } else if (theta < 90 - w) {
    phase = 'waxing-crescent';
  } else if (theta < 90 + w) {
    phase = 'first-quarter';
    principalPhase = 'first-quarter';
  } else if (theta < 180 - w) {
    phase = 'waxing-gibbous';
  } else if (theta < 180 + w) {
    phase = 'full';
    principalPhase = 'full';
  } else if (theta < 270 - w) {
    phase = 'waning-gibbous';
  } else if (theta < 270 + w) {
    phase = 'last-quarter';
    principalPhase = 'last-quarter';
  } else {
    phase = 'waning-crescent';
  }

  return {
    phase,
    phaseLabel: LUNAR_PHASE_LABELS[phase],
    waxing,
    waxingLabel,
    principalPhase,
  };
}

export interface MoonState {
  /** Geocentric apparent ecliptic longitude difference wrap360(Moon λ − Sun λ), 0..360°. */
  readonly elongationDeg: number;
  /** 3D Sun–Moon angular separation, 0..180°. */
  readonly separation3dDeg: number;
  /** Selenocentric Sun–Earth phase angle, 0..180°. */
  readonly phaseAngleDeg: number;
  /** Geocentric illuminated fraction of the disk, 0..1. */
  readonly illumination: number;
  /** Geocentric illumination percentage, 0..100. */
  readonly illuminationPercent: number;
  readonly waxing: boolean;
  readonly waxingLabel: 'Waxing' | 'Waning';
  readonly phase: LunarPhaseId;
  readonly phaseLabel: string;
  readonly principalPhase: PrincipalPhaseId | null;
  readonly moonLongitudeDeg: number;
  readonly moonLatitudeDeg: number;
  readonly sunLongitudeDeg: number;
  readonly signIndex: number;
  readonly signName: ZodiacSignName;
  readonly degreeInSign: number;
  readonly formattedPosition: string;
  readonly distanceAu: number;
  readonly distanceKm: number;
  readonly diameterDeg: number;
  readonly longitudeSpeedDegPerDay: number;
  readonly warnings: readonly EngineWarning[];
}

export function calculateMoonState(
  engine: EphemeraEngine,
  instant: EngineInstant,
): EngineResult<MoonState, EngineInstant> {
  const moonRes = engine.position('Moon', instant);
  if (moonRes.status === 'unavailable') {
    return {
      engine: moonRes.engine,
      settings: instant,
      warnings: moonRes.warnings,
      status: 'unavailable',
      reason: moonRes.reason,
    };
  }
  const sunRes = engine.position('Sun', instant);
  if (sunRes.status === 'unavailable') {
    return {
      engine: sunRes.engine,
      settings: instant,
      warnings: sunRes.warnings,
      status: 'unavailable',
      reason: sunRes.reason,
    };
  }
  const phenRes = engine.phenomena('Moon', instant);
  if (phenRes.status === 'unavailable') {
    return {
      engine: phenRes.engine,
      settings: instant,
      warnings: phenRes.warnings,
      status: 'unavailable',
      reason: phenRes.reason,
    };
  }

  const warnings = [...new Set([...moonRes.warnings, ...sunRes.warnings, ...phenRes.warnings])];
  const moonLongitudeDeg = wrapDegrees(moonRes.value.longitude);
  const sunLongitudeDeg = wrapDegrees(sunRes.value.longitude);
  const elongationDeg = wrapDegrees(moonLongitudeDeg - sunLongitudeDeg);
  const classification = classifyLunarPhase(elongationDeg);
  const signIndex = Math.floor(moonLongitudeDeg / 30) % 12;
  const signName = ZODIAC_SIGNS[signIndex];
  const degreeInSign = moonLongitudeDeg - signIndex * 30;

  return {
    engine: moonRes.engine,
    settings: instant,
    warnings,
    status: 'ok',
    value: {
      elongationDeg,
      separation3dDeg: phenRes.value.elongationDeg,
      phaseAngleDeg: phenRes.value.phaseAngleDeg,
      illumination: phenRes.value.illumination,
      illuminationPercent: phenRes.value.illumination * 100,
      waxing: classification.waxing,
      waxingLabel: classification.waxingLabel,
      phase: classification.phase,
      phaseLabel: classification.phaseLabel,
      principalPhase: classification.principalPhase,
      moonLongitudeDeg,
      moonLatitudeDeg: moonRes.value.latitude,
      sunLongitudeDeg,
      signIndex,
      signName,
      degreeInSign,
      formattedPosition: signPosition(moonLongitudeDeg),
      distanceAu: moonRes.value.distance,
      distanceKm: moonRes.value.distance * AU_IN_KM,
      diameterDeg: phenRes.value.diameterDeg,
      longitudeSpeedDegPerDay: moonRes.value.longitudeSpeed,
      warnings,
    },
  };
}

export interface DateOnlyMoonSummary {
  readonly status: 'ok' | 'unavailable';
  readonly phaseSummary: string;
  readonly illuminationSummary: string;
  readonly signSummary: string;
  readonly signChanged: boolean;
  readonly startState: MoonState | null;
  readonly endState: MoonState | null;
  readonly fullSummary: string;
}

/**
 * When a profile has an unknown birth time, evaluates the geocentric Moon at the start (00:00)
 * and end (23:59:59) of that calendar date in the profile's time zone (or UTC if none).
 */
export function calculateDateOnlyMoonSummary(
  engine: EphemeraEngine,
  birth: BirthTimeInput,
): DateOnlyMoonSummary {
  const baseInput: BirthTimeInput = birth.timeZone
    ? { date: birth.date, time: '00:00', timeZone: birth.timeZone, disambiguation: 'earlier' }
    : { date: birth.date, time: '00:00', offsetOverride: birth.offsetOverride ?? '+00:00' };
  const endInput: BirthTimeInput = birth.timeZone
    ? { date: birth.date, time: '23:59:59', timeZone: birth.timeZone, disambiguation: 'later' }
    : { date: birth.date, time: '23:59:59', offsetOverride: birth.offsetOverride ?? '+00:00' };

  let startResolved = resolveBirthTime(baseInput, engine.modelDeltaTSeconds);
  if (startResolved.kind !== 'resolved') {
    startResolved = resolveBirthTime({ date: birth.date, time: '00:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  }
  let endResolved = resolveBirthTime(endInput, engine.modelDeltaTSeconds);
  if (endResolved.kind !== 'resolved') {
    endResolved = resolveBirthTime({ date: birth.date, time: '23:59:59', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  }

  if (startResolved.kind !== 'resolved' || endResolved.kind !== 'resolved') {
    return {
      status: 'unavailable',
      phaseSummary: 'Unavailable',
      illuminationSummary: 'Unavailable',
      signSummary: 'Unavailable',
      signChanged: false,
      startState: null,
      endState: null,
      fullSummary: 'Moon on birth date unavailable (outside coverage).',
    };
  }

  const startMoon = calculateMoonState(engine, startResolved);
  const endMoon = calculateMoonState(engine, endResolved);
  if (startMoon.status !== 'ok' || endMoon.status !== 'ok') {
    return {
      status: 'unavailable',
      phaseSummary: 'Unavailable',
      illuminationSummary: 'Unavailable',
      signSummary: 'Unavailable',
      signChanged: false,
      startState: null,
      endState: null,
      fullSummary: 'Moon on birth date unavailable (outside ephemeris coverage).',
    };
  }

  const s = startMoon.value;
  const e = endMoon.value;
  const phaseSummary = s.phaseLabel === e.phaseLabel ? s.phaseLabel : `${s.phaseLabel} → ${e.phaseLabel}`;
  const minIllum = Math.round(Math.min(s.illuminationPercent, e.illuminationPercent));
  const maxIllum = Math.round(Math.max(s.illuminationPercent, e.illuminationPercent));
  const illuminationSummary = minIllum === maxIllum ? `${minIllum}% lit` : `${minIllum}%–${maxIllum}% lit`;
  const signChanged = s.signIndex !== e.signIndex;
  const signSummary = signChanged
    ? `${s.signName} → ${e.signName} (${s.formattedPosition} to ${e.formattedPosition})`
    : `${s.signName} (${s.formattedPosition} to ${e.formattedPosition})`;

  return {
    status: 'ok',
    phaseSummary,
    illuminationSummary,
    signSummary,
    signChanged,
    startState: s,
    endState: e,
    fullSummary: `Moon on birth date: ${phaseSummary} · ${illuminationSummary} · ${signSummary} (birth time unknown; exact degree & local sky unavailable)`,
  };
}
