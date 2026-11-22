import type { Chart, HouseId, PlanetId } from '../domain/chart';
import type { EventMoment } from '../domain/event';
import { researchFindingScopes } from '../research/event-scope';
import { freezeResearchSelection, rankResearchSelection } from '../research/export-selection';
import type { ResearchSelection, ResultScope } from '../research/export-selection';
import {
  buildRangeSearchRequest,
  canReuseSessionComputation,
  createResearchSession,
  isSessionCompatibleWithChart,
  prepareExportHandoff,
  reEvaluateResearchSession,
  resolveChartFactors,
  resolveResearchFocus,
  scoreResearchImpact,
  validateQueryRangeSpan,
} from '../research';
import type {
  EvaluatedEvent,
  PersonalImpactScore,
  ResearchExportHandoff,
  ResearchSession,
} from '../research';
import { startEventRangeSearch } from '../search/client';
import type { EventRangeSearchJob } from '../search/client';
import type {
  AngleAspectWindowEvent,
  EventRangeSearchResult,
  HouseIngressEvent,
  RangeAspectWindowEvent,
  RangeEvent,
} from '../search/range';
import { utcFromTt } from '../time/atomic-offsets';
import { resolveBirthTime } from '../time/resolve';
import { planetName, titleCase } from './chart-data';
import {
  classifyRangeEvent,
  groupEvaluatedByMonth,
  rangeExactCount,
  rangeMomentEpochMs,
  rangePassViews,
  rangePrimaryMoment,
} from './event-model';
import type { EventFilter } from './event-model';
import { impactCycleKeys } from './event-ranking';
import type { EventRankingOrder, EventTopLimit, RankedEventRow } from './event-ranking';
import { impactExplanation } from './event-impact-view';
import { mountConvergenceExplorer } from './convergence-explorer';
import { aspectSymbols, glyph, tone, toneText } from './inspector';
import { node, refLabel } from './readings';
import { mountResearchControls } from './research-controls';
import { byId } from './timeline';

const pageSize = 20;

const TIMING_TEXT: Record<RangeEvent['timing'], string> = {
  past: 'Past',
  present: 'Happening now',
  future: 'Upcoming',
  unknown: 'Timing unknown',
};

const WARNING_LABELS: Partial<Record<EventRangeSearchResult['warnings'][number], string>> = {
  'interval-clipped': 'The selected interval was shortened to the available ephemeris.',
  'near-coverage-edge': 'The interval is near the edge of the planetary data.',
  'utc-unavailable': 'UTC is unavailable for some times. Those results use TT.',
  'future-utc-assumption': 'Future UTC assumes the latest confirmed leap-second offset.',
};

const WEEKDAY_FMT = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' });
const MONTH_SHORT_FMT = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });

function momentLabel(moment: EventMoment | null, missing = 'Outside the search interval'): string {
  if (!moment) return missing;
  return moment.utc
    ? moment.utc.replace('T', ' ').replace('Z', ' UTC')
    : moment.jdTt === null
      ? 'Time unavailable'
      : `JD ${moment.jdTt.toFixed(5)} TT (UTC unavailable)`;
}

/** Card timestamps are to the minute; the Details section keeps full precision. */
function minuteLabel(moment: EventMoment | null, missing: string): string {
  if (!moment) return missing;
  return moment.utc ? `${moment.utc.slice(0, 16).replace('T', ' ')} UTC` : momentLabel(moment, missing);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const element = node(tag, text);
  element.className = className;
  return element;
}

function chip(text: string, className: string) {
  return el('li', `chip ${className}`, text);
}

function medallion(id: PlanetId, layer: string, label: string) {
  const wrapper = el('span', 'event-glyph');
  wrapper.append(glyph(id, layer));
  wrapper.title = label;
  return wrapper;
}

function angleMedallion(angle: string, label: string) {
  const wrapper = el('span', 'event-glyph');
  const mark = node('span', angle.toUpperCase());
  mark.className = 'glyph angle-glyph';
  mark.setAttribute('aria-hidden', 'true');
  wrapper.append(mark);
  wrapper.title = label;
  return wrapper;
}

function houseMedallion(houseId: HouseId, label: string) {
  const wrapper = el('span', 'event-glyph');
  const mark = node('span', `H${houseId}`);
  mark.className = 'glyph house-glyph';
  mark.setAttribute('aria-hidden', 'true');
  wrapper.append(mark);
  wrapper.title = label;
  return wrapper;
}

function dateBlock(moment: EventMoment | null) {
  const block = el('div', 'event-date');
  block.setAttribute('aria-hidden', 'true');
  const ms = rangeMomentEpochMs(moment);
  if (ms === null) {
    block.append(el('span', 'event-day', '—'), el('span', 'event-month-name', 'No date'));
    return block;
  }
  const date = new Date(ms);
  block.append(
    el('span', 'event-day', String(date.getUTCDate())),
    el('span', 'event-month-name', MONTH_SHORT_FMT.format(date)),
    el('span', 'event-weekday', WEEKDAY_FMT.format(date)),
  );
  return block;
}

function appendPassList(body: HTMLElement, event: RangeAspectWindowEvent | AngleAspectWindowEvent) {
  if (!event.passes.length) {
    body.append(el('p', 'event-note', 'No exact contact or closest approach observed inside this interval.'));
    return;
  }
  const passes = el('ul', 'pass-list');
  const totalExact = event.series.exactPassCountInRange || rangeExactCount(event);
  for (const view of rangePassViews(event)) {
    const entry = node('li');
    const near = view.pass.state === 'near-miss';
    entry.className = near ? 'pass pass-near' : 'pass';
    entry.append(
      el(
        'strong',
        'pass-kind',
        near
          ? 'Near miss'
          : view.number && totalExact > 1
            ? `Exact contact ${view.number} of ${totalExact}`
            : 'Exact contact',
      ),
      ` · ${minuteLabel(view.pass.at, 'Time unavailable')}`,
    );
    if (view.pass.residualDeg !== null && near) {
      entry.append(` · ${view.pass.residualDeg.toFixed(6)}° from exact`);
    }
    if (view.retrograde) {
      entry.append(' ', el('span', 'chip chip-retro', '℞ Retrograde pass'));
    }
    passes.append(entry);
  }
  body.append(passes);
}

function detailsFor(item: EvaluatedEvent, open: boolean) {
  const { event, relevance } = item;
  const details = node('details');
  details.className = 'event-more';
  details.open = open;
  details.append(node('summary', 'Details'));

  const list = node('dl');
  const row = (term: string, value: string) => list.append(node('dt', term), node('dd', value));

  if (event.kind === 'station') {
    row('Station', `${planetName(event.planet.planetId)} turns ${event.turns}`);
    row('Time', momentLabel(event.at));
    if (event.inNatalHouse !== null) row('Natal house', `House ${event.inNatalHouse}`);
  } else if (event.kind === 'house-ingress') {
    row('Crossing', `${planetName(event.planet.planetId)} crosses House ${event.cuspHouseId} cusp`);
    row('Transition', `House ${event.fromHouse} → House ${event.toHouse}`);
    row('Direction', event.retrograde ? 'Retrograde' : 'Direct');
    row('House system', event.houseSystem === 'WholeSign' ? 'Whole Sign' : event.houseSystem);
    row('Time', momentLabel(event.at));
  } else {
    row('Within orb from', momentLabel(event.startsAt));
    row('Within orb until', momentLabel(event.endsAt));
    row('Allowed orb', `${event.allowedOrbDeg}°`);
    for (const companion of item.axisCompanions) {
      row(
        `Same contact (${companion.angle.toUpperCase()})`,
        `${titleCase(companion.aspect)} within ${companion.allowedOrbDeg}° · ${momentLabel(companion.startsAt)} → ${momentLabel(companion.endsAt)}`,
      );
    }
    if (event.clippedStart || event.series.clippedStart) row('Start', 'Began before the search interval or retrograde shadow');
    if (event.clippedEnd || event.series.clippedEnd) row('End', 'Continues after the search interval or retrograde shadow');
    if (event.series.isRetrogradeSeries) {
      row(
        'Series continuity',
        `Window ${event.series.windowIndex + 1} of ${event.series.windowCountInRange} (${event.series.exactPassCountInRange} exact ${event.series.exactPassCountInRange === 1 ? 'pass' : 'passes'} · ${event.series.complete ? 'Complete' : 'Open at horizon'})`,
      );
    }
    event.passes.forEach((pass, index) => row(
      `Pass ${index + 1}`,
      `${pass.state === 'near-miss' ? 'Near miss' : 'Exact contact'} · ${momentLabel(pass.at)}`
      + (pass.residualDeg === null ? '' : ` · ${pass.residualDeg.toFixed(6)}° from exact`)
      + (pass.retrograde ? ' · ℞' : ''),
    ));
  }

  // Transparent additive score breakdown (strictly auditable)
  row('Relevance tier', `${titleCase(relevance.tier)} · Display score ${relevance.score} (raw sum ${relevance.rawScore})`);
  for (const reason of relevance.reasons) {
    const sign = reason.points >= 0 ? `+${reason.points}` : String(reason.points);
    row(`${sign} pts (${reason.category})`, reason.summary);
  }

  details.append(list);
  return details;
}

function eventCard(
  item: EvaluatedEvent,
  session: ResearchSession,
  showFocusWhy: boolean,
  open: boolean,
  impact: PersonalImpactScore,
) {
  const { event, relevance } = item;
  const kindClass = classifyRangeEvent(event);
  const itemEl = node('li');
  itemEl.className = `event-card event-${kindClass}`;
  if (event.kind === 'angle-aspect-window') itemEl.classList.add('event-angle');
  if (relevance.tier === 'primary') itemEl.classList.add('relevance-primary');
  else if (relevance.tier === 'context') itemEl.classList.add('relevance-context');

  const body = el('div', 'event-body');
  const chips = el('ul', 'chips event-chips');
  chips.setAttribute('aria-label', 'Event status');
  const when = el('p', 'event-when');
  const moment = rangePrimaryMoment(event);
  itemEl.append(dateBlock(moment), body);

  if (event.kind === 'station') {
    const retrograde = event.turns === 'retrograde';
    const title = el('h4', 'event-title');
    title.append(
      medallion(event.planet.planetId, 'transit', planetName(event.planet.planetId)),
      `${planetName(event.planet.planetId)} stations ${event.turns}`,
    );
    when.append(minuteLabel(event.at, 'Time unavailable'));
    chips.append(
      chip('Station', 'chip-station'),
      chip(retrograde ? '℞ Turns retrograde' : 'Turns direct', retrograde ? 'chip-retro' : 'chip-direct'),
    );
    if (event.inNatalHouse !== null) {
      chips.append(chip(`House ${event.inNatalHouse}`, 'chip-quiet'));
    }
    body.append(title, when);
  } else if (event.kind === 'house-ingress') {
    const title = el('h4', 'event-title');
    title.append(
      medallion(event.planet.planetId, 'transit', planetName(event.planet.planetId)),
      houseMedallion(event.toHouse, `House ${event.toHouse}`),
      el('span', 'event-name', `Transit ${planetName(event.planet.planetId)} enters House ${event.toHouse}`),
    );
    when.append(
      `House ${event.fromHouse} → House ${event.toHouse} · ${minuteLabel(event.at, 'Time unavailable')} · ${event.houseSystem === 'WholeSign' ? 'Whole Sign' : event.houseSystem}`,
    );
    chips.append(chip('House crossing', 'chip-ingress'));
    if (event.retrograde) chips.append(chip('℞ Retrograde crossing', 'chip-retro'));
    body.append(title, when);
  } else {
    const symbol = aspectSymbols[event.aspect];
    const tonality = tone[event.aspect];
    itemEl.classList.add(`tone-${tonality}`);
    const title = el('h4', 'event-title');
    const sign = el('span', `event-aspect tone-${tonality}`, symbol);
    sign.setAttribute('aria-hidden', 'true');
    const targetName = event.kind === 'aspect-window'
      ? refLabel(event.target)
      : `Natal ${event.targetAngle.toUpperCase()}`;
    const targetMedallion = event.kind === 'aspect-window'
      ? medallion(event.target.planetId, 'natal', planetName(event.target.planetId))
      : angleMedallion(event.targetAngle, targetName);

    title.append(
      medallion(event.transit.planetId, 'transit', planetName(event.transit.planetId)),
      sign,
      targetMedallion,
      el('span', 'event-name', `${refLabel(event.transit)} · ${titleCase(event.aspect)} · ${targetName}`),
    );
    chips.append(
      chip(
        kindClass === 'exact' ? 'Exact contact' : kindClass === 'near-miss' ? 'Near miss' : 'Within orb only',
        kindClass === 'exact' ? 'chip-exact' : 'chip-quiet',
      ),
      chip(toneText[tonality], `chip-${tonality}`),
    );
    if (event.kind === 'angle-aspect-window') {
      const ends = [event.targetAngle, ...new Set(item.axisCompanions.map(companion => companion.angle))];
      chips.append(chip(item.axisCompanions.length ? `Angle axis ${ends.map(a => a.toUpperCase()).join(' / ')}` : 'Angle', 'chip-angle'));
    }
    const exactPasses = rangeExactCount(event);
    if (kindClass === 'exact' && exactPasses > 1) {
      chips.append(chip(`${exactPasses} passes`, 'chip-quiet'));
    } else if (event.series.isRetrogradeSeries && event.series.windowCountInRange > 1) {
      chips.append(chip(`℞ Series ${event.series.windowIndex + 1}/${event.series.windowCountInRange}`, 'chip-retro'));
    }
    when.append(
      `Within ${event.allowedOrbDeg}° orb: ${minuteLabel(event.startsAt, 'before the search')} → ${minuteLabel(event.endsAt, 'after the search')}`,
    );
    body.append(title, when);
    for (const companion of item.axisCompanions) {
      const same = el('p', 'event-axis-companion');
      same.append(
        el('strong', 'axis-label', 'Same contact: '),
        `${titleCase(companion.aspect)} · Natal ${companion.angle.toUpperCase()} · within ${companion.allowedOrbDeg}° orb: `
        + `${minuteLabel(companion.startsAt, 'before the search')} → ${minuteLabel(companion.endsAt, 'after the search')}`,
      );
      body.append(same);
    }
    appendPassList(body, event);
  }

  chips.append(chip(TIMING_TEXT[event.timing], `chip-timing-${event.timing}`));
  if ((event.kind === 'aspect-window' || event.kind === 'angle-aspect-window') && (event.clippedStart || event.clippedEnd)) {
    chips.append(chip('Clipped by search interval', 'chip-quiet'));
  }

  // Relevance & theme chips (always auditable)
  if (showFocusWhy) {
    chips.append(
      chip(
        relevance.tier === 'primary' ? 'Primary' : relevance.tier === 'secondary' ? 'Secondary' : 'Broader context',
        `chip-tier-${relevance.tier}`,
      ),
      chip(`Theme Relevance Score ${relevance.score}`, 'chip-score'),
    );
    for (const themeId of relevance.matchedThemeIds) {
      const themeLabel = session.themeSnapshot.find(t => t.id === themeId)?.label ?? themeId;
      chips.append(chip(themeLabel, 'chip-theme'));
    }
  } else {
    chips.append(chip(`Theme Relevance Score ${relevance.score}`, 'chip-score'));
  }
  const impactChip = chip(`Personal Impact ${impact.total}/100${impact.missingData.length ? ' · limited evidence' : ''}`, 'chip-impact');
  impactChip.dataset.impactScore = String(impact.total);
  chips.prepend(impactChip);

  body.append(chips);

  if (showFocusWhy && relevance.whyRelevant) {
    const why = el('p', 'event-why');
    why.append(el('strong', 'why-label', 'Why relevant: '), relevance.whyRelevant);
    body.append(why);
  }

  const footerRow = el('div', 'event-card-actions');
  footerRow.append(detailsFor(item, open), impactExplanation(impact, momentLabel));
  const jumpMs = rangeMomentEpochMs(moment);
  if (jumpMs !== null) {
    const jumpBtn = el('button', 'secondary event-jump', 'Jump to Time Machine');
    jumpBtn.type = 'button';
    jumpBtn.dataset.jumpEpoch = String(jumpMs);
    footerRow.append(jumpBtn);
  }
  body.append(footerRow);

  return itemEl;
}

export interface EventSearchController {
  reset(message: string): void;
  syncChart(chart: Chart, resetMessage?: string): void;
  getSession(): ResearchSession | null;
  prepareHandoff(): ResearchExportHandoff | null;
}

export interface EventSearchHooks {
  onJumpToEpoch?: (epochMs: number) => void;
  onExportResearch?: (selection: ResearchSelection) => string;
  onExportSourceChanged?: () => void;
}

export function mountEventSearch(
  deltaT: (year: number) => number,
  current: () => { chart: Chart; referenceTt: number | null },
  hooksOrSignal: EventSearchHooks | AbortSignal,
  maybeSignal?: AbortSignal,
): EventSearchController {
  const hooks: EventSearchHooks = hooksOrSignal instanceof AbortSignal ? {} : hooksOrSignal;
  const signal = hooksOrSignal instanceof AbortSignal ? hooksOrSignal : maybeSignal!;

  const form = byId<HTMLFormElement>('event-form');
  const dates = byId<HTMLFieldSetElement>('event-inputs');
  const from = byId<HTMLInputElement>('event-from');
  const to = byId<HTMLInputElement>('event-to');
  const cancel = byId<HTMLButtonElement>('event-cancel');
  const progress = byId<HTMLProgressElement>('event-progress');
  const status = byId('event-status');
  const output = byId('event-results');
  const toolbar = byId('event-toolbar');
  const scopeGroup = byId<HTMLFieldSetElement>('research-scope-group');
  const sortSelect = byId<HTMLSelectElement>('research-sort');
  const priorityOption = byId<HTMLOptionElement>('research-priority');
  const themeMatchWrap = byId('research-theme-match-wrap');
  const themeMatch = byId<HTMLInputElement>('research-theme-match');
  const impactEnabled = byId<HTMLInputElement>('research-impact-enabled');
  const impactCutoff = byId<HTMLInputElement>('research-impact-cutoff');
  const impactValue = byId<HTMLOutputElement>('research-impact-value');
  const topSelect = byId<HTMLSelectElement>('research-top');
  const configuration = byId<HTMLDetailsElement>('research-configuration');
  const moonFilterWrap = byId('research-moon-filter-wrap');
  const showMoonCb = byId<HTMLInputElement>('research-show-moon');
  const convergeWrap = byId('research-converge-wrap');
  const convergeOnlyCb = byId<HTMLInputElement>('research-converge-only');
  const summary = byId('event-summary');
  const details = byId<HTMLInputElement>('event-details');
  const exportRow = byId('event-export-row');
  const exportButton = byId<HTMLButtonElement>('export-research');
  const exportShortcut = byId<HTMLButtonElement>('export-research-shortcut');
  const headingRow = byId('event-results-heading-row');
  const explorer = mountConvergenceExplorer(signal);

  const staleNote = byId('event-stale');
  let activeJob: EventRangeSearchJob | undefined;
  let session: ResearchSession | null = null;
  let rankedFacts: { session: ResearchSession; impact: ReturnType<typeof scoreResearchImpact>; cycles: ReturnType<typeof impactCycleKeys> } | undefined;
  let selectionView: Omit<ResearchSelection, 'overlap'> | undefined;
  let page = 0;

  function syncExportAction() {
    headingRow.hidden = !session;
    exportRow.hidden = !session || !hooks.onExportResearch;
    exportShortcut.hidden = exportRow.hidden;
    exportShortcut.disabled = exportButton.disabled = Boolean(activeJob) || !staleNote.hidden;
  }

  function updateSession(next: ResearchSession | null) {
    if (session !== next) hooks.onExportSourceChanged?.();
    session = next;
    rankedFacts = undefined;
    selectionView = undefined;
    explorer.setSession(next);
    syncExportAction();
  }

  /** Marks the displayed results as belonging to earlier settings until the next search or reuse. */
  function markStale(message: string) {
    staleNote.hidden = false;
    output.dataset.stale = 'true';
    toolbar.dataset.stale = 'true';
    byId('event-convergence').dataset.stale = 'true';
    status.textContent = message;
    hooks.onExportSourceChanged?.();
    syncExportAction();
  }
  function clearStale() {
    staleNote.hidden = true;
    delete output.dataset.stale;
    delete toolbar.dataset.stale;
    delete byId('event-convergence').dataset.stale;
    syncExportAction();
  }

  /** Plain-language status for a session. Counts are presented events, never the raw calculation size. */
  function sessionStatus(next: ResearchSession, cached: boolean) {
    const { counts } = next.evaluated;
    const partial = next.rawResult.status === 'partial';
    if (next.rawResult.status === 'unavailable') {
      return next.rawResult.reason === 'outside-coverage'
        ? 'The interval is outside the available ephemeris.'
        : 'The calculations were unavailable.';
    }
    const outside = counts.outsideQueryScope
      ? ` ${counts.outsideQueryScope.toLocaleString('en')} calculated ${counts.outsideQueryScope === 1 ? 'event' : 'events'} for planets outside this query are not shown.`
      : '';
    const merged = counts.axisDuplicatesMerged
      ? ` ${counts.axisDuplicatesMerged.toLocaleString('en')} opposite-angle ${counts.axisDuplicatesMerged === 1 ? 'window is' : 'windows are'} shown with the contact they share.`
      : '';
    if (!counts.total) {
      return (partial ? 'No events found in the available data.' : 'No events found in the interval.') + outside;
    }
    if (cached && next.focus.hasNarrowedFocus) {
      const text = `Showing ${next.evaluated.relevant.length} relevant of ${counts.total} calculated ${counts.total === 1 ? 'event' : 'events'}`;
      return `${text}${cached ? ' (cached calculation)' : ''}.${merged}${outside}`;
    }
    return `Found ${counts.total} ${counts.total === 1 ? 'event' : 'events'}${partial ? ' in the available data' : ''}${cached ? ' (cached calculation)' : ''}.${merged}${outside}`;
  }

  const filter = () => (document.querySelector<HTMLInputElement>('input[name="event-filter"]:checked')?.value ?? 'exact') as EventFilter;
  const scopeRadio = (value: ResultScope) => document.querySelector<HTMLInputElement>(`input[name="research-scope"][value="${value}"]`);
  const activeScope = (): ResultScope => (document.querySelector<HTMLInputElement>('input[name="research-scope"]:checked')?.value ?? 'relevant') as ResultScope;

  function setDefaultScopeForSession(nextSession: ResearchSession) {
    if (!nextSession.focus.hasNarrowedFocus) {
      scopeRadio('all')!.checked = true;
      return;
    }
    if (nextSession.evaluated.relevant.length === 0 && nextSession.evaluated.broaderContext.length > 0) {
      scopeRadio('context')!.checked = true;
      return;
    }
    scopeRadio('relevant')!.checked = true;
  }

  const STALE_MESSAGE = 'Search settings changed. The results below are from the previous search. Choose Search events to update them.';

  /**
   * Called when any control changes. Edits that only change focus (themes, houses, rules, planet scope that is
   * a subset of the calculation, Time Machine moment) re-evaluate the cached calculation instantly. Anything that
   * needs new astronomy marks the displayed results as outdated instead of leaving them looking current.
   */
  function applyFocusUpdate() {
    if (!session || activeJob) return;
    const { chart, referenceTt } = current();
    if (!isSessionCompatibleWithChart(session, chart)) return;

    const startRes = resolveBirthTime({ date: from.value, time: '00:00', offsetOverride: '+00:00' }, deltaT);
    const endRes = resolveBirthTime({ date: to.value, time: '00:00', offsetOverride: '+00:00' }, deltaT);
    if (startRes.kind !== 'resolved' || endRes.kind !== 'resolved') {
      markStale(STALE_MESSAGE);
      return;
    }

    let query;
    try {
      query = controls.buildQuery();
    } catch {
      markStale(STALE_MESSAGE);
      return;
    }
    const span = validateQueryRangeSpan(query.computation.transitingBodies, startRes.jdTt, endRes.jdTt);
    if (!span.ok) {
      markStale(STALE_MESSAGE);
      return;
    }

    const rangeOpts = {
      startTt: startRes.jdTt,
      endTt: endRes.jdTt,
      referenceTt,
      transitChartId: 'transit',
    };
    const registry = controls.getRegistry();
    if (canReuseSessionComputation(session, query, chart, rangeOpts, registry)) {
      const prevMode = session.query.mode;
      const next = reEvaluateResearchSession(session, query, chart, registry, referenceTt);
      updateSession(next);
      if (prevMode !== query.mode || (next.focus.unavailableFocus && next.evaluated.relevant.length === 0)) {
        setDefaultScopeForSession(next);
      }
      page = 0;
      clearStale();
      status.textContent = sessionStatus(next, true);
      showPage();
    } else {
      markStale(STALE_MESSAGE);
    }
  }

  /** Re-derives past/present/future timing when the Time Machine moved, without recalculating anything. */
  function refreshTiming() {
    if (!session || activeJob) return;
    const { chart, referenceTt } = current();
    if (!isSessionCompatibleWithChart(session, chart)) return;
    const previous = session.rawResult.settings.referenceTt;
    if (previous === referenceTt || (previous !== null && referenceTt !== null && Math.abs(previous - referenceTt) < 1e-6)) return;
    session = reEvaluateResearchSession(session, session.query, chart, controls.getRegistry(), referenceTt);
    explorer.setSession(session);
    showPage();
  }

  const controls = mountResearchControls(deltaT, {
    onFocusChanged: applyFocusUpdate,
    onRangeChanged: applyFocusUpdate,
  }, signal);

  function setRunning(running: boolean) {
    dates.disabled = running;
    controls.setDisabled(running);
    cancel.hidden = !running;
    progress.hidden = !running;
    syncExportAction();
  }

  function showPage() {
    if (!session) return;
    const bound = session;
    output.replaceChildren();
    const { rawResult, evaluated, focus } = session;
    const authorized = researchFindingScopes(bound).complete;
    const presentedCount = authorized.length;
    const reference = rawResult.settings.referenceTt;

    const notes: string[] = [
      ...rawResult.warnings.flatMap(warning => WARNING_LABELS[warning] ? [WARNING_LABELS[warning]!] : []),
      ...(rawResult.unavailable.some(issue => issue.kind === 'natal-position')
        ? ['Some natal positions are unavailable. Only available targets were searched.']
        : []),
      ...rawResult.unavailable
        .filter(issue => issue.kind === 'transit-body')
        .map(issue => `${planetName(issue.point.planetId)} is unavailable for this search (${issue.reason}).`),
      ...focus.notices.map(n => n.message),
    ];

    if (presentedCount && reference !== null) {
      notes.push(
        `Timing is relative to the Time Machine moment · ${momentLabel({ jdTt: reference, jdUt: null, utc: utcFromTt(reference) })}.`,
      );
    }
    if (notes.length) {
      const list = node('ul');
      list.className = 'event-notes';
      list.append(...notes.map(text => node('li', text)));
      output.append(list);
    }

    toolbar.hidden = !presentedCount;
    // Update scope counts & visibility
    const primary = authorized.filter(item => item.relevance.tier === 'primary');
    const relevant = authorized.filter(item => item.relevance.tier !== 'context');
    const context = authorized.filter(item => item.relevance.tier === 'context');
    const showScope = focus.hasNarrowedFocus || context.length > 0;
    scopeGroup.hidden = !showScope;
    const scopeLabels: Record<ResultScope, string> = {
      relevant: `Relevant (${relevant.length})`,
      primary: `Primary (${primary.length})`,
      context: `Broader context (${context.length})`,
      all: `All (${presentedCount})`,
    };
    for (const [val, labelText] of Object.entries(scopeLabels) as [ResultScope, string][]) {
      const radio = scopeRadio(val);
      const span = radio?.nextElementSibling;
      if (span) span.textContent = labelText;
    }

    moonFilterWrap.hidden = evaluated.counts.moonCount === 0;
    convergeWrap.hidden = evaluated.counts.multiThemeConvergences === 0;
    if (evaluated.counts.moonCount === 0) showMoonCb.checked = true;
    if (evaluated.counts.multiThemeConvergences === 0) convergeOnlyCb.checked = false;
    const hasThemes = focus.activeThemes.length > 0;
    themeMatchWrap.hidden = !hasThemes;
    priorityOption.disabled = !hasThemes;
    if (!hasThemes) {
      themeMatch.checked = false;
      if (sortSelect.value === 'priority') sortSelect.value = 'chronological';
    }

    const scope = showScope ? activeScope() : 'all';
    const category = filter();
    if (rankedFacts?.session !== session) {
      const impact = scoreResearchImpact(session);
      rankedFacts = { session, impact, cycles: impactCycleKeys(impact) };
    }
    const { impact, cycles } = rankedFacts;
    const sortOrder = sortSelect.value as EventRankingOrder;
    const top = (topSelect.value === 'all' ? null : Number(topSelect.value)) as EventTopLimit;
    const minimumImpact = impactEnabled.checked ? impactCutoff.valueAsNumber : null;
    const { ranking: ranked, selection } = rankResearchSelection(bound, {
      scope, category, minimumImpact, top, sort: sortOrder,
      showMoon: showMoonCb.checked, multiThemeOnly: convergeOnlyCb.checked, matchTheme: themeMatch.checked,
    }, impact, cycles);
    const sorted = ranked.rows;
    const totalInPool = selection.stages.inViewScope;
    selectionView = selection;
    if (!presentedCount) { summary.textContent = ''; return; }
    page = Math.min(page, Math.max(0, Math.ceil(sorted.length / pageSize) - 1));
    const first = page * pageSize;
    const last = Math.min(first + pageSize, sorted.length);
    const pageItems = sorted.slice(first, last);
    const showFocusWhy = focus.hasNarrowedFocus;
    const unit = top === null ? 'events' : 'contacts or series';
    summary.textContent = sorted.length
      ? `${ranked.matchingWindows} of ${totalInPool} events match the filters${top === null ? '' : ` across ${ranked.matchingGroups} contacts or series`}. Showing ${first + 1}–${last} of ${sorted.length} ${unit}${top === null ? '' : ` (${ranked.displayedWindows} events in the Top selection)`}.`
      : `No events match this filter. 0 of ${totalInPool} events match.`;

    const groupCard = ({ item, impact: score, returns }: RankedEventRow) => {
      const card = eventCard(item, bound, showFocusWhy, details.checked, score);
      if (returns.length) {
        const linked = el('details', 'event-linked-returns');
        linked.append(node('summary', `${returns.length} linked return ${returns.length === 1 ? 'window' : 'windows'}`));
        linked.addEventListener('toggle', () => {
          if (!linked.open || linked.childElementCount > 1) return;
          const list = el('ol', 'event-cards');
          list.append(...returns.map(row => {
            const window = eventCard(row, bound, showFocusWhy, details.checked, impact.byEventId.get(row.event.id)!);
            window.classList.add('event-return-window');
            return window;
          }));
          linked.append(list);
        });
        card.querySelector('.event-body')?.append(linked);
      }
      return card;
    };

    if (sortOrder !== 'chronological') {
      const list = node('ol');
      list.className = 'event-cards';
      list.start = first + 1;
      list.append(...pageItems.map(groupCard));
      output.append(list);
    } else {
      const wrapper = node('div');
      wrapper.className = 'event-months';
      let index = first;
      const rowsByItem = new Map(pageItems.map(row => [row.item, row]));
      for (const month of groupEvaluatedByMonth(pageItems.map(row => row.item))) {
        const group = node('section');
        group.className = 'event-month';
        const heading = node('h3', month.label);
        heading.id = `event-month-${month.key}`;
        const list = node('ol');
        list.className = 'event-cards';
        list.start = index + 1;
        list.setAttribute('aria-labelledby', heading.id);
        list.append(...month.items.map(item => groupCard(rowsByItem.get(item)!)));
        index += month.items.length;
        group.append(heading, list);
        wrapper.append(group);
      }
      output.append(wrapper);
    }

    if (sorted.length > pageSize) {
      const navigation = node('div');
      navigation.className = 'event-pages';
      const prev = node('button', 'Previous results');
      const next = node('button', 'Next results');
      prev.type = next.type = 'button';
      prev.dataset.eventPage = '-1';
      next.dataset.eventPage = '1';
      prev.disabled = page === 0;
      next.disabled = last === sorted.length;
      navigation.append(prev, node('span', `${first + 1}–${last} of ${sorted.length}`), next);
      output.append(navigation);
    }
  }

  function reset(message: string) {
    const runningJob = activeJob;
    activeJob = undefined;
    runningJob?.cancel();
    updateSession(null);
    output.replaceChildren();
    toolbar.hidden = true;
    summary.textContent = '';
    clearStale();
    status.textContent = message;
    setRunning(false);
  }

  function syncChart(chart: Chart, resetMessage?: string) {
    controls.syncChart(chart);
    if (session && !isSessionCompatibleWithChart(session, chart)) {
      reset(resetMessage ?? 'Natal chart updated. Search this chart for events.');
    } else if (resetMessage && !session) {
      if (activeJob) reset(resetMessage);
      else status.textContent = resetMessage;
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (activeJob) return;
    const start = resolveBirthTime({ date: from.value, time: '00:00', offsetOverride: '+00:00' }, deltaT);
    const end = resolveBirthTime({ date: to.value, time: '00:00', offsetOverride: '+00:00' }, deltaT);
    if (start.kind !== 'resolved' || end.kind !== 'resolved') {
      status.textContent = 'Enter valid dates for the search interval.';
      return;
    }

    const spanStatus = controls.updateCoverageNote();
    if (!spanStatus.ok) {
      status.textContent = spanStatus.reason ?? 'Invalid search interval.';
      return;
    }

    const chosen = current();
    const query = controls.buildQuery();
    const registry = controls.getRegistry();
    const rangeOpts = {
      startTt: start.jdTt,
      endTt: end.jdTt,
      referenceTt: chosen.referenceTt,
      transitChartId: 'transit',
    };

    // Fast path: reuse verified U6A calculation when astronomically compatible. A moved Time Machine only
    // re-derives past/present/future timing; it never forces a new calculation.
    if (session && canReuseSessionComputation(session, query, chosen.chart, rangeOpts, registry)) {
      const next = reEvaluateResearchSession(session, query, chosen.chart, registry, chosen.referenceTt);
      updateSession(next);
      setDefaultScopeForSession(next);
      page = 0;
      clearStale();
      status.textContent = sessionStatus(next, false);
      if (next.rawResult.status !== 'unavailable') configuration.open = false;
      showPage();
      return;
    }

    const factors = resolveChartFactors(chosen.chart, { rulershipPolicy: query.focus.rulershipPolicy });
    const focus = resolveResearchFocus(query, factors, registry);
    const request = buildRangeSearchRequest(query, chosen.chart, focus, rangeOpts);

    updateSession(null);
    output.replaceChildren();
    toolbar.hidden = true;
    summary.textContent = '';
    clearStale();
    status.textContent = 'Searching planetary events…';
    progress.removeAttribute('value');
    setRunning(true);

    let job: EventRangeSearchJob | undefined;
    try {
      job = startEventRangeSearch(request, ({ completed, total }) => {
        if (job !== activeJob) return;
        progress.max = total;
        progress.value = completed;
      });
      activeJob = job;
      const found = await job.result;
      if (activeJob !== job) return;
      const next = createResearchSession({
        chart: chosen.chart,
        query,
        rangeRequest: request,
        rawResult: found,
        registry,
      });
      updateSession(next);
      setDefaultScopeForSession(next);
      page = 0;
      status.textContent = sessionStatus(next, false);
      if (next.rawResult.status !== 'unavailable') configuration.open = false;
      showPage();
    } catch (error) {
      if (job && activeJob !== job) return;
      status.textContent = error instanceof Error ? error.message : 'Event search failed.';
    } finally {
      if (activeJob === job) {
        activeJob = undefined;
        setRunning(false);
      }
    }
  }, { signal });

  cancel.addEventListener('click', () => {
    reset('Event search canceled.');
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  }, { signal });

  output.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const jumpBtn = target.closest<HTMLButtonElement>('[data-jump-epoch]');
    if (jumpBtn) {
      const epochMs = Number(jumpBtn.dataset.jumpEpoch);
      if (Number.isFinite(epochMs)) hooks.onJumpToEpoch?.(epochMs);
      return;
    }
    const pageBtn = target.closest<HTMLButtonElement>('[data-event-page]');
    if (!pageBtn) return;
    page += Number(pageBtn.dataset.eventPage);
    showPage();
    const direction = pageBtn.dataset.eventPage;
    const replacement = output.querySelector<HTMLButtonElement>(`[data-event-page="${direction}"]:enabled`);
    (replacement ?? output.querySelector<HTMLButtonElement>('[data-event-page]:enabled'))?.focus();
  }, { signal });

  toolbar.addEventListener('change', event => {
    const elTarget = event.target as HTMLElement;
    if (elTarget === impactCutoff) return;
    if (elTarget === impactEnabled) {
      impactCutoff.disabled = !impactEnabled.checked;
      impactValue.value = impactEnabled.checked ? `${impactCutoff.value}+` : 'Off';
    }
    if (elTarget !== details) page = 0;
    showPage();
  }, { signal });
  impactCutoff.addEventListener('input', () => {
    impactValue.value = `${impactCutoff.value}+`;
    page = 0;
    showPage();
  }, { signal });

  function openResearchExport() {
    if (!session || activeJob || !staleNote.hidden) return;
    if (session.query.range.startDate !== from.value || session.query.range.endDate !== to.value) {
      markStale(STALE_MESSAGE);
      return;
    }
    if (!isSessionCompatibleWithChart(session, current().chart)) {
      markStale('The natal chart changed. Search the current chart before exporting.');
      return;
    }
    if (!selectionView || selectionView.session !== session) return;
    const frozen = freezeResearchSelection({ ...selectionView, overlap: explorer.getOptions() });
    const blocked = hooks.onExportResearch?.(frozen);
    if (blocked) status.textContent = blocked;
  }
  exportButton.addEventListener('click', openResearchExport, { signal });
  exportShortcut.addEventListener('click', openResearchExport, { signal });

  window.addEventListener('hashchange', () => {
    if (location.hash === '#events') refreshTiming();
  }, { signal });
  signal.addEventListener('abort', () => activeJob?.cancel(), { once: true });
  dates.disabled = false;

  return {
    reset,
    syncChart,
    getSession: () => session,
    prepareHandoff: () => {
      if (!session || activeJob || !staleNote.hidden) return null;
      return prepareExportHandoff(session, current().chart);
    },
  };
}
