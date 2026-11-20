import { Temporal } from '@js-temporal/polyfill';

// Alberta retained MDT's offset on Nov 1, 2026. Earlier Edmonton dates use IANA history.
const edmontonZone = /^(america\/edmonton|canada\/mountain)$/i;

export function albertaRule(zone: string, localDate: string) {
  return edmontonZone.test(zone) && localDate >= '2026-11-01';
}

export function localClock(ms: number, zone: string) {
  const instant = Temporal.Instant.fromEpochMilliseconds(ms);
  const effective = ms >= Date.UTC(2026, 10, 1, 6) && edmontonZone.test(zone) ? '-06:00' : zone;
  const local = instant.toZonedDateTimeISO(effective);
  return { date: local.toPlainDate().toString(), clock: local.toPlainTime().toString({ smallestUnit: local.second ? 'second' : 'minute' }), offset: local.offset };
}

export function zoneCandidates(wall: Temporal.PlainDateTime, zone: string) {
  if (albertaRule(zone, wall.toPlainDate().toString())) zone = '-06:00';
  const earlier = wall.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const later = wall.toZonedDateTime(zone, { disambiguation: 'later' });
  const candidates = earlier.equals(later) ? [earlier] : [earlier, later];
  return candidates.filter(candidate => candidate.toPlainDateTime().equals(wall));
}

