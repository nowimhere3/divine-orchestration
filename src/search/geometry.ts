import { angularSeparation } from '../domain/aspects';
import { SECONDS_PER_DAY } from '../time/ephemeris-time';

export const CONTACT_TOLERANCE_DEG = 0.00001;
export const REFINEMENT_SECONDS = 0.01;
export const TIME_EPS = REFINEMENT_SECONDS / SECONDS_PER_DAY;
const endpointEpsilon = 1e-9;

export interface Sample {
  readonly tt: number;
  readonly longitude: number;
  readonly speed: number;
}

export interface Contact {
  readonly tt: number;
  readonly residual: number;
  readonly state: 'exact' | 'refined' | 'near-miss';
}

interface Window {
  start: number;
  end: number;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
  readonly passes: readonly Contact[];
}

type Samples = (tt: number) => Sample;
type CrossingSeed = (target: number, start: number, end: number) => number | null;

export const normalize = (value: number) => (value % 360 + 360) % 360;
const signedArc = (to: number, from: number) => normalize(to - from + 180) - 180;
const levels = (longitude: number, angle: number) => [...new Set([normalize(longitude - angle), normalize(longitude + angle)])];

export function uniqueTimes(times: readonly number[]) {
  const result: number[] = [];
  for (const time of [...times].sort((a, b) => a - b)) {
    if (result.length === 0 || time - result[result.length - 1] > TIME_EPS) result.push(time);
  }
  return result;
}

function crossings(track: readonly Sample[], targets: readonly number[], sample: Samples, seed?: CrossingSeed) {
  const found: Contact[] = [];
  for (let index = 1; index < track.length; index++) {
    const left = track[index - 1];
    const right = track[index];
    const base = left.longitude;
    const top = base + signedArc(right.longitude, base);
    const low = Math.min(base, top);
    const high = Math.max(base, top);
    for (const target of targets) {
      const level = target + Math.ceil((low - target - endpointEpsilon) / 360) * 360;
      if (level > high + endpointEpsilon) continue;
      const residualAt = (tt: number) => base + signedArc(sample(tt).longitude, base) - level;
      let a = left.tt;
      let b = right.tt;
      let fa = base - level;
      let fb = top - level;
      if (Math.abs(fa) <= endpointEpsilon || Math.abs(fb) <= endpointEpsilon) {
        found.push(Math.abs(fa) <= Math.abs(fb)
          ? { tt: a, residual: Math.abs(fa), state: 'exact' }
          : { tt: b, residual: Math.abs(fb), state: 'exact' });
        continue;
      }
      if ((fa < 0) === (fb < 0)) continue;
      let candidate = seed?.(target, a, b) ?? null;
      let best: Contact = { tt: a, residual: Math.abs(fa), state: 'refined' };
      if (Math.abs(fb) < best.residual) best = { ...best, tt: b, residual: Math.abs(fb) };
      for (let iteration = 0; b - a > TIME_EPS || best.residual > CONTACT_TOLERANCE_DEG; iteration++) {
        if (best.residual <= CONTACT_TOLERANCE_DEG && best.tt >= a && best.tt <= b) {
          // Certify the time tolerance with a local sign bracket around a good seed.
          // This avoids bisecting several days of lunar motion for every orb edge.
          const lo = Math.max(a, best.tt - TIME_EPS / 2);
          const hi = Math.min(b, best.tt + TIME_EPS / 2);
          const flo = lo === a ? fa : residualAt(lo);
          const fhi = hi === b ? fb : residualAt(hi);
          if (flo === 0 || fhi === 0 || (flo < 0) !== (fhi < 0)) break;
        }
        const estimate = candidate ?? a + (b - a) * Math.abs(fa) / (Math.abs(fa) + Math.abs(fb));
        candidate = null;
        // A periodic midpoint guarantees progress for very flat or skewed brackets.
        const midpoint = iteration % 4 !== 3 && estimate > a && estimate < b ? estimate : a + (b - a) / 2;
        if (midpoint <= a || midpoint >= b) break;
        const fm = residualAt(midpoint);
        if (Math.abs(fm) < best.residual) best = { ...best, tt: midpoint, residual: Math.abs(fm) };
        if (fm === 0) break;
        if ((fa < 0) === (fm < 0)) {
          a = midpoint;
          fa = fm;
        } else {
          b = midpoint;
          fb = fm;
        }
      }
      if (best.residual <= CONTACT_TOLERANCE_DEG) found.push(best);
    }
  }
  const ordered = found.sort((a, b) => a.tt - b.tt || a.residual - b.residual);
  const result: Contact[] = [];
  for (const event of ordered) {
    const previous = result[result.length - 1];
    if (!previous || event.tt - previous.tt > TIME_EPS) result.push(event);
    else if (event.residual < previous.residual) result[result.length - 1] = event;
  }
  return result;
}

/** Find windows of absolute angular error around a major aspect to a fixed longitude. */
export function aspectWindows(
  track: readonly Sample[], turns: readonly number[], natal: number, angle: number, orb: number,
  sample: Samples, seed: CrossingSeed,
): readonly Window[] {
  const contacts = crossings(track, levels(natal, angle), sample, seed);
  if (orb === 0) return contacts.map(contact => ({
    start: contact.tt, end: contact.tt, clippedStart: false, clippedEnd: false, passes: [contact],
  }));

  const start = track[0].tt;
  const end = track[track.length - 1].tt;
  const edges = [
    ...(angle - orb > 0 ? levels(natal, angle - orb) : []),
    ...(angle + orb < 180 ? levels(natal, angle + orb) : []),
  ];
  const boundaryRoots = crossings(track, [...new Set(edges)], sample).map(contact => contact.tt);
  const boundaries = [start, ...uniqueTimes(boundaryRoots).filter(tt => tt - start > TIME_EPS && end - tt > TIME_EPS), end];
  const error = (tt: number) => Math.abs(angularSeparation(sample(tt).longitude, natal) - angle);
  const spans: { start: number; end: number }[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const a = boundaries[i - 1];
    const b = boundaries[i];
    if (error(a + (b - a) / 2) > orb + endpointEpsilon) continue;
    const previous = spans[spans.length - 1];
    if (previous?.end === a) previous.end = b;
    else spans.push({ start: a, end: b });
  }
  for (const tt of turns) {
    const residual = error(tt);
    if (Math.abs(residual - orb) <= endpointEpsilon && !spans.some(span => tt >= span.start && tt <= span.end)) {
      spans.push({ start: tt, end: tt });
    }
  }
  const knownAtEdge = (tt: number) => Math.abs(sample(tt).speed) > 1e-7 &&
    boundaryRoots.some(root => Math.abs(tt - root) <= TIME_EPS);

  return spans.sort((a, b) => a.start - b.start).map(span => {
    const passes = contacts.filter(contact => contact.tt >= span.start - TIME_EPS && contact.tt <= span.end + TIME_EPS);
    for (const tt of turns) {
      if (tt <= start + TIME_EPS || tt >= end - TIME_EPS || tt < span.start || tt > span.end ||
          passes.some(pass => Math.abs(pass.tt - tt) <= TIME_EPS)) continue;
      const residual = error(tt);
      const step = Math.min(0.01, (tt - start) / 2, (end - tt) / 2);
      if (residual <= orb + endpointEpsilon && residual <= error(tt - step) && residual <= error(tt + step)) {
        passes.push({ tt, residual, state: 'near-miss' });
      }
    }
    return {
      ...span,
      clippedStart: span.start === start && !knownAtEdge(start),
      clippedEnd: span.end === end && !knownAtEdge(end),
      passes: passes.sort((a, b) => a.tt - b.tt),
    };
  });
}
