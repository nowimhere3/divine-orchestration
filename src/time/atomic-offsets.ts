// USNO tai-utc.dat. The early UTC intervals use a linear drift in MJD.
// https://maia.usno.navy.mil/ser7/tai-utc.dat
const drifts = [
  [2437300.5, 1.422818, 37300, 0.001296],
  [2437512.5, 1.372818, 37300, 0.001296],
  [2437665.5, 1.845858, 37665, 0.0011232],
  [2438334.5, 1.945858, 37665, 0.0011232],
  [2438395.5, 3.240130, 38761, 0.001296],
  [2438486.5, 3.340130, 38761, 0.001296],
  [2438639.5, 3.440130, 38761, 0.001296],
  [2438761.5, 3.540130, 38761, 0.001296],
  [2438820.5, 3.640130, 38761, 0.001296],
  [2438942.5, 3.740130, 38761, 0.001296],
  [2439004.5, 3.840130, 38761, 0.001296],
  [2439126.5, 4.313170, 39126, 0.002592],
  [2439887.5, 4.213170, 39126, 0.002592],
] as const;

// Each midnight after a positive leap second, starting with the first in 1972.
const leapMidnights = new Set([
  2441499.5, 2441683.5, 2442048.5, 2442413.5, 2442778.5, 2443144.5,
  2443509.5, 2443874.5, 2444239.5, 2444786.5, 2445151.5, 2445516.5,
  2446247.5, 2447161.5, 2447892.5, 2448257.5, 2448804.5, 2449169.5,
  2449534.5, 2450083.5, 2450630.5, 2451179.5, 2453736.5, 2454832.5,
  2456109.5, 2457204.5, 2457754.5,
]);

// IERS Bulletin C 72 confirms no leap second through December 2026.
export const ATOMIC_OFFSETS_VERIFIED_BEFORE = '2027-01-01';

export function isKnownLeapMidnight(jd: number): boolean {
  return leapMidnights.has(jd);
}

export function taiMinusUtc(jd: number): number | null {
  if (jd >= 2441317.5) {
    let seconds = 10;
    for (const midnight of leapMidnights) {
      if (jd < midnight) break;
      seconds++;
    }
    return seconds;
  }
  for (let i = drifts.length - 1; i >= 0; i--) {
    const [start, base, mjdOrigin, rate] = drifts[i];
    if (jd >= start) return base + (jd - 2400000.5 - mjdOrigin) * rate;
  }
  return null;
}

const secondsPerDay = 86400;
const taiEpoch = 2441317.5;
const leapTransitions = [taiEpoch, ...leapMidnights].map((day, index) => ({
  day, tt: day + (42.184 + index) / secondsPerDay,
}));

const formatJd = (jd: number) => new Date(Math.round((jd - 2440587.5) * 86400000)).toISOString();

/** Invert the tabulated UTC relationship. Pre-UTC or non-unique drift-era labels are unavailable. */
export function utcFromTt(jdTt: number): string | null {
  for (let i = leapTransitions.length - 1; i >= 0; i--) {
    const { tt } = leapTransitions[i];
    if (jdTt >= tt) {
      const next = leapTransitions[i + 1];
      const label = formatJd(jdTt - (42.184 + i) / secondsPerDay);
      if (next && jdTt >= next.tt - 1 / secondsPerDay) {
        const millis = Math.min(999, Math.max(0, Math.round((jdTt - next.tt) * 86400000 + 1000)));
        return `${formatJd(next.day - 1).slice(0, 10)}T23:59:60.${String(millis).padStart(3, '0')}Z`;
      }
      // Rounding the last fraction of an ordinary second must not skip a leap second.
      return next && label.slice(0, 10) === formatJd(next.day).slice(0, 10)
        ? formatJd(next.day - 0.001 / secondsPerDay)
        : label;
    }
  }
  const candidates: number[] = [];
  for (let i = 0; i < drifts.length; i++) {
    const [start, base, origin, rate] = drifts[i];
    const offsetAtStart = base + (start - 2400000.5 - origin) * rate + 32.184;
    const civil = start + (jdTt - (start + offsetAtStart / secondsPerDay)) / (1 + rate / secondsPerDay);
    if (civil >= start && civil < (drifts[i + 1]?.[0] ?? taiEpoch)) candidates.push(civil);
  }
  return candidates.length === 1 ? formatJd(candidates[0]) : null;
}
