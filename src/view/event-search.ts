import { createAspectRuleSet } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { PlanetId } from '../domain/chart';
import type { AstrologyEvent, EventMoment } from '../domain/event';
import { startEventSearch } from '../search/client';
import type { EventSearchJob } from '../search/client';
import type { EventSearchResult, FixedNatalPoint } from '../search/events';
import { utcFromTt } from '../time/atomic-offsets';
import { resolveBirthTime } from '../time/resolve';
import { planetName, titleCase } from './chart-data';
import { classify, exactCount, groupByMonth, matchesFilter, passViews, primaryMoment, sortEvents } from './event-model';
import type { EventFilter } from './event-model';
import { aspectSymbols, glyph, tone, toneText } from './inspector';
import { node, refLabel } from './readings';
import { byId } from './timeline';

const pageSize = 20;

function label(moment: EventMoment | null, missing = 'Outside the search interval') {
  if (!moment) return missing;
  return moment.utc ? moment.utc.replace('T', ' ').replace('Z', ' UTC')
    : moment.jdTt === null ? 'Time unavailable' : `JD ${moment.jdTt.toFixed(5)} TT (UTC unavailable)`;
}

/** Card timestamps are to the minute; the Details section keeps full precision. */
function minute(moment: EventMoment | null, missing: string) {
  if (!moment) return missing;
  return moment.utc ? `${moment.utc.slice(0, 16).replace('T', ' ')} UTC` : label(moment, missing);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const element = node(tag, text);
  element.className = className;
  return element;
}

const weekday = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });

function dateBlock(moment: EventMoment | null) {
  const block = el('div', 'event-date');
  block.setAttribute('aria-hidden', 'true');
  const ms = moment?.utc ? Date.parse(moment.utc) : NaN;
  if (Number.isNaN(ms)) {
    block.append(el('span', 'event-day', '—'), el('span', 'event-month-name', 'No date'));
    return block;
  }
  const date = new Date(ms);
  block.append(el('span', 'event-day', String(date.getUTCDate())), el('span', 'event-month-name', monthShort.format(date)),
    el('span', 'event-weekday', weekday.format(date)));
  return block;
}

const timingText: Record<AstrologyEvent['timing'], string> = {
  past: 'Past', present: 'Happening now', future: 'Upcoming', unknown: 'Timing unknown',
};

function chip(text: string, className: string) {
  return el('li', `chip ${className}`, text);
}

function medallion(id: PlanetId, layer: string, label: string) {
  const wrapper = el('span', 'event-glyph');
  wrapper.append(glyph(id, layer));
  wrapper.title = label;
  return wrapper;
}

function detailsFor(event: AstrologyEvent, open: boolean) {
  const details = node('details');
  details.className = 'event-more';
  details.open = open;
  details.append(node('summary', 'Details'));
  const list = node('dl');
  const row = (term: string, value: string) => list.append(node('dt', term), node('dd', value));
  if (event.kind === 'station') {
    row('Station', `${planetName(event.planet.planetId)} turns ${event.turns}`);
    row('Time', label(event.at));
  } else {
    row('Within orb from', label(event.startsAt));
    row('Within orb until', label(event.endsAt));
    row('Allowed orb', `${event.allowedOrbDeg}°`);
    if (event.clippedStart) row('Start', 'Began before the search interval');
    if (event.clippedEnd) row('End', 'Continues after the search interval');
    event.passes.forEach((pass, index) => row(`Pass ${index + 1}`,
      `${pass.state === 'near-miss' ? 'Near miss' : 'Exact contact'} · ${label(pass.at)}` +
      (pass.residualDeg === null ? '' : ` · ${pass.residualDeg.toFixed(6)}° from exact`)));
  }
  details.append(list);
  return details;
}

function eventCard(event: AstrologyEvent, all: readonly AstrologyEvent[], open: boolean) {
  const item = node('li');
  const kind = classify(event);
  item.className = `event-card event-${kind}`;
  const body = el('div', 'event-body');
  const chips = el('ul', 'chips event-chips');
  chips.setAttribute('aria-label', 'Event status');
  const when = el('p', 'event-when');
  const moment = primaryMoment(event);
  item.append(dateBlock(moment), body);
  if (event.kind === 'station') {
    const retrograde = event.turns === 'retrograde';
    const title = el('h4', 'event-title');
    title.append(medallion(event.planet.planetId, 'transit', planetName(event.planet.planetId)),
      `${planetName(event.planet.planetId)} stations ${event.turns}`);
    when.append(minute(event.at, 'Time unavailable'));
    chips.append(chip('Station', 'chip-station'), chip(retrograde ? '℞ Turns retrograde' : 'Turns direct', retrograde ? 'chip-retro' : 'chip-direct'));
    body.append(title, when);
  } else {
    const symbol = aspectSymbols[event.aspect];
    const tonality = tone[event.aspect];
    item.classList.add(`tone-${tonality}`);
    const title = el('h4', 'event-title');
    const sign = el('span', `event-aspect tone-${tonality}`, symbol);
    sign.setAttribute('aria-hidden', 'true');
    title.append(medallion(event.transit.planetId, 'transit', planetName(event.transit.planetId)), sign,
      medallion(event.target.planetId, 'natal', planetName(event.target.planetId)),
      el('span', 'event-name', `${refLabel(event.transit)} · ${titleCase(event.aspect)} · ${refLabel(event.target)}`));
    chips.append(chip(kind === 'exact' ? 'Exact contact' : kind === 'near-miss' ? 'Near miss' : 'Within orb only',
      kind === 'exact' ? 'chip-exact' : 'chip-quiet'), chip(toneText[tonality], `chip-${tonality}`));
    if (kind === 'exact' && exactCount(event) > 1) chips.append(chip(`${exactCount(event)} passes`, 'chip-quiet'));
    when.append(`Within ${event.allowedOrbDeg}° orb: ${minute(event.startsAt, 'before the search')} → ${minute(event.endsAt, 'after the search')}`);
    body.append(title, when);
    if (!event.passes.length) body.append(el('p', 'event-note', 'No exact contact or closest approach observed inside this interval.'));
    const passes = el('ul', 'pass-list');
    for (const view of passViews(event, all)) {
      const entry = node('li');
      const near = view.pass.state === 'near-miss';
      entry.className = near ? 'pass pass-near' : 'pass';
      entry.append(el('strong', 'pass-kind', near ? 'Near miss' : view.number && exactCount(event) > 1 ? `Exact contact ${view.number} of ${exactCount(event)}` : 'Exact contact'),
        ` · ${minute(view.pass.at, 'Time unavailable')}`);
      if (view.pass.residualDeg !== null && near) entry.append(` · ${view.pass.residualDeg.toFixed(6)}° from exact`);
      if (view.retrograde) entry.append(' ', el('span', 'chip chip-retro', '℞ Retrograde pass'));
      passes.append(entry);
    }
    if (event.passes.length) body.append(passes);
  }
  chips.append(chip(timingText[event.timing], `chip-timing-${event.timing}`));
  if (event.kind === 'aspect-window' && (event.clippedStart || event.clippedEnd)) chips.append(chip('Clipped by search interval', 'chip-quiet'));
  body.append(chips, detailsFor(event, open));
  return item;
}

const warningLabels: Partial<Record<EventSearchResult['warnings'][number], string>> = {
  'interval-clipped': 'The selected interval was shortened to the available ephemeris.',
  'near-coverage-edge': 'The interval is near the edge of the planetary data.',
  'utc-unavailable': 'UTC is unavailable for some times. Those results use TT.',
  'future-utc-assumption': 'Future UTC assumes the latest confirmed leap-second offset.',
};

export function mountEventSearch(
  deltaT: (year: number) => number,
  current: () => { targets: readonly FixedNatalPoint[]; referenceTt: number | null },
  signal: AbortSignal,
) {
  const form = byId<HTMLFormElement>('event-form');
  const dates = byId<HTMLFieldSetElement>('event-inputs');
  const from = byId<HTMLInputElement>('event-from');
  const to = byId<HTMLInputElement>('event-to');
  const body = byId<HTMLSelectElement>('event-body');
  const cancel = byId<HTMLButtonElement>('event-cancel');
  const progress = byId<HTMLProgressElement>('event-progress');
  const status = byId('event-status');
  const output = byId('event-results');
  let active: EventSearchJob | undefined;
  let result: EventSearchResult | undefined;
  let page = 0;
  const toolbar = byId('event-toolbar');
  const summary = byId('event-summary');
  const details = byId<HTMLInputElement>('event-details');
  const filter = () => (document.querySelector<HTMLInputElement>('input[name="event-filter"]:checked')?.value ?? 'exact') as EventFilter;

  const now = new Date();
  from.value = now.toISOString().slice(0, 10);
  now.setUTCDate(now.getUTCDate() + 30);
  to.value = now.toISOString().slice(0, 10);
  for (const id of PLANET_IDS) {
    const option = node('option', planetName(id));
    option.value = id;
    body.append(option);
  }

  function setRunning(running: boolean) {
    dates.disabled = running;
    cancel.hidden = !running;
    progress.hidden = !running;
  }

  function showPage() {
    if (!result) return;
    output.replaceChildren();
    const events = result.context?.events ?? [];
    const reference = result.settings.referenceTt;
    const notes = [
      ...result.warnings.flatMap(warning => warningLabels[warning] ? [warningLabels[warning]] : []),
      ...(result.unavailable.some(issue => issue.kind === 'natal-position') ? ['Some natal positions are unavailable. Only available targets were searched.'] : []),
      ...result.unavailable.filter(issue => issue.kind === 'transit-body').map(issue =>
        `${planetName(issue.point.planetId)} is unavailable for this search (${issue.reason}).`),
    ];
    if (events.length && reference !== null) {
      notes.push(`Timing is relative to the Time Machine at search start · ${label({ jdTt: reference, jdUt: null, utc: utcFromTt(reference) })}.`);
    }
    if (notes.length) {
      const list = node('ul');
      list.className = 'event-notes';
      list.append(...notes.map(note => node('li', note)));
      output.append(list);
    }
    toolbar.hidden = !events.length;
    if (!events.length) { summary.textContent = ''; return; }
    const filtered = sortEvents(events.filter(event => matchesFilter(event, filter())));
    const hidden = events.length - filtered.length;
    summary.textContent = filtered.length
      ? `Showing ${filtered.length} of ${events.length} events${hidden ? ` · ${hidden} hidden by the filter` : ''}.`
      : `No events match this filter. ${events.length} ${events.length === 1 ? 'event is' : 'events are'} hidden.`;
    const first = page * pageSize;
    const last = Math.min(first + pageSize, filtered.length);
    const wrapper = node('div');
    wrapper.className = 'event-months';
    let index = first;
    for (const month of groupByMonth(filtered.slice(first, last))) {
      const group = node('section');
      group.className = 'event-month';
      const heading = node('h3', month.label);
      heading.id = `event-month-${month.key}`;
      const list = node('ol');
      list.className = 'event-cards';
      list.start = index + 1;
      list.setAttribute('aria-labelledby', heading.id);
      list.append(...month.events.map(event => eventCard(event, events, details.checked)));
      index += month.events.length;
      group.append(heading, list);
      wrapper.append(group);
    }
    output.append(wrapper);
    if (filtered.length > pageSize) {
      const navigation = node('div');
      navigation.className = 'event-pages';
      const prev = node('button', 'Previous results');
      const next = node('button', 'Next results');
      prev.type = next.type = 'button';
      prev.dataset.eventPage = '-1';
      next.dataset.eventPage = '1';
      prev.disabled = page === 0;
      next.disabled = last === filtered.length;
      navigation.append(prev, node('span', `${first + 1}–${last} of ${filtered.length}`), next);
      output.append(navigation);
    }
  }

  function reset(message: string) {
    const job = active;
    active = undefined;
    job?.cancel();
    result = undefined;
    output.replaceChildren();
    toolbar.hidden = true;
    summary.textContent = '';
    status.textContent = message;
    setRunning(false);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (active) return;
    const midnight = (date: string) => resolveBirthTime({ date, time: '00:00', offsetOverride: '+00:00' }, deltaT);
    const start = midnight(from.value);
    const end = midnight(to.value);
    if (start.kind !== 'resolved' || end.kind !== 'resolved') {
      status.textContent = 'Enter valid dates for the search interval.';
      return;
    }
    const chosen = current();
    const bodies = body.value === 'all' ? PLANET_IDS : [body.value as PlanetId];
    result = undefined;
    output.replaceChildren();
    toolbar.hidden = true;
    summary.textContent = '';
    status.textContent = 'Searching planetary events…';
    progress.removeAttribute('value');
    setRunning(true);
    let job: EventSearchJob | undefined;
    try {
      job = startEventSearch({
        startTt: start.jdTt, endTt: end.jdTt, referenceTt: chosen.referenceTt,
        transitChartId: 'transit', bodies, targets: chosen.targets, rules: createAspectRuleSet(),
      }, ({ completed, total }) => {
        if (job !== active) return;
        progress.max = total;
        progress.value = completed;
      });
      active = job;
      const found = await job.result;
      if (active !== job) return;
      result = found;
      page = 0;
      const count = found.context?.events.length ?? 0;
      status.textContent = found.status === 'unavailable'
        ? found.reason === 'outside-coverage' ? 'The interval is outside the available ephemeris.' : 'The calculations were unavailable.'
        : count ? `Found ${count} ${count === 1 ? 'event' : 'events'}${found.status === 'partial' ? ' in the available data' : ''}.`
          : found.status === 'partial' ? 'No events found in the available data.' : 'No events found in the interval.';
      showPage();
    } catch (error) {
      if (job && active !== job) return;
      status.textContent = error instanceof Error ? error.message : 'Event search failed.';
    } finally {
      if (active === job) {
        active = undefined;
        setRunning(false);
      }
    }
  }, { signal });
  cancel.addEventListener('click', () => {
    reset('Event search canceled.');
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  }, { signal });
  output.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-event-page]');
    if (!button) return;
    page += Number(button.dataset.eventPage);
    showPage();
    const direction = button.dataset.eventPage;
    const replacement = output.querySelector<HTMLButtonElement>(`[data-event-page="${direction}"]:enabled`);
    (replacement ?? output.querySelector<HTMLButtonElement>('[data-event-page]:enabled'))?.focus();
  }, { signal });
  toolbar.addEventListener('change', event => {
    if ((event.target as HTMLInputElement).name === 'event-filter') page = 0;
    showPage();
  }, { signal });
  signal.addEventListener('abort', () => active?.cancel(), { once: true });
  dates.disabled = false;
  return { reset };
}
