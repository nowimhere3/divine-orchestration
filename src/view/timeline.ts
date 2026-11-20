const minuteMs = 60_000;
const hourMs = 3_600_000;
const dayMs = 86_400_000;
const minDay = Date.parse('1550-01-01');
const maxDay = Date.parse('2650-01-03');
/** Time of day is free within the last permitted date. */
const minInstant = minDay;
const maxInstant = maxDay + dayMs - minuteMs;
const radius = 90;
const dateAt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockAt = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const dayStart = (ms: number) => Math.floor(ms / dayMs) * dayMs;
const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export type TimeStep = 'hour' | 'day' | 'week';
const stepMs: Record<TimeStep, number> = { hour: hourMs, day: dayMs, week: 7 * dayMs };

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

export function bindTimeline(change: (date: string, time: string) => void, signal: AbortSignal) {
  const date = byId<HTMLInputElement>('transit-date');
  const time = byId<HTMLInputElement>('transit-time');
  const slider = byId<HTMLInputElement>('timeline');
  const previous = byId<HTMLButtonElement>('previous-day');
  const next = byId<HTMLButtonElement>('next-day');
  const marker = byId('now-marker');
  const stepButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-step]')];
  let center = dayStart(Date.now());
  let selected = center;
  let step: TimeStep = 'day';

  function display(instant: number, recenter = false) {
    selected = Math.min(maxInstant, Math.max(minInstant, instant));
    const day = dayStart(selected);
    if (recenter || Math.abs(day - center) > radius * dayMs) center = day;
    const first = Math.max(minDay, center - radius * dayMs);
    const last = Math.min(maxDay, center + radius * dayMs);
    date.value = dateAt(selected);
    time.value = clockAt(selected);
    slider.min = String((first - center) / dayMs);
    slider.max = String((last - center) / dayMs);
    slider.value = String((day - center) / dayMs);
    slider.setAttribute('aria-valuetext', `${date.value} ${time.value} UTC`);
    byId('earliest-day').textContent = dateAt(first);
    byId('latest-day').textContent = dateAt(last);
    previous.disabled = selected <= minInstant;
    next.disabled = selected >= maxInstant;
    byId('time-relative').textContent = relativeLabel(selected, Date.now());
    placeMarker(first, last);
    change(date.value, time.value);
  }

  /** Marks today on the scrub track whenever it falls inside the visible window. */
  function placeMarker(first: number, last: number) {
    const today = dayStart(Date.now());
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

  function readDate(commit: boolean) {
    const day = Date.parse(date.value);
    // WebKit can expose the edited value before it updates native range validity.
    if (Number.isFinite(day) && day >= minDay && day <= maxDay) {
      const instant = day + (selected - dayStart(selected));
      if (instant !== selected || commit) display(instant, dayStart(instant) !== dayStart(selected));
    } else if (date.value || commit) {
      if (commit) date.value = dateAt(selected);
      const status = byId('transit-status');
      status.textContent = 'Choose a transit date from 1550-01-01 through 2650-01-03.';
      status.hidden = false;
    }
  }
  date.addEventListener('input', () => readDate(false), { signal });
  date.addEventListener('change', () => readDate(true), { signal });

  function readTime(commit: boolean) {
    const value = time.value.trim();
    if (clockPattern.test(value)) {
      const [hours, minutes] = value.split(':').map(Number);
      const instant = dayStart(selected) + hours * hourMs + minutes * minuteMs;
      if (instant !== selected) display(instant);
      return;
    }
    if (!commit) return;
    time.value = clockAt(selected);
    const status = byId('transit-status');
    status.textContent = 'Enter a UTC time as HH:MM using the 24-hour clock.';
    status.hidden = false;
  }
  time.addEventListener('input', () => readTime(false), { signal });
  time.addEventListener('change', () => readTime(true), { signal });

  slider.addEventListener('input', () => display(center + slider.valueAsNumber * dayMs + (selected - dayStart(selected))), { signal });
  previous.addEventListener('click', () => display(selected - stepMs[step]), { signal });
  next.addEventListener('click', () => display(selected + stepMs[step]), { signal });
  for (const button of stepButtons) button.addEventListener('click', () => setStep(button.dataset.step as TimeStep), { signal });
  byId('time-now').addEventListener('click', now, { signal });
  setStep('day');
  now();
}
