import { Temporal } from '@js-temporal/polyfill';
import { albertaRule, localClock, zoneCandidates } from '../time/civil-zone';
import { taiMinusUtc } from '../time/atomic-offsets';

const minuteMs = 60_000;
const hourMs = 3_600_000;
const dayMs = 86_400_000;
const minDay = Date.parse('1550-01-01');
const maxDay = Date.parse('2650-01-03');
/** Time of day is free within the last permitted date. */
const minInstant = minDay;
const maxInstant = maxDay + dayMs - minuteMs;
const dateAt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockAt = (ms: number) => new Date(ms).toISOString().slice(11, ms % minuteMs ? 19 : 16);
const dayStart = (ms: number) => Math.floor(ms / dayMs) * dayMs;
const clockPattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export const RANGE_MONTHS = [3, 6, 12] as const;
export type RangeMonths = (typeof RANGE_MONTHS)[number];
export type TimeStep = 'hour' | 'day' | 'week';
const stepMs: Record<TimeStep, number> = { hour: hourMs, day: dayMs, week: 7 * dayMs };

/** Calendar-month window around centerDayMs (UTC midnight), clamped to the supported ephemeris range. */
export function timelineBounds(centerDayMs: number, months: RangeMonths = 3) {
  const centerDate = Temporal.PlainDate.from(dateAt(centerDayMs));
  const start = Date.parse(`${centerDate.subtract({ months }).toString()}T00:00:00Z`);
  const end = Date.parse(`${centerDate.add({ months }).toString()}T00:00:00Z`);
  return {
    first: Math.max(minDay, start),
    last: Math.min(maxDay, end),
  };
}

export function byId<T extends HTMLElement = HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing observatory element ${id}.`);
  return element as T;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "now", "3 days ago", "in 2 weeks": a plain-language anchor for the selected instant. */
export function relativeLabel(selectedMs: number, nowMs: number) {
  const diff = selectedMs - nowMs;
  const magnitude = Math.abs(diff);
  if (magnitude < 90_000) return 'Right now';
  const [unit, size] = magnitude < hourMs ? ['minute', minuteMs] as const
    : magnitude < 2 * dayMs ? ['hour', hourMs] as const
      : magnitude < 14 * dayMs ? ['day', dayMs] as const
        : magnitude < 60 * dayMs ? ['week', 7 * dayMs] as const
          : magnitude < 730 * dayMs ? ['month', 30.4375 * dayMs] as const
            : ['year', 365.25 * dayMs] as const;
  return relative.format(Math.round(diff / size), unit);
}

export function bindTimeline(change: (date: string, time: string, label: string, zone: string) => void, signal: AbortSignal) {
  const date = byId<HTMLInputElement>('transit-date');
  const time = byId<HTMLInputElement>('transit-time');
  const slider = byId<HTMLInputElement>('timeline');
  const rangeSelect = byId<HTMLSelectElement>('timeline-range');
  const rangeSpan = byId('timeline-span');
  const previous = byId<HTMLButtonElement>('previous-day');
  const next = byId<HTMLButtonElement>('next-day');
  const marker = byId('now-marker');
  const stepButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-step]')];
  let center = dayStart(Date.now());
  let selected = center;
  let step: TimeStep = 'day';
  let rangeMonths: RangeMonths = 3;

  const menu = byId<HTMLSelectElement>('display-zone');
  const named = byId<HTMLInputElement>('named-zone');
  const fold = byId<HTMLSelectElement>('transit-fold');
  const message = byId('zone-status');
  const key = 'divine-orchestration.display-zone.v1';
  let zone = 'UTC';
  let zoneError = '';
  let occurrences: number[] = [];

  function applyZone() {
    byId('named-zone-field').hidden = menu.value !== 'named';
    const requested = menu.value === 'device' ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : menu.value === 'alberta' ? 'America/Edmonton' : menu.value === 'named' ? named.value.trim() : 'UTC';
    try {
      if (!/^[a-z][a-z0-9_+\-/]*$/i.test(requested)) throw new RangeError();
      new Intl.DateTimeFormat('en', { timeZone: requested });
      zone = requested;
      zoneError = '';
    } catch {
      zoneError = 'Enter a valid IANA zone. The clock still uses ';
      message.textContent = zoneError + zone + '.';
      return;
    }
    try { localStorage.setItem(key, JSON.stringify({ mode: menu.value, name: named.value })); } catch { /* Storage is optional. */ }
    date.min = wall(minInstant).date;
    date.max = wall(maxInstant).date;
    display(selected);
  }

  function wall(ms: number) {
    return zone === 'UTC' ? { date: dateAt(ms), clock: clockAt(ms), offset: '+00:00' } : localClock(ms, zone);
  }

  function display(instant: number, recenter = false) {
    selected = Math.min(maxInstant, Math.max(minInstant, instant));
    const day = dayStart(selected);
    let { first, last } = timelineBounds(center, rangeMonths);
    if (recenter || day < first || day > last) {
      center = day;
      ({ first, last } = timelineBounds(center, rangeMonths));
    }
    rangeSpan.textContent = `±${rangeMonths} months`;
    const local = wall(selected);
    date.value = local.date;
    time.value = local.clock;
    const abt = albertaRule(zone, local.date);
    const name = abt ? 'ABT' : zone;
    const epochLabel = zone === 'UTC' ? (taiMinusUtc(selected / dayMs + 2440587.5) === null ? 'approx. UT1' : 'UTC')
      : name + ' (UTC' + local.offset + ')';
    const label = local.date + ' · ' + local.clock + ' ' + epochLabel;
    document.querySelector('.time-clock .sr-only')!.textContent = 'Transit time (' + name + ')';
    const badge = document.querySelector('.time-clock abbr')!;
    badge.textContent = zone === 'UTC' ? 'UTC' : abt ? 'ABT' : 'Local';
    badge.setAttribute('title', zone + ' · UTC' + local.offset);
    byId('transit-status').hidden = true;
    message.textContent = zoneError + zone + ' · UTC' + local.offset;
    byId('transit-fold-field').hidden = true;
    occurrences = [];
    slider.min = String((first - center) / dayMs);
    slider.max = String((last - center) / dayMs);
    slider.value = String((day - center) / dayMs);
    slider.setAttribute('aria-valuetext', `${date.value} ${time.value} ${epochLabel}`);
    byId('earliest-day').textContent = wall(first + selected - day).date;
    byId('latest-day').textContent = wall(last + selected - day).date;
    previous.disabled = selected <= minInstant;
    next.disabled = selected >= maxInstant;
    byId('time-relative').textContent = relativeLabel(selected, Date.now());
    placeMarker(first, last);
    change(dateAt(selected), clockAt(selected), label, zone);
  }

  /** Marks today on the scrub track whenever it falls inside the visible window. */
  function placeMarker(first: number, last: number) {
    const nowMs = Date.now();
    const utcDay = dayStart(nowMs);
    const sampledLocalDate = wall(utcDay + selected - dayStart(selected)).date;
    const today = utcDay + Date.parse(wall(nowMs).date) - Date.parse(sampledLocalDate);
    const span = last - first;
    const inside = span > 0 && today >= first && today <= last;
    marker.hidden = !inside;
    if (inside) marker.style.setProperty('--pos', String((today - first) / span));
  }

  function setStep(size: TimeStep) {
    step = size;
    for (const button of stepButtons) button.setAttribute('aria-pressed', String(button.dataset.step === size));
    previous.setAttribute('aria-label', `Previous ${size}`);
    next.setAttribute('aria-label', `Next ${size}`);
  }

  function now() {
    const current = Date.now();
    display(Math.floor(current / minuteMs) * minuteMs, true);
  }

  function readWall(commit: boolean) {
    byId('transit-fold-field').hidden = true;
    occurrences = [];
    const status = byId('transit-status');
    function reject(text: string) {
      if (commit) display(selected);
      status.textContent = text;
      status.hidden = false;
    }
    if (!clockPattern.test(time.value)) {
      if (commit) reject('Enter a time using the 24-hour clock (HH:MM).');
      return;
    }
    if (date.value.length !== 10 || date.value < date.min || date.value > date.max) {
      if (commit || date.value) reject('Choose a transit date from ' + date.min + ' through ' + date.max + '.');
      return;
    }
    const local = Temporal.PlainDateTime.from(date.value + 'T' + time.value);
    const candidates = zoneCandidates(local, zone);
    if (!candidates.length) {
      reject('This local time was skipped by a clock change. Choose another time.');
      return;
    }
    if (candidates.length > 1) {
      occurrences = candidates.map(candidate => candidate.epochMilliseconds);
      fold.replaceChildren(new Option('Choose an offset', ''), ...candidates.map((candidate, i) =>
        new Option((i ? 'Later' : 'Earlier') + ' · UTC' + candidate.offset, String(i))));
      byId('transit-fold-field').hidden = false;
      status.hidden = false;
      status.textContent = 'This local time occurs twice. Choose an offset to update the chart.';
      return;
    }
    const instant = candidates[0].epochMilliseconds;
    if (instant < minInstant || instant > maxInstant) {
      reject('This instant falls outside the supported time range.');
      return;
    }
    status.hidden = true;
    display(instant, dayStart(instant) !== dayStart(selected));
  }
  for (const field of [date, time]) {
    field.addEventListener('input', () => readWall(false), { signal });
    field.addEventListener('change', () => readWall(true), { signal });
  }
  fold.addEventListener('change', () => {
    if (fold.value !== '') {
      byId('transit-status').hidden = true;
      display(occurrences[Number(fold.value)], true);
    }
  }, { signal });
  menu.addEventListener('change', applyZone, { signal });
  named.addEventListener('change', applyZone, { signal });
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved && ['utc', 'device', 'alberta', 'named'].includes(saved.mode) && typeof saved.name === 'string') {
      menu.value = saved.mode;
      named.value = saved.name;
    }
  } catch { /* Use UTC when storage is unavailable. */ }
  selected = Math.floor(Date.now() / minuteMs) * minuteMs;
  applyZone();

  slider.addEventListener('input', () => display(center + slider.valueAsNumber * dayMs + (selected - dayStart(selected))), { signal });
  rangeSelect.addEventListener('change', () => {
    const parsed = Number(rangeSelect.value) as RangeMonths;
    if ((RANGE_MONTHS as readonly number[]).includes(parsed)) {
      rangeMonths = parsed;
      display(selected);
    }
  }, { signal });
  previous.addEventListener('click', () => display(selected - stepMs[step]), { signal });
  next.addEventListener('click', () => display(selected + stepMs[step]), { signal });
  for (const button of stepButtons) button.addEventListener('click', () => setStep(button.dataset.step as TimeStep), { signal });
  byId('time-now').addEventListener('click', now, { signal });
  setStep('day');
  if (!date.value) {
    menu.value = 'utc';
    applyZone();
  }
}
