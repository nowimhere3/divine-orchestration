import type { EventMoment } from '../domain/event';
import { findResearchConvergences } from '../research';
import type { ConvergenceMarker, ConvergencePeriod, ConvergenceResult, ResearchSession } from '../research';
import { planetName } from './chart-data';
import { impactContactLabel, impactDays } from './event-impact-view';
import { node } from './readings';
import { byId } from './timeline';

function time(moment: EventMoment | null, precise = false): string {
  if (!moment) return 'Beyond observed coverage';
  if (moment.utc) return (precise ? moment.utc.slice(0, -1) : moment.utc.slice(0, 16)).replace('T', ' ') + ' UTC';
  return moment.jdTt === null ? 'Time unavailable' : `JD ${moment.jdTt.toFixed(8)} TT`;
}

function span(start: EventMoment, end: EventMoment, precise = false) {
  return `${time(start, precise)} → ${time(end, precise)}`;
}

function markerText(marker: ConvergenceMarker, precise = false): string {
  const kind = { 'exact-pass': 'Exact pass', station: 'Station', 'house-ingress': 'Ingress' }[marker.kind];
  return `${time(marker.at, precise)} · ${kind} · ${impactContactLabel(marker.impact)} · Impact ${marker.impact.total}`;
}

/** Keep the evidence navigable on long searches. Render one page when its disclosure opens. */
function paged<T>(host: HTMLElement, rows: readonly T[], label: string, render: (row: T) => HTMLElement, size = 20) {
  const list = node('div');
  list.className = 'overlap-evidence-list';
  const nav = node('div');
  nav.className = 'event-pages';
  const previous = node('button', 'Previous');
  const next = node('button', 'Next');
  previous.type = next.type = 'button';
  previous.setAttribute('aria-label', `Previous ${label}`);
  next.setAttribute('aria-label', `Next ${label}`);
  const position = node('span');
  position.setAttribute('role', 'status');
  nav.append(previous, position, next);
  let page = 0;
  function show() {
    const from = page * size;
    const to = Math.min(from + size, rows.length);
    list.replaceChildren(...rows.slice(from, to).map(render));
    position.textContent = `${from + 1}–${to} of ${rows.length} ${label}`;
    previous.disabled = page === 0;
    next.disabled = to === rows.length;
  }
  previous.addEventListener('click', () => { page -= 1; show(); if (previous.disabled) next.focus(); });
  next.addEventListener('click', () => { page += 1; show(); if (next.disabled) previous.focus(); });
  host.append(list);
  if (rows.length > size) host.append(nav);
  show();
}

function evidence<T>(title: string, rows: readonly T[], label: string, render: (row: T) => HTMLElement) {
  const details = node('details');
  details.className = 'overlap-evidence';
  details.append(node('summary', `${title} (${rows.length})`));
  function expand() {
    if (!details.open) return;
    details.removeEventListener('toggle', expand);
    if (rows.length) paged(details, rows, label, render);
    else details.append(node('p', `No ${label} in this period.`));
  }
  details.addEventListener('toggle', expand);
  return details;
}

function renderPeriod(period: ConvergencePeriod) {
  const card = node('article');
  card.className = 'overlap-period';
  const title = node('h4', span(period.start, period.end));
  const summary = node('p', `${impactDays(period.observedDays)} observed days · Peak ${period.peakConcurrentBodies} distinct bodies`);
  const bodies = node('p', `Across the period: ${period.bodies.map(planetName).join(', ')}.`);
  card.append(title, summary, bodies);
  if (!period.complete) {
    const limits = [period.clippedStart && 'Clipped at start', period.clippedEnd && 'Clipped at end'].filter(Boolean);
    const note = node('p', limits.length ? `${limits.join(' · ')}. Duration reflects the observed range.` : 'Coverage or interval evidence is incomplete.');
    note.className = 'hint';
    card.append(note);
  }

  const bands = new Map<number, number>();
  const peaks: { start: ConvergencePeriod['start']; end: ConvergencePeriod['end'] }[] = [];
  for (const segment of period.segments) {
    const count = segment.bodies.length;
    bands.set(count, (bands.get(count) ?? 0) + segment.end.jdTt - segment.start.jdTt);
    if (count === period.peakConcurrentBodies) {
      const last = peaks.at(-1);
      if (last?.end.jdTt === segment.start.jdTt) last.end = segment.end;
      else peaks.push({ start: segment.start, end: segment.end });
    }
  }
  const bandsList = node('ul');
  bandsList.className = 'overlap-bands';
  bandsList.setAttribute('aria-label', 'Observed time by concurrent body count');
  for (const [count, days] of [...bands].sort((a, b) => a[0] - b[0])) {
    const band = node('li', `${count} bodies · ${impactDays(days)} days`);
    const bar = node('progress');
    bar.max = period.observedDays;
    bar.value = days;
    bar.setAttribute('aria-label', `Share of observed time with ${count} bodies`);
    band.append(bar);
    bandsList.append(band);
  }
  const highlights = [...peaks]
    .sort((a, b) => (b.end.jdTt - b.start.jdTt) - (a.end.jdTt - a.start.jdTt) || a.start.jdTt - b.start.jdTt)
    .slice(0, 3).sort((a, b) => a.start.jdTt - b.start.jdTt);
  const highlightsList = node('ul');
  highlightsList.className = 'overlap-preview';
  highlightsList.append(...highlights.map(peak => node('li', span(peak.start, peak.end))));
  card.append(bandsList, node('h5', peaks.length > 3 ? 'Three longest peak sub-windows' : 'Peak sub-windows'), highlightsList);
  const nearPeak = period.markers.filter(marker => highlights.some(peak => marker.at.jdTt >= peak.start.jdTt && marker.at.jdTt <= peak.end.jdTt));
  const examples = (nearPeak.length ? nearPeak : period.markers).slice(0, 3);
  if (examples.length) {
    const preview = node('ul');
    preview.className = 'overlap-preview';
    preview.append(...examples.map(marker => node('li', markerText(marker))));
    card.append(node('h5', nearPeak.length ? 'Timing markers at peak' : 'Timing markers in this period'), preview);
  }
  const contacts = new Map(period.contacts.map(contact => [contact.contactKey, contact]));
  card.append(
    evidence('Membership segments', period.segments, 'segments', segment => {
      const row = node('section');
      const list = node('ul');
      list.append(...segment.contactKeys.map(key => {
        const contact = contacts.get(key)!;
        return node('li', `${impactContactLabel(contact)} · Impact ${contact.total}`);
      }));
      row.append(node('strong', span(segment.start, segment.end, true)),
        node('p', segment.bodies.map(planetName).join(', ')), list);
      return row;
    }),
    evidence('Contributing contacts and series', period.contacts, 'contacts', contact => {
      const row = node('section');
      row.append(node('strong', `${impactContactLabel(contact)} · Impact ${contact.total}${contact.missingData.length ? ' · Limited evidence' : ''}`));
      if ('windows' in contact.evidence) {
        for (const { facts, observedDays, durationIsMinimum } of contact.evidence.windows) {
          const angle = facts.kind === 'angle-aspect-window' ? `${facts.targetAngle.toUpperCase()} · ` : '';
          row.append(node('p', `${angle}${time(facts.startsAt, true)} → ${time(facts.endsAt, true)} · ${facts.allowedOrbDeg}° orb`));
          row.append(node('p', `Window ${facts.series.windowIndex + 1} of ${facts.series.windowCountInRange} · ${facts.series.exactPassCountInRange} exact in series · ${facts.series.complete ? 'Complete series' : 'Open at horizon'}${observedDays === null ? '' : ` · ${durationIsMinimum ? 'At least ' : ''}${impactDays(observedDays)} days observed`}`));
        }
      }
      return row;
    }),
    evidence('All timing markers', period.markers, 'markers', marker => node('p', markerText(marker, true))),
  );
  return card;
}

export function mountConvergenceExplorer(signal: AbortSignal) {
  const panel = byId<HTMLDetailsElement>('event-convergence');
  const minimum = byId<HTMLInputElement>('event-convergence-minimum');
  const moon = byId<HTMLInputElement>('event-convergence-moon');
  const coverage = byId('event-convergence-coverage');
  const output = byId('event-convergence-results');
  let session: ResearchSession | null = null;
  let cached: ConvergenceResult | undefined;

  function render() {
    if (!panel.open || !session) return;
    if (!minimum.validity.valid || !Number.isFinite(minimum.valueAsNumber)) return;
    const minimumImpact = minimum.valueAsNumber;
    if (cached?.minimumImpact === minimumImpact && cached.includeMoonMarkers === moon.checked) return;
    cached = findResearchConvergences(session, { minimumImpact, includeMoonMarkers: moon.checked });
    const found = cached;
    const { range, status } = found.coverage;
    const restrictions = [
      status !== 'complete' && 'The calculated coverage is incomplete.',
      range.clippedToCoverage && 'The requested dates extend beyond the calculated coverage.',
      found.omittedWindows.length > 0 && `${found.omittedWindows.length} contact window boundaries could not be used.`,
      moon.disabled ? 'Moon markers are unavailable in this query.' : (moon.checked ? 'Calculated Moon markers are shown where available.' : 'Moon markers are off.'),
    ].filter(Boolean).join(' ');
    coverage.textContent = `Calculated range: ${span(range.effectiveStart, range.effectiveEnd)}. ${restrictions}`;
    output.replaceChildren();
    const heading = node('p', found.periods.length ? `${found.periods.length} overlap ${found.periods.length === 1 ? 'period' : 'periods'} at Impact ${minimumImpact}+.` :
      `No sustained overlap at Impact ${minimumImpact}+ in this search.`);
    heading.setAttribute('role', 'status');
    output.append(heading);
    if (found.periods.length) paged(output, found.periods, 'periods', renderPeriod, 5);
    if (found.coincidences.length) {
      output.append(evidence('Endpoint-only coincidences', found.coincidences, 'coincidences', item =>
        node('p', `${time(item.at, true)} · ${planetName(item.endingBody)} ends as ${planetName(item.startingBody)} begins`)));
    }
  }

  panel.addEventListener('toggle', render, { signal });
  minimum.addEventListener('change', () => {
    if (!minimum.validity.valid || !Number.isFinite(minimum.valueAsNumber)) minimum.value = String(cached?.minimumImpact ?? 65);
    render();
  }, { signal });
  moon.addEventListener('change', render, { signal });
  panel.addEventListener('click', event => {
    const preset = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-overlap-minimum]');
    if (!preset) return;
    minimum.value = preset.dataset.overlapMinimum!;
    render();
  }, { signal });

  return {
    getOptions() {
      return {
        minimumImpact: minimum.validity.valid && Number.isFinite(minimum.valueAsNumber) ? minimum.valueAsNumber : (cached?.minimumImpact ?? 65),
        includeMoonMarkers: !moon.disabled && moon.checked,
      };
    },
    setSession(next: ResearchSession | null) {
      if (session === next) return;
      session = next;
      cached = undefined;
      panel.hidden = !next;
      if (!next) {
        panel.open = false;
        output.replaceChildren();
        coverage.textContent = '';
        return;
      }
      moon.disabled = next.rawResult.status === 'unavailable' ||
        !next.focus.effectiveTransitingBodies.includes('moon') || !next.rawResult.settings.bodies.includes('moon') ||
        next.rawResult.unavailable.some(issue => issue.kind === 'transit-body' && issue.point.planetId === 'moon');
      if (moon.disabled) moon.checked = false;
      render();
    },
  };
}
