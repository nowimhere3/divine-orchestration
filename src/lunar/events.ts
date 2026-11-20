import { Temporal } from '@js-temporal/polyfill';
import { EPHEMERA_COVERAGE_TT } from '../engine/ephemera';
import type { EngineInstant, EngineResult, EngineWarning, EphemeraEngine } from '../engine/ephemera';
import { taiMinusUtc } from '../time/atomic-offsets';
import { albertaRule, localClock } from '../time/civil-zone';
import { wrapDegrees } from '../view/chart-data';
import {
  PRINCIPAL_PHASE_ANGLES,
  PRINCIPAL_PHASE_IDS,
  PRINCIPAL_PHASE_LABELS,
} from './phase';
import type { PrincipalPhaseId } from './phase';

const SECONDS_PER_DAY = 86_400;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;
const MEAN_SYNODIC_RATE_DEG_PER_DAY = 360 / 29.530588861; // ~12.190749 deg/day
const MIN_SYNODIC_RATE_DEG_PER_DAY = 10.4;
const MAX_SYNODIC_RATE_DEG_PER_DAY = 15.2;

export function wrap180(angleDeg: number): number {
  return ((angleDeg + 540) % 360) - 180;
}

/**
 * Converts a found TT Julian date into a consistent EngineInstant, civil epoch milliseconds,
 * and UTC / historical UT1 ISO strings, matching resolveBirthTime's time-scale model.
 */
export function jdTtToResolvedTime(engine: EphemeraEngine, jdTt: number) {
  const approxYear = 2000 + (jdTt - 2451545.0) / 365.2425;
  const approxDeltaT = engine.modelDeltaTSeconds(approxYear);
  const approxJdUt = jdTt - approxDeltaT / SECONDS_PER_DAY;
  const tai0 = taiMinusUtc(approxJdUt);
  const approxCivilJd = tai0 === null ? approxJdUt : jdTt - (tai0 + 32.184) / SECONDS_PER_DAY;
  const approxMs = (approxCivilJd - UNIX_EPOCH_JD) * MS_PER_DAY;

  const iso0 = new Date(Math.round(approxMs)).toISOString();
  let deltaTYear = approxYear;
  if (/^\d{4}-\d{2}-\d{2}/.test(iso0) && !iso0.startsWith('0000')) {
    const year = Number(iso0.slice(0, 4));
    const startMs = Date.parse(`${iso0.slice(0, 4)}-01-01T00:00:00Z`);
    try {
      const daysInYear = Temporal.PlainDate.from(iso0.slice(0, 10)).daysInYear;
      deltaTYear = year + (approxMs - startMs) / (daysInYear * MS_PER_DAY);
    } catch {
      deltaTYear = approxYear;
    }
  }

  const deltaTSeconds = engine.modelDeltaTSeconds(deltaTYear);
  const jdUt = jdTt - deltaTSeconds / SECONDS_PER_DAY;
  const tai = taiMinusUtc(jdUt);
  const civilJd = tai === null ? jdUt : jdTt - (tai + 32.184) / SECONDS_PER_DAY;
  const epochMs = Math.round((civilJd - UNIX_EPOCH_JD) * MS_PER_DAY);
  const iso = new Date(epochMs).toISOString();

  return {
    instant: { jdUt, jdTt, deltaTYear } satisfies EngineInstant,
    epochMs,
    utc: tai === null ? null : iso,
    historicalUt1Iso: tai === null ? iso.slice(0, -1) : null,
  };
}

/**
 * Formats an event timestamp in the active Time Machine display time zone,
 * honoring permanent Alberta Time (ABT, UTC-06:00) from 2026-11-01 onward.
 */
export function formatLunarTimestamp(epochMs: number, zone = 'UTC'): string {
  const roundedMs = Math.round(epochMs / 60_000) * 60_000;
  const isPreUtc = taiMinusUtc(roundedMs / MS_PER_DAY + UNIX_EPOCH_JD) === null;
  if (zone === 'UTC') {
    const iso = new Date(roundedMs).toISOString();
    const date = iso.slice(0, 10);
    const clock = iso.slice(11, 16);
    return `${date} · ${clock} ${isPreUtc ? 'approx. UT1' : 'UTC'}`;
  }
  const local = localClock(roundedMs, zone);
  const clock = local.clock.slice(0, 5);
  const abt = albertaRule(zone, local.date);
  const zoneLabel = abt ? 'ABT' : zone;
  return `${local.date} · ${clock} ${zoneLabel} (UTC${local.offset})`;
}

export interface PhaseEvent {
  readonly phase: PrincipalPhaseId;
  readonly label: string;
  readonly targetAngleDeg: number;
  readonly jdTt: number;
  readonly jdUt: number;
  readonly deltaTYear: number;
  readonly epochMs: number;
  readonly utc: string | null;
  readonly historicalUt1Iso: string | null;
}

function evaluateElongationAtTt(engine: EphemeraEngine, jdTt: number, deltaTYearHint: number) {
  const deltaT = engine.modelDeltaTSeconds(deltaTYearHint);
  const instant: EngineInstant = {
    jdTt,
    jdUt: jdTt - deltaT / SECONDS_PER_DAY,
    deltaTYear: deltaTYearHint,
  };
  const moon = engine.position('Moon', instant);
  const sun = engine.position('Sun', instant);
  if (moon.status !== 'ok' || sun.status !== 'ok') return null;
  return {
    elongationDeg: wrapDegrees(moon.value.longitude - sun.value.longitude),
    rateDegPerDay: moon.value.longitudeSpeed - sun.value.longitudeSpeed,
    warnings: [...moon.warnings, ...sun.warnings],
  };
}

/**
 * Finds the next (direction = 1) or previous (direction = -1) occurrence of a principal
 * lunar phase (Δλ = 0°, 90°, 180°, 270° geocentric apparent ecliptic longitude).
 */
export function findPrincipalPhase(
  engine: EphemeraEngine,
  instant: EngineInstant,
  phase: PrincipalPhaseId,
  direction: 1 | -1,
  options?: { readonly allowExact?: boolean },
): EngineResult<PhaseEvent, EngineInstant & { phase: PrincipalPhaseId; direction: 1 | -1 }> {
  const settings = { ...instant, phase, direction };
  const warnings = new Set<EngineWarning>();
  if (![instant.jdUt, instant.jdTt, instant.deltaTYear].every(Number.isFinite) ||
      (direction !== 1 && direction !== -1) ||
      !Object.hasOwn(PRINCIPAL_PHASE_ANGLES, phase)) {
    return {
      engine: engine.position('Moon', instant).engine,
      settings,
      warnings: [],
      status: 'unavailable',
      reason: 'invalid-input',
    };
  }

  const startEval = evaluateElongationAtTt(engine, instant.jdTt, instant.deltaTYear);
  if (!startEval) {
    const fallback = engine.position('Moon', instant);
    return {
      engine: fallback.engine,
      settings,
      warnings: fallback.warnings,
      status: 'unavailable',
      reason: fallback.status === 'unavailable' ? fallback.reason : 'calculation-unavailable',
    };
  }
  for (const w of startEval.warnings) warnings.add(w);

  const targetDeg = PRINCIPAL_PHASE_ANGLES[phase];
  let deltaDeg = direction === 1
    ? wrapDegrees(targetDeg - startEval.elongationDeg)
    : wrapDegrees(startEval.elongationDeg - targetDeg);

  if (deltaDeg < 1e-7) {
    if (options?.allowExact) {
      const resolved = jdTtToResolvedTime(engine, instant.jdTt);
      return {
        engine: engine.position('Moon', instant).engine,
        settings,
        warnings: [...warnings],
        status: 'ok',
        value: {
          phase,
          label: PRINCIPAL_PHASE_LABELS[phase],
          targetAngleDeg: targetDeg,
          jdTt: instant.jdTt,
          jdUt: resolved.instant.jdUt,
          deltaTYear: resolved.instant.deltaTYear,
          epochMs: resolved.epochMs,
          utc: resolved.utc,
          historicalUt1Iso: resolved.historicalUt1Iso,
        },
      };
    }
    deltaDeg = 360;
  }

  // Strictly bounded time interval to the target phase using physical synodic rate bounds.
  const minDt = Math.max(0, deltaDeg / MAX_SYNODIC_RATE_DEG_PER_DAY - 0.03);
  const maxDt = deltaDeg / MIN_SYNODIC_RATE_DEG_PER_DAY + 0.03;

  const rawA = direction === 1 ? instant.jdTt + minDt : instant.jdTt - maxDt;
  const rawB = direction === 1 ? instant.jdTt + maxDt : instant.jdTt - minDt;

  let a = Math.max(EPHEMERA_COVERAGE_TT.start, rawA);
  let b = Math.min(EPHEMERA_COVERAGE_TT.end, rawB);
  if (a > rawA || b < rawB) {
    warnings.add('near-coverage-edge');
    warnings.add('search-clamped-to-coverage');
  }

  if (a >= b) {
    return {
      engine: engine.position('Moon', instant).engine,
      settings,
      warnings: [...warnings],
      status: 'unavailable',
      reason: 'no-event-returned',
    };
  }

  const evalResidual = (t: number) => {
    const yearHint = instant.deltaTYear + (t - instant.jdTt) / 365.2425;
    const sample = evaluateElongationAtTt(engine, t, yearHint);
    if (!sample) return null;
    for (const w of sample.warnings) warnings.add(w);
    return {
      f: wrap180(sample.elongationDeg - targetDeg),
      rate: sample.rateDegPerDay,
    };
  };

  const faRes = evalResidual(a);
  const fbRes = evalResidual(b);
  if (!faRes || !fbRes) {
    return {
      engine: engine.position('Moon', instant).engine,
      settings,
      warnings: [...warnings],
      status: 'unavailable',
      reason: 'calculation-unavailable',
    };
  }

  let fa = faRes.f;
  let fb = fbRes.f;
  // At Δθ ≈ 360°, one endpoint can wrap past ±180°; unwrap monotonically since df/dt > 0.
  if (fa > 90) fa -= 360;
  if (fb < -90) fb += 360;

  if (fa > 0 || fb < 0) {
    return {
      engine: engine.position('Moon', instant).engine,
      settings,
      warnings: [...warnings],
      status: 'unavailable',
      reason: 'no-event-returned',
    };
  }

  // Initial estimate from mean synodic rate, clamped inside [a, b].
  let t = Math.min(b, Math.max(a, instant.jdTt + direction * (deltaDeg / MEAN_SYNODIC_RATE_DEG_PER_DAY)));

  for (let iter = 0; iter < 12; iter += 1) {
    const cur = evalResidual(t);
    if (!cur) break;
    const f = cur.f;
    if (Math.abs(f) < 1e-7 || (b - a) < 1e-8) break;

    if (f < 0) {
      a = t;
      fa = f;
    } else {
      b = t;
      fb = f;
    }

    const newtonCandidate = cur.rate > 0 ? t - f / cur.rate : (a + b) / 2;
    if (newtonCandidate > a + 1e-9 && newtonCandidate < b - 1e-9) {
      t = newtonCandidate;
    } else {
      t = (a + b) / 2;
    }
  }

  const resolved = jdTtToResolvedTime(engine, t);
  if (Math.min(t - EPHEMERA_COVERAGE_TT.start, EPHEMERA_COVERAGE_TT.end - t) < 365) {
    warnings.add('near-coverage-edge');
  }

  return {
    engine: engine.position('Moon', instant).engine,
    settings,
    warnings: [...warnings],
    status: 'ok',
    value: {
      phase,
      label: PRINCIPAL_PHASE_LABELS[phase],
      targetAngleDeg: targetDeg,
      jdTt: t,
      jdUt: resolved.instant.jdUt,
      deltaTYear: resolved.instant.deltaTYear,
      epochMs: resolved.epochMs,
      utc: resolved.utc,
      historicalUt1Iso: resolved.historicalUt1Iso,
    },
  };
}

export interface LunarCycleInfo {
  readonly previous: PhaseEvent | null;
  readonly next: PhaseEvent | null;
  readonly upcoming: readonly PhaseEvent[];
  readonly previousNew: PhaseEvent | null;
  readonly nextNew: PhaseEvent | null;
  /** Astronomical Moon age in days since the previous exact New Moon. */
  readonly ageDays: number | null;
  /** Length of the current New-to-New synodic cycle in days (typically 29.18..29.93 d). */
  readonly synodicLengthDays: number | null;
  /** Time-based fraction of the current synodic cycle (0..1), falling back to elongation/360 near coverage edges. */
  readonly cycleProgress: number;
  /** Angular fraction wrap360(Moon λ − Sun λ) / 360 (0..1). */
  readonly elongationProgress: number;
  readonly warnings: readonly EngineWarning[];
}

export function calculateLunarCycle(
  engine: EphemeraEngine,
  instant: EngineInstant,
): EngineResult<LunarCycleInfo, EngineInstant> {
  const startEval = evaluateElongationAtTt(engine, instant.jdTt, instant.deltaTYear);
  if (!startEval) {
    const fallback = engine.position('Moon', instant);
    return {
      engine: fallback.engine,
      settings: instant,
      warnings: fallback.warnings,
      status: 'unavailable',
      reason: fallback.status === 'unavailable' ? fallback.reason : 'calculation-unavailable',
    };
  }

  const warnings = new Set<EngineWarning>(startEval.warnings);
  const upcomingList: PhaseEvent[] = [];
  const pastList: PhaseEvent[] = [];

  for (const phase of PRINCIPAL_PHASE_IDS) {
    const fwd = findPrincipalPhase(engine, instant, phase, 1, { allowExact: false });
    for (const w of fwd.warnings) warnings.add(w);
    if (fwd.status === 'ok') upcomingList.push(fwd.value);

    const bwd = findPrincipalPhase(engine, instant, phase, -1, { allowExact: true });
    for (const w of bwd.warnings) warnings.add(w);
    if (bwd.status === 'ok') pastList.push(bwd.value);
  }

  upcomingList.sort((a, b) => a.jdTt - b.jdTt);
  pastList.sort((a, b) => b.jdTt - a.jdTt);

  const previous = pastList[0] ?? null;
  const next = upcomingList[0] ?? null;
  const previousNew = pastList.find(e => e.phase === 'new') ?? null;
  const nextNew = upcomingList.find(e => e.phase === 'new') ?? null;

  const ageDays = previousNew ? Math.max(0, instant.jdTt - previousNew.jdTt) : null;
  const synodicLengthDays = previousNew && nextNew && nextNew.jdTt > previousNew.jdTt
    ? nextNew.jdTt - previousNew.jdTt
    : null;
  const elongationProgress = startEval.elongationDeg / 360;
  const cycleProgress = ageDays !== null && synodicLengthDays !== null
    ? Math.min(1, Math.max(0, ageDays / synodicLengthDays))
    : elongationProgress;

  return {
    engine: engine.position('Moon', instant).engine,
    settings: instant,
    warnings: [...warnings],
    status: 'ok',
    value: {
      previous,
      next,
      upcoming: upcomingList,
      previousNew,
      nextNew,
      ageDays,
      synodicLengthDays,
      cycleProgress,
      elongationProgress,
      warnings: [...warnings],
    },
  };
}
