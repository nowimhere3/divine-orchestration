import {
  ELEMENT_LABELS,
  MODE_LABELS,
} from '../interpret';
import type {
  BalanceBreakdown,
  ChartTheme,
  FactCitation,
  NatalAspectReading,
  NatalReading,
  PlacementReading,
  TransitAspectReading,
  TransitHouseReading,
  TransitReading,
  TransitTheme,
} from '../interpret';
import { aspectMeta, sourcesFor } from '../knowledge';
import type { ZodiacElement, ZodiacMode } from '../knowledge';
import { formatLunarTimestamp } from '../lunar';
import { planetName } from './chart-data';
import { aspectSymbols, planetGlyphs, quiet } from './inspector';
import { learnHref } from './learn-model';
import { node } from './readings';
import { byId } from './timeline';

const ELEMENTS: readonly ZodiacElement[] = ['fire', 'earth', 'air', 'water'];
const MODES: readonly ZodiacMode[] = ['cardinal', 'fixed', 'mutable'];

export type ReadingMode = 'natal' | 'transits';

export interface ReadingPanelHooks {
  readonly onSelectKey: (key: string) => void;
  readonly onEditBirth: () => void;
  readonly onJumpToEpoch: (epochMs: number) => void;
  readonly onModeChange?: (mode: ReadingMode | null) => void;
}

export interface ReadingPanelController {
  update(reading: NatalReading): void;
  updateTransits(reading: TransitReading): void;
  open(moveFocus?: boolean, mode?: ReadingMode): void;
  close(): void;
  isOpen(): boolean;
  activeMode(): ReadingMode | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const element = node(tag, text);
  element.className = className;
  return element;
}

function chip(text: string, className = '') {
  return el('span', `chip ${className}`.trim(), text);
}

function citationButtons(citations: readonly FactCitation[]): HTMLElement | null {
  const clickable = citations.filter(c => c.selectKey);
  if (!clickable.length) return null;
  const row = el('div', 'reading-citations');
  for (const cite of clickable) {
    const button = node('button', cite.label);
    button.type = 'button';
    button.className = 'reading-cite';
    button.dataset.readingSelect = cite.selectKey!;
    button.setAttribute('aria-label', `Inspect ${cite.label} on chart`);
    row.append(button);
  }
  return row;
}

function reflectionDisclosure(question: string, detailKey: string): HTMLElement {
  const details = node('details');
  details.className = 'reflection reading-reflection';
  details.dataset.readingDetail = detailKey;
  details.append(node('summary', 'Reflection prompt'), node('p', question));
  return details;
}

function renderBalance(balance: BalanceBreakdown): HTMLElement {
  const section = el('section', 'reading-block');
  section.setAttribute('aria-labelledby', 'reading-balance-heading');
  const heading = Object.assign(node('h3', 'Element & modality balance'), { id: 'reading-balance-heading' });
  const scopeNote = quiet(
    balance.includesAngles
      ? 'Weighted across all 10 natal planets plus Ascendant and Midheaven (luminaries & ASC ×2, personal & MC ×1.5, social ×1, outer ×0.5).'
      : 'Weighted across confirmed natal planetary signs (luminaries ×2, personal ×1.5, social ×1, outer ×0.5).',
  );

  const grid = el('div', 'balance-grid');

  const elBox = el('div', 'balance-group');
  elBox.append(el('h4', 'reading-subhead', 'Four elements'));
  const elList = el('ul', 'balance-bars');
  for (const element of ELEMENTS) {
    const bucket = balance.elements[element];
    const pct = Math.round((bucket.weight / balance.totalWeight) * 100);
    const li = el('li', `balance-row element-${element}`);
    const top = el('div', 'balance-row-head');
    top.append(
      el('strong', 'balance-name', ELEMENT_LABELS[element]),
      el('span', 'balance-meta', `${bucket.count} · ${pct}%`),
    );
    const track = el('div', 'balance-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('span', `balance-fill fill-${element}`);
    fill.style.width = `${Math.max(bucket.count ? 6 : 0, pct)}%`;
    track.append(fill);
    const members = el('p', 'balance-members', bucket.bodies.length ? bucket.bodies.join(', ') : 'None');
    li.append(top, track, members);
    elList.append(li);
  }
  elBox.append(elList);

  const modeBox = el('div', 'balance-group');
  modeBox.append(el('h4', 'reading-subhead', 'Three modalities'));
  const modeList = el('ul', 'balance-bars');
  for (const mode of MODES) {
    const bucket = balance.modes[mode];
    const pct = Math.round((bucket.weight / balance.totalWeight) * 100);
    const li = el('li', 'balance-row');
    const top = el('div', 'balance-row-head');
    top.append(
      el('strong', 'balance-name', MODE_LABELS[mode]),
      el('span', 'balance-meta', `${bucket.count} · ${pct}%`),
    );
    const track = el('div', 'balance-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'balance-fill fill-mode');
    fill.style.width = `${Math.max(bucket.count ? 6 : 0, pct)}%`;
    track.append(fill);
    const members = el('p', 'balance-members', bucket.bodies.length ? bucket.bodies.join(', ') : 'None');
    li.append(top, track, members);
    modeList.append(li);
  }
  modeBox.append(modeList);

  grid.append(elBox, modeBox);
  section.append(heading, scopeNote, grid);
  return section;
}

function renderCoreCard(
  title: string,
  markText: string,
  markClass: string,
  factLine: string,
  symbolismBasis: string,
  synthesis: string,
  reflection: string,
  citations: readonly FactCitation[],
  detailKey: string,
  sensitivityNote?: string | null,
): HTMLElement {
  const card = el('article', 'reading-card');
  const head = el('div', 'reading-card-head');
  const mark = el('span', `reading-glyph ${markClass}`, markText);
  mark.setAttribute('aria-hidden', 'true');
  const headText = el('div', 'reading-card-title');
  headText.append(node('h4', title), el('p', 'reading-fact-line', factLine));
  head.append(mark, headText);
  card.append(head);
  if (sensitivityNote) card.append(el('p', 'reading-caution', sensitivityNote));
  card.append(
    el('p', 'reading-basis', `Traditional basis: ${symbolismBasis}`),
    el('p', 'reading-prose', synthesis),
  );
  const cites = citationButtons(citations);
  if (cites) card.append(cites);
  card.append(reflectionDisclosure(reflection, detailKey));
  return card;
}

function renderThemeCard(theme: ChartTheme): HTMLElement {
  const card = el('article', 'reading-card reading-theme-card');
  const badgeLabel = theme.kind === 'chart-ruler' ? 'Chart ruler'
    : theme.kind === 'stellium' ? 'Concentration'
      : theme.kind === 'pattern' ? 'Aspect pattern'
        : theme.kind === 'angular' ? 'Angular anchor'
          : theme.kind === 'hemisphere' ? 'House emphasis'
            : theme.kind === 'retrograde' ? 'Retrograde'
              : theme.kind === 'date-only' ? 'Date-only scope'
                : 'Balance';
  const top = el('div', 'reading-theme-head');
  top.append(node('h4', theme.title), chip(badgeLabel, 'reading-kind-chip'));
  card.append(
    top,
    el('p', 'reading-fact-line', `Calculated fact: ${theme.factsSummary}`),
    el('p', 'reading-basis', `Traditional symbolism: ${theme.symbolismBasis}`),
    el('p', 'reading-prose', theme.synthesis),
  );
  const cites = citationButtons(theme.citations);
  if (cites) card.append(cites);
  card.append(reflectionDisclosure(theme.reflection, `theme-${theme.id}`));
  return card;
}

function renderPlacementItem(p: PlacementReading): HTMLElement {
  const item = el('li', 'reading-card reading-placement-card');
  const head = el('div', 'reading-card-head');
  const mark = el('span', 'reading-glyph glyph-natal', `${planetGlyphs[p.planetId]}︎`);
  mark.setAttribute('aria-hidden', 'true');
  const titleWrap = el('div', 'reading-card-title');
  titleWrap.append(node('h4', p.title), el('p', 'reading-fact-line', p.factLine));
  head.append(mark, titleWrap);
  item.append(head);

  const badges = el('div', 'reading-badges');
  if (p.retrograde) badges.append(chip('℞ Retrograde', 'chip-retro'));
  if (p.isGenerationalSign) badges.append(chip('Generational sign', 'chip-quiet'));
  if (p.status === 'boundary-day') badges.append(chip('Sign boundary day', 'chip-retro'));
  if (p.aspectCount > 0) badges.append(chip(`${p.aspectCount} ${p.aspectCount === 1 ? 'aspect' : 'aspects'}`, 'chip-quiet'));
  if (badges.childElementCount) item.append(badges);

  if (p.sensitivityNote) item.append(el('p', 'reading-caution', p.sensitivityNote));
  item.append(
    el('p', 'reading-basis', `Traditional basis: ${p.symbolismBasis}`),
    el('p', 'reading-prose', p.synthesis),
  );
  const cites = citationButtons(p.citations);
  if (cites) item.append(cites);
  return item;
}

function renderAspectItem(a: NatalAspectReading): HTMLElement {
  const item = el('li', `reading-card reading-aspect-card tone-${a.tone}`);
  const meta = aspectMeta(a.aspect);
  const head = el('div', 'reading-theme-head');
  const title = node('h4');
  const sym = el('span', `reading-aspect-sym tone-${a.tone}`, `${aspectSymbols[a.aspect]}︎`);
  sym.setAttribute('aria-hidden', 'true');
  title.append(sym, ' ', a.title);
  const badges = el('div', 'reading-badges');
  badges.append(
    chip(meta.toneLabel, `chip-${a.tone}`),
    chip(a.tightness === 'tight' ? 'Tight orb' : a.tightness === 'moderate' ? 'Moderate orb' : 'Wide orb', 'chip-quiet'),
  );
  if (a.isAngleAspect) badges.append(chip('Angle contact', 'reading-kind-chip'));
  head.append(title, badges);

  item.append(
    head,
    el('p', 'reading-fact-line', a.factLine),
    el('p', 'reading-basis', `Traditional basis: ${a.symbolismBasis}`),
    el('p', 'reading-prose', a.synthesis),
  );
  const cites = citationButtons(a.citations);
  if (cites) item.append(cites);
  return item;
}

function renderTransitThemeCard(theme: TransitTheme): HTMLElement {
  const card = el('article', 'reading-card reading-theme-card reading-transit-card');
  const badgeLabel = theme.kind === 'convergence-target' ? 'Converging target'
    : theme.kind === 'convergence-house' ? 'House focus'
      : theme.kind === 'retrograde-station' ? 'Retrograde / station'
        : theme.kind === 'date-only' ? 'Date-only scope'
          : 'Lunar context';
  const top = el('div', 'reading-theme-head');
  top.append(node('h4', theme.title), chip(badgeLabel, 'transit-kind-chip'));
  card.append(
    top,
    el('p', 'reading-fact-line', `Calculated fact: ${theme.factsSummary}`),
    el('p', 'reading-basis', `Traditional symbolism: ${theme.symbolismBasis}`),
    el('p', 'reading-prose', theme.synthesis),
  );
  const cites = citationButtons(theme.citations);
  if (cites) card.append(cites);
  card.append(reflectionDisclosure(theme.reflection, `ttheme-${theme.id}`));
  return card;
}

function renderTransitAspectCard(item: TransitAspectReading, displayZone: string): HTMLElement {
  const li = el('li', `reading-card reading-aspect-card reading-transit-card tone-${item.tone}`);
  li.dataset.windowKey = item.windowKey;
  const meta = aspectMeta(item.aspect);
  const head = el('div', 'reading-card-head');
  const mark = el('span', 'reading-glyph glyph-transit', `${planetGlyphs[item.transitId]}︎`);
  mark.setAttribute('aria-hidden', 'true');
  const titleWrap = el('div', 'reading-card-title');
  const heading = node('h4');
  heading.tabIndex = -1;
  const sym = el('span', `reading-aspect-sym tone-${item.tone}`, `${aspectSymbols[item.aspect]}︎`);
  sym.setAttribute('aria-hidden', 'true');
  heading.append(sym, ' ', item.title);
  titleWrap.append(heading, el('p', 'reading-fact-line', item.factLine));
  head.append(mark, titleWrap);
  li.append(head);

  const badges = el('div', 'reading-badges');
  badges.append(
    chip(meta.toneLabel, `chip-${item.tone}`),
    chip(item.motionLabel, item.motion === 'exact' || item.motion === 'stationary' ? 'transit-kind-chip' : 'chip-quiet'),
    chip(item.tightness === 'peak' ? 'Peak orb' : item.tightness === 'tight' ? 'Tight orb' : 'Active orb', 'chip-quiet'),
  );
  if (item.retrograde) badges.append(chip('℞ Retrograde', 'chip-retro'));
  if (item.isAngleContact) badges.append(chip('Angle contact', 'transit-kind-chip'));
  if (item.enrichment) {
    const exactPassesCount = item.enrichment.passes.filter(p => p.state !== 'near-miss').length;
    const isClipped = item.enrichment.clippedStart || item.enrichment.clippedEnd;
    if (item.enrichment.isRetrogradeSeries && exactPassesCount > 1) {
      badges.append(chip(
        isClipped ? `${exactPassesCount}+ exact passes (window clipped)` : `${exactPassesCount} exact passes`,
        'chip-retro',
      ));
    } else if (isClipped && exactPassesCount >= 1) {
      badges.append(chip('Window clipped', 'chip-quiet'));
    }
  }
  li.append(badges);

  li.append(
    el('p', 'reading-basis', `Traditional basis: ${item.symbolismBasis}`),
    el('p', 'reading-prose', item.synthesis),
  );

  // Tier-2 exact passes, window bounds & "Jump to exact pass" buttons
  if (item.enrichment) {
    const en = item.enrichment;
    const isClipped = en.clippedStart || en.clippedEnd;
    const timingBox = el('div', 'transit-timing-box');
    const winStart = en.startsAtEpochMs !== null ? formatLunarTimestamp(en.startsAtEpochMs, displayZone) : 'before search window';
    const winEnd = en.endsAtEpochMs !== null ? formatLunarTimestamp(en.endsAtEpochMs, displayZone) : 'beyond search window';
    timingBox.append(el('p', 'transit-window-line', `Within ${item.maxOrbDeg}° orb: ${winStart} → ${winEnd}`));

    if (en.passes.length) {
      const passList = el('ul', 'transit-pass-list');
      for (const pass of en.passes) {
        const row = el('li', 'transit-pass-row');
        const label = pass.state === 'near-miss'
          ? `Near miss (${pass.residualDeg !== null ? `${pass.residualDeg.toFixed(2)}°` : 'short'} from exact)`
          : isClipped
            ? (pass.totalExactPasses > 1 && pass.passNumber
              ? `Observed pass ${pass.passNumber}${pass.retrograde ? ' · ℞' : ''}`
              : `Observed exact pass${pass.retrograde ? ' · ℞' : ''}`)
            : pass.totalExactPasses > 1 && pass.passNumber
              ? `Exact pass ${pass.passNumber} of ${pass.totalExactPasses}${pass.retrograde ? ' · ℞' : ''}`
              : `Exact pass${pass.retrograde ? ' · ℞' : ''}`;
        const formatted = formatLunarTimestamp(pass.epochMs, displayZone);
        const text = el('span', 'transit-pass-text');
        text.append(node('strong', label), ` · ${formatted}`);
        const jumpBtn = node('button', 'Jump to exact pass');
        jumpBtn.type = 'button';
        jumpBtn.className = 'transit-jump-btn';
        jumpBtn.dataset.jumpEpochMs = String(pass.epochMs);
        jumpBtn.dataset.jumpWindowKey = item.windowKey;
        // WCAG 2.5.3: accessible name begins verbatim with visible text "Jump to exact pass".
        jumpBtn.setAttribute('aria-label', `Jump to exact pass — ${label}, ${formatted}`);
        row.append(text, jumpBtn);
        passList.append(row);
      }
      timingBox.append(passList);
      if (isClipped) {
        timingBox.append(quiet('Search horizon clipped — additional passes may occur outside this window.'));
      }
    } else {
      timingBox.append(quiet('No exact pass observed inside this search window.'));
    }
    li.append(timingBox);
  }

  const cites = citationButtons(item.citations);
  if (cites) li.append(cites);
  li.append(reflectionDisclosure(item.reflection, `tasp-${item.windowKey}`));
  return li;
}

function renderTransitHouseCard(item: TransitHouseReading, displayZone: string): HTMLElement {
  const li = el('li', 'reading-card reading-placement-card reading-transit-card');
  const head = el('div', 'reading-card-head');
  const mark = el('span', 'reading-glyph glyph-transit', `${planetGlyphs[item.planetId]}︎`);
  mark.setAttribute('aria-hidden', 'true');
  const titleWrap = el('div', 'reading-card-title');
  titleWrap.append(node('h4', `Transit ${planetName(item.planetId)} in House ${item.houseNumber}`), el('p', 'reading-fact-line', item.factLine));
  head.append(mark, titleWrap);
  li.append(head);

  if (item.span) {
    const enter = item.span.enteredAtEpochMs !== null ? formatLunarTimestamp(item.span.enteredAtEpochMs, displayZone) : 'earlier than search window';
    const exit = item.span.exitsAtEpochMs !== null ? formatLunarTimestamp(item.span.exitsAtEpochMs, displayZone) : 'beyond search window';
    li.append(el('p', 'transit-window-line', `House ${item.houseNumber} stay: ${enter} → ${exit}${item.span.includesRetrogradeReentry ? ' (includes retrograde cusp crossing)' : ''}`));
  }

  li.append(
    el('p', 'reading-basis', `Traditional basis: ${item.symbolismBasis}`),
    el('p', 'reading-prose', item.synthesis),
  );
  const cites = citationButtons(item.citations);
  if (cites) li.append(cites);
  return li;
}

function renderSourcesDisclosure(sourceIds: readonly import('../knowledge').SourceId[]): HTMLElement {
  const sources = node('details');
  sources.className = 'sources';
  sources.dataset.readingDetail = 'sources';
  sources.append(node('summary', 'Sources and attribution'));
  sources.append(quiet('All reading copy is original to Divine Orchestration and composed from the 49-entry local knowledge library.'));
  const sourceList = node('ul');
  for (const src of sourcesFor(sourceIds)) {
    const li = node('li');
    const title = src.url
      ? Object.assign(node('a', src.title), { href: src.url, target: '_blank', rel: 'noopener noreferrer' })
      : node('span', src.title);
    li.append(title);
    if (src.url) li.append(Object.assign(node('span', ' (opens in a new tab)'), { className: 'sr-only' }));
    li.append(` · ${src.author}. ${src.used}`);
    sourceList.append(li);
  }
  sources.append(sourceList);
  return sources;
}

export function mountReadingPanel(hooks: ReadingPanelHooks, signal: AbortSignal): ReadingPanelController {
  const section = byId('personal-reading');
  const body = byId('personal-reading-body');
  const heading = byId('reading-heading');
  const eyebrow = byId('reading-eyebrow');
  const natalBtn = byId<HTMLButtonElement>('interpret-birth-btn');
  const transitBtn = byId<HTMLButtonElement>('interpret-transits-btn');
  const closeBtn = byId<HTMLButtonElement>('reading-close');
  const subtitle = byId('reading-subtitle');
  const statusEl = byId('reading-status');
  let mode: ReadingMode | null = null;
  let lastOpenedBy: ReadingMode = 'natal';
  let natalReading: NatalReading | null = null;
  let transitReading: TransitReading | null = null;
  let lastRenderSignature = '';
  let pendingJumpFocus: { windowKey: string | null; epochMs: number } | null = null;

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function syncHeader() {
    if (mode === 'transits') {
      eyebrow.textContent = 'Transit interpretation · Time Machine · Local-first';
      heading.textContent = 'Personal transit reading';
      if (transitReading) {
        subtitle.textContent = transitReading.isDemo
          ? `Greenwich demonstration chart · ${transitReading.momentLabel}`
          : transitReading.profileLabel
            ? `Profile: ${transitReading.profileLabel} · ${transitReading.momentLabel}`
            : `Calculated chart · ${transitReading.momentLabel}`;
      }
    } else {
      eyebrow.textContent = 'Natal interpretation · Local-first';
      heading.textContent = 'Personal birth-chart reading';
      if (natalReading) {
        subtitle.textContent = natalReading.isDemo
          ? 'Greenwich demonstration chart · not your birth details'
          : natalReading.profileLabel
            ? `Profile: ${natalReading.profileLabel} · ${natalReading.birthSummary}`
            : `Calculated chart · ${natalReading.birthSummary}`;
      }
    }
    natalBtn.setAttribute('aria-expanded', String(mode === 'natal'));
    natalBtn.setAttribute('aria-pressed', String(mode === 'natal'));
    transitBtn.setAttribute('aria-expanded', String(mode === 'transits'));
    transitBtn.setAttribute('aria-pressed', String(mode === 'transits'));
    closeBtn.hidden = mode === null;
  }

  function renderNatal(reading: NatalReading): HTMLElement[] {
    const parts: HTMLElement[] = [];

    if (reading.isDemo) {
      const demo = el('div', 'reading-banner reading-banner-demo');
      const copy = el('p', '', 'You are reading the Greenwich demonstration chart (2000-01-01). Enter your own birth details or load a saved profile for a personal reading.');
      const edit = node('button', 'Enter your birth details');
      edit.type = 'button';
      edit.className = 'secondary';
      edit.dataset.readingEditBirth = 'true';
      demo.append(copy, edit);
      parts.push(demo);
    }

    if (reading.omittedNotes.length || reading.sensitivityNotes.length) {
      const notices = el('section', 'reading-banner reading-banner-caution');
      notices.setAttribute('aria-label', 'Chart scope and precision notes');
      const list = el('ul', 'meaning-list');
      for (const note of [...reading.omittedNotes, ...reading.sensitivityNotes]) list.append(node('li', note));
      notices.append(list);
      parts.push(notices);
    }

    const overview = el('section', 'reading-block reading-overview');
    overview.setAttribute('aria-labelledby', 'reading-overview-heading');
    const ovHead = el('div', 'reading-overview-head');
    ovHead.append(
      Object.assign(node('h3', reading.overview.headline), { id: 'reading-overview-heading' }),
      chip(
        reading.mode === 'complete' ? `${reading.houseSystemLabel} houses`
          : reading.mode === 'no-houses' ? 'No houses (coordinates needed)'
            : reading.mode === 'date-only' ? 'Date-only (birth time unknown)'
              : 'Unavailable',
        'reading-kind-chip',
      ),
    );
    overview.append(
      ovHead,
      el('p', 'reading-fact-line', `Calculated chart facts: ${reading.overview.factsSummary}`),
      el('p', 'reading-prose reading-overview-prose', reading.overview.synthesis),
      el('p', 'quiet-note reading-epistemic', reading.overview.symbolismDisclaimer),
    );
    const ovCites = citationButtons(reading.overview.citations);
    if (ovCites) overview.append(ovCites);
    parts.push(overview);

    const core = reading.coreTrio;
    if (core.sun || core.moon || core.ascendant || core.midheaven || core.chartRuler || core.natalMoonPhase) {
      const coreSection = el('section', 'reading-block');
      coreSection.setAttribute('aria-labelledby', 'reading-core-heading');
      coreSection.append(Object.assign(node('h3', 'Core Trio, angles & chart ruler'), { id: 'reading-core-heading' }));
      const grid = el('div', 'reading-grid');
      if (core.sun) {
        grid.append(renderCoreCard(
          core.sun.title, `${planetGlyphs.sun}︎`, 'glyph-natal', core.sun.factLine,
          core.sun.symbolismBasis, core.sun.synthesis, core.sun.reflection, core.sun.citations, 'core-sun', core.sun.sensitivityNote,
        ));
      }
      if (core.moon) {
        grid.append(renderCoreCard(
          core.moon.title, `${planetGlyphs.moon}︎`, 'glyph-natal', core.moon.factLine,
          core.moon.symbolismBasis, core.moon.synthesis, core.moon.reflection, core.moon.citations, 'core-moon', core.moon.sensitivityNote,
        ));
      }
      if (core.ascendant) {
        grid.append(renderCoreCard(
          core.ascendant.title, 'ASC', 'angle-glyph', core.ascendant.factLine,
          core.ascendant.symbolismBasis, core.ascendant.synthesis, core.ascendant.reflection, core.ascendant.citations, 'core-asc', core.ascendant.sensitivityNote,
        ));
      }
      if (core.chartRuler) {
        grid.append(renderCoreCard(
          `Chart ruler: ${core.chartRuler.rulerId[0].toUpperCase()}${core.chartRuler.rulerId.slice(1)}`,
          `${planetGlyphs[core.chartRuler.rulerId]}︎`, 'glyph-natal', core.chartRuler.factLine,
          core.chartRuler.symbolismBasis, core.chartRuler.synthesis, core.chartRuler.reflection, core.chartRuler.citations, 'core-ruler',
        ));
      }
      if (core.midheaven) {
        grid.append(renderCoreCard(
          core.midheaven.title, 'MC', 'angle-glyph', core.midheaven.factLine,
          core.midheaven.symbolismBasis, core.midheaven.synthesis, core.midheaven.reflection, core.midheaven.citations, 'core-mc', core.midheaven.sensitivityNote,
        ));
      }
      if (core.natalMoonPhase) {
        grid.append(renderCoreCard(
          `Birth Moon phase · ${core.natalMoonPhase.phaseLabel}`, '◐', 'angle-glyph', core.natalMoonPhase.factLine,
          core.natalMoonPhase.symbolismBasis, core.natalMoonPhase.synthesis, core.natalMoonPhase.reflection, core.natalMoonPhase.citations, 'core-lunar',
        ));
      }
      coreSection.append(grid);
      parts.push(coreSection);
    }

    if (reading.themes.length) {
      const themeSection = el('section', 'reading-block');
      themeSection.setAttribute('aria-labelledby', 'reading-themes-heading');
      themeSection.append(Object.assign(node('h3', 'Major chart themes'), { id: 'reading-themes-heading' }));
      const grid = el('div', 'reading-grid');
      for (const theme of reading.themes) grid.append(renderThemeCard(theme));
      themeSection.append(grid);
      parts.push(themeSection);
    }

    if (reading.balance) parts.push(renderBalance(reading.balance));

    if (reading.placements.length) {
      const placeSection = el('section', 'reading-block');
      placeSection.setAttribute('aria-labelledby', 'reading-placements-heading');
      placeSection.append(
        Object.assign(node('h3', `Planets in signs${reading.houseSystemLabel ? ' & natal houses' : ''}`), { id: 'reading-placements-heading' }),
        quiet('Select any planet or sign button to highlight it on the wheel and inspect its full astronomical details.'),
      );
      const list = el('ul', 'reading-list');
      for (const p of reading.placements) list.append(renderPlacementItem(p));
      placeSection.append(list);
      parts.push(placeSection);
    }

    if (reading.aspects.length) {
      const aspectSection = el('section', 'reading-block');
      aspectSection.setAttribute('aria-labelledby', 'reading-aspects-heading');
      aspectSection.append(
        Object.assign(node('h3', `Natal aspects (${reading.aspects.length})`), { id: 'reading-aspects-heading' }),
        quiet('Ordered by personal prominence and orb tightness. Tighter orbs carry stronger traditional emphasis.'),
      );
      const top = reading.aspects.slice(0, 6);
      const rest = reading.aspects.slice(6);
      const list = el('ul', 'reading-list');
      for (const a of top) list.append(renderAspectItem(a));
      aspectSection.append(list);
      if (rest.length) {
        const more = node('details');
        more.className = 'reading-more-aspects';
        more.dataset.readingDetail = 'more-aspects';
        more.append(node('summary', `Show ${rest.length} additional natal ${rest.length === 1 ? 'aspect' : 'aspects'}`));
        const moreList = el('ul', 'reading-list');
        for (const a of rest) moreList.append(renderAspectItem(a));
        more.append(moreList);
        aspectSection.append(more);
      }
      parts.push(aspectSection);
    }

    const footer = el('section', 'reading-block reading-footer-block');
    footer.setAttribute('aria-labelledby', 'reading-reflect-heading');
    footer.append(Object.assign(node('h3', 'Reflection & further exploration'), { id: 'reading-reflect-heading' }));
    if (reading.reflections.length) {
      const list = el('ul', 'meaning-list reading-reflection-list');
      for (const r of reading.reflections) {
        const li = node('li');
        li.append(node('strong', `${r.topic}: `), r.question);
        list.append(li);
      }
      footer.append(list);
    }
    const bridge = el('div', 'reading-export-bridge');
    bridge.append(
      quiet('Want to explore these verified natal facts further in your own AI chat? Nothing leaves your browser automatically.'),
      Object.assign(node('a', 'Continue in AI Export Studio →'), { href: '#export', className: 'button-link' }),
    );
    footer.append(bridge, renderSourcesDisclosure(reading.sources));
    parts.push(footer);
    return parts;
  }

  function renderTransits(reading: TransitReading): HTMLElement[] {
    const parts: HTMLElement[] = [];

    if (reading.isDemo) {
      const demo = el('div', 'reading-banner reading-banner-demo');
      const copy = el('p', '', 'These transits are measured against the Greenwich demonstration chart (2000-01-01). Enter your own birth details or load a saved profile for your personal transits.');
      const edit = node('button', 'Enter your birth details');
      edit.type = 'button';
      edit.className = 'secondary';
      edit.dataset.readingEditBirth = 'true';
      demo.append(copy, edit);
      parts.push(demo);
    }

    if (reading.omittedNotes.length) {
      const notices = el('section', 'reading-banner reading-banner-caution');
      notices.setAttribute('aria-label', 'Transit scope notes');
      const list = el('ul', 'meaning-list');
      for (const note of reading.omittedNotes) list.append(node('li', note));
      notices.append(list);
      parts.push(notices);
    }

    // 1. Sky Weather Overview
    const overview = el('section', 'reading-block reading-overview reading-overview-transit');
    overview.setAttribute('aria-labelledby', 'reading-overview-heading');
    const ovHead = el('div', 'reading-overview-head');
    const enrichChip = reading.enrichmentState === 'loading'
      ? chip('Calculating exact passes…', 'transit-enrich-chip')
      : reading.enrichmentState === 'ready'
        ? chip('Exact passes ready', 'transit-kind-chip')
        : reading.enrichmentState === 'partial'
          ? chip('Exact passes (partial window)', 'chip-quiet')
          : null;
    const headBadges = el('div', 'reading-badges');
    headBadges.append(chip(reading.momentLabel, 'transit-kind-chip'));
    if (enrichChip) headBadges.append(enrichChip);
    ovHead.append(Object.assign(node('h3', reading.overview.headline), { id: 'reading-overview-heading' }), headBadges);
    overview.append(
      ovHead,
      el('p', 'reading-fact-line', `Calculated sky facts: ${reading.overview.factsSummary}`),
      el('p', 'reading-prose reading-overview-prose', reading.overview.synthesis),
      el('p', 'quiet-note reading-epistemic', reading.overview.symbolismDisclaimer),
    );
    const ovCites = citationButtons(reading.overview.citations);
    if (ovCites) overview.append(ovCites);
    parts.push(overview);

    // 2. Thematic Synthesis & Lunar Observatory tie-in
    if (reading.themes.length || reading.lunarTieIn) {
      const themeSection = el('section', 'reading-block');
      themeSection.setAttribute('aria-labelledby', 'reading-transit-themes-heading');
      themeSection.append(Object.assign(node('h3', 'Active transit themes & lunar context'), { id: 'reading-transit-themes-heading' }));
      const grid = el('div', 'reading-grid');
      for (const theme of reading.themes) grid.append(renderTransitThemeCard(theme));
      if (reading.lunarTieIn) {
        const l = reading.lunarTieIn;
        grid.append(renderCoreCard(
          `Lunar Observatory · ${l.phaseLabel}`, '◐', 'angle-glyph', l.factLine,
          l.symbolismBasis, l.synthesis, l.reflection, l.citations, 'transit-lunar',
        ));
      }
      themeSection.append(grid);
      parts.push(themeSection);
    }

    // 3. Prioritized Timescale Buckets
    const renderBucket = (
      id: string,
      title: string,
      subtitleText: string,
      items: readonly TransitAspectReading[],
      collapseAfter = 6,
    ) => {
      if (!items.length) return;
      const block = el('section', 'reading-block');
      block.setAttribute('aria-labelledby', id);
      block.append(Object.assign(node('h3', `${title} (${items.length})`), { id }), quiet(subtitleText));
      const list = el('ul', 'reading-list');
      for (const item of items.slice(0, collapseAfter)) list.append(renderTransitAspectCard(item, reading.displayZone));
      block.append(list);
      if (items.length > collapseAfter) {
        const more = node('details');
        more.className = 'reading-more-aspects';
        more.dataset.readingDetail = `more-${id}`;
        more.append(node('summary', `Show ${items.length - collapseAfter} more in ${title.toLowerCase()}`));
        const moreList = el('ul', 'reading-list');
        for (const item of items.slice(collapseAfter)) moreList.append(renderTransitAspectCard(item, reading.displayZone));
        more.append(moreList);
        block.append(more);
      }
      parts.push(block);
    };

    renderBucket(
      'reading-transit-long',
      'Long-term cycles',
      'Jupiter, Saturn, Uranus, Neptune and Pluto — slow structural seasons spanning months to years (active within 3°–3.5° orb).',
      reading.buckets.longTerm,
    );
    renderBucket(
      'reading-transit-medium',
      'Current medium-term transits',
      'Mars, Sun, Venus and Mercury — active themes lasting days to weeks (active within 4° orb).',
      reading.buckets.mediumTerm,
    );
    renderBucket(
      'reading-transit-lunar',
      'Brief lunar triggers',
      'Transiting Moon contacts — fleeting hours-long shifts in tone (active within 5° orb; 4° for sextiles to match chart rules).',
      reading.buckets.lunarBrief,
      4,
    );

    if (!reading.allAspects.length && reading.mode !== 'unavailable') {
      const quietNote = el('section', 'reading-block');
      quietNote.append(
        node('h3', 'No tight planetary transits right now'),
        quiet(
          reading.wideChartAspectsCount > 0
            ? `${reading.wideChartAspectsCount} wider background ${reading.wideChartAspectsCount === 1 ? 'aspect is' : 'aspects are'} listed in the Aspects table below, outside the tighter active transit orbs.`
            : 'Move the Time Machine or search the Events tab to inspect upcoming exact contacts.',
        ),
      );
      parts.push(quietNote);
    }

    // 4. Transiting Planets Through Natal Houses
    if (reading.houseTransits.length) {
      const houseBlock = el('section', 'reading-block');
      houseBlock.setAttribute('aria-labelledby', 'reading-transit-houses-heading');
      houseBlock.append(
        Object.assign(node('h3', `Transiting planets through your ${reading.houseSystemLabel} houses`), { id: 'reading-transit-houses-heading' }),
        quiet('Shows which natal life arenas slower and personal transiting planets are currently travelling through.'),
      );
      const list = el('ul', 'reading-list');
      for (const ht of reading.houseTransits.slice(0, 6)) list.append(renderTransitHouseCard(ht, reading.displayZone));
      houseBlock.append(list);
      if (reading.houseTransits.length > 6) {
        const more = node('details');
        more.className = 'reading-more-aspects';
        more.dataset.readingDetail = 'more-house-transits';
        more.append(node('summary', `Show ${reading.houseTransits.length - 6} faster inner-planet house transits`));
        const moreList = el('ul', 'reading-list');
        for (const ht of reading.houseTransits.slice(6)) moreList.append(renderTransitHouseCard(ht, reading.displayZone));
        more.append(moreList);
        houseBlock.append(more);
      }
      parts.push(houseBlock);
    }

    // 5. Reflection, Learn citations, Events & AI Export Studio bridge
    const footer = el('section', 'reading-block reading-footer-block');
    footer.setAttribute('aria-labelledby', 'reading-reflect-heading');
    footer.append(Object.assign(node('h3', 'Reflection, Learn & further exploration'), { id: 'reading-reflect-heading' }));
    if (reading.reflections.length) {
      const list = el('ul', 'meaning-list reading-reflection-list');
      for (const r of reading.reflections) {
        const li = node('li');
        li.append(node('strong', `${r.topic}: `), r.question);
        list.append(li);
      }
      footer.append(list);
    }
    const learnRow = el('div', 'reading-learn-links');
    learnRow.append(
      el('span', 'quiet-note', 'Learn concepts:'),
      Object.assign(node('a', 'Transits'), { href: learnHref('concept/transits'), className: 'learn-open' }),
      Object.assign(node('a', 'Retrograde'), { href: learnHref('concept/retrograde'), className: 'learn-open' }),
      Object.assign(node('a', 'Orb'), { href: learnHref('concept/orb'), className: 'learn-open' }),
      Object.assign(node('a', 'Moon phases'), { href: learnHref('concept/moon-phases'), className: 'learn-open' }),
    );
    footer.append(learnRow);

    const bridge = el('div', 'reading-export-bridge');
    bridge.append(
      quiet('Browse a 366-day transit calendar in Events, or prepare a privacy-redacted snapshot in AI Export Studio.'),
      Object.assign(node('a', 'Open Events calendar'), { href: '#events', className: 'button-link' }),
      Object.assign(node('a', 'Continue in AI Export Studio →'), { href: '#export', className: 'button-link' }),
    );
    footer.append(bridge, renderSourcesDisclosure(reading.sources));
    parts.push(footer);
    return parts;
  }

  function render() {
    syncHeader();
    if (!mode) return;
    let signature = '';
    let parts: HTMLElement[] = [];

    if (mode === 'natal') {
      if (!natalReading) return;
      signature = JSON.stringify({
        mode: 'natal',
        readingMode: natalReading.mode,
        isDemo: natalReading.isDemo,
        profileLabel: natalReading.profileLabel,
        birthSummary: natalReading.birthSummary,
        houseSystemLabel: natalReading.houseSystemLabel,
        headline: natalReading.overview.headline,
        facts: natalReading.overview.factsSummary,
      });
      if (signature === lastRenderSignature && body.childElementCount > 0) return;
      parts = renderNatal(natalReading);
    } else {
      if (!transitReading) return;
      signature = JSON.stringify({
        mode: 'transits',
        readingMode: transitReading.mode,
        isDemo: transitReading.isDemo,
        profileLabel: transitReading.profileLabel,
        momentLabel: transitReading.momentLabel,
        displayZone: transitReading.displayZone,
        enrichmentState: transitReading.enrichmentState,
        headline: transitReading.overview.headline,
        facts: transitReading.overview.factsSummary,
        passCount: transitReading.allAspects.reduce((sum, a) => sum + (a.enrichment?.passes.length ?? 0), 0),
        spanCount: transitReading.houseTransits.filter(h => h.span).length,
      });
      if (signature === lastRenderSignature && body.childElementCount > 0) return;
      parts = renderTransits(transitReading);
    }

    const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hadFocusInBody = Boolean(activeEl && body.contains(activeEl));
    const focusedWindowKey = activeEl?.dataset.jumpWindowKey
      ?? activeEl?.closest<HTMLElement>('[data-window-key]')?.dataset.windowKey
      ?? null;
    const focusedJumpEpoch = activeEl?.dataset.jumpEpochMs ?? null;
    const focusedSelectKey = activeEl?.dataset.readingSelect ?? null;

    const openDetails = new Set(
      [...body.querySelectorAll<HTMLDetailsElement>('details[open][data-reading-detail]')].map(d => d.dataset.readingDetail!),
    );
    body.replaceChildren(...parts);
    for (const key of openDetails) {
      body.querySelector<HTMLDetailsElement>(`details[data-reading-detail="${CSS.escape(key)}"]`)?.setAttribute('open', '');
    }
    lastRenderSignature = signature;

    // Preserve meaningful keyboard focus across reading re-renders (e.g. after "Jump to exact pass")
    // without moving scroll position or leaving focus on document.body.
    const wantsJumpRestore = pendingJumpFocus !== null
      && (hadFocusInBody || activeEl === heading || activeEl === document.body || activeEl === null);
    if (wantsJumpRestore && pendingJumpFocus) {
      const { windowKey, epochMs } = pendingJumpFocus;
      let targetEl: HTMLElement | null = null;
      if (windowKey) {
        targetEl = body.querySelector<HTMLElement>(
          `button[data-jump-window-key="${CSS.escape(windowKey)}"][data-jump-epoch-ms="${CSS.escape(String(epochMs))}"]`,
        );
        if (targetEl) {
          pendingJumpFocus = null;
        } else {
          // Tier-2 enrichment may still be loading: focus the card heading while waiting.
          targetEl = body.querySelector<HTMLElement>(`[data-window-key="${CSS.escape(windowKey)}"] h4`);
          if (transitReading?.enrichmentState === 'ready' || transitReading?.enrichmentState === 'partial') {
            pendingJumpFocus = null;
          }
        }
      } else {
        pendingJumpFocus = null;
      }
      (targetEl ?? heading).focus({ preventScroll: true });
    } else if (hadFocusInBody) {
      let restoreEl: HTMLElement | null = null;
      if (focusedWindowKey && focusedJumpEpoch) {
        restoreEl = body.querySelector<HTMLElement>(
          `button[data-jump-window-key="${CSS.escape(focusedWindowKey)}"][data-jump-epoch-ms="${CSS.escape(focusedJumpEpoch)}"]`,
        ) ?? body.querySelector<HTMLElement>(`[data-window-key="${CSS.escape(focusedWindowKey)}"] h4`);
      } else if (focusedSelectKey) {
        restoreEl = body.querySelector<HTMLElement>(`button[data-reading-select="${CSS.escape(focusedSelectKey)}"]`);
      } else if (focusedWindowKey) {
        restoreEl = body.querySelector<HTMLElement>(`[data-window-key="${CSS.escape(focusedWindowKey)}"] h4`);
      }
      (restoreEl ?? heading).focus({ preventScroll: true });
    }
  }

  function setMode(next: ReadingMode | null, moveFocus = false) {
    const changed = mode !== next;
    mode = next;
    if (next) lastOpenedBy = next;
    body.hidden = next === null;
    if (changed) lastRenderSignature = '';
    syncHeader();
    if (next) {
      render();
      statusEl.textContent = next === 'natal'
        ? (natalReading ? `Personal birth-chart reading open: ${natalReading.overview.headline}.` : 'Personal birth-chart reading open.')
        : (transitReading ? `Personal transit reading open for ${transitReading.momentLabel}: ${transitReading.overview.headline}.` : 'Personal transit reading open.');
      if (moveFocus) {
        section.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        heading.focus({ preventScroll: true });
      }
    } else {
      statusEl.textContent = '';
    }
    if (changed) hooks.onModeChange?.(next);
  }

  natalBtn.addEventListener('click', () => setMode('natal', true), { signal });
  transitBtn.addEventListener('click', () => setMode('transits', true), { signal });
  closeBtn.addEventListener('click', () => {
    pendingJumpFocus = null;
    setMode(null);
    (lastOpenedBy === 'transits' ? transitBtn : natalBtn).focus({ preventScroll: true });
  }, { signal });

  document.addEventListener('focusin', event => {
    if (pendingJumpFocus && event.target instanceof Node && !section.contains(event.target)) {
      pendingJumpFocus = null;
    }
  }, { signal });

  body.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-reading-edit-birth]')) {
      pendingJumpFocus = null;
      hooks.onEditBirth();
      return;
    }
    const jump = target.closest<HTMLElement>('[data-jump-epoch-ms]');
    if (jump?.dataset.jumpEpochMs) {
      const epochMs = Number(jump.dataset.jumpEpochMs);
      if (Number.isFinite(epochMs)) {
        pendingJumpFocus = { windowKey: jump.dataset.jumpWindowKey ?? null, epochMs };
        hooks.onJumpToEpoch(epochMs);
        statusEl.textContent = 'Time Machine moved to exact transit pass.';
      }
      return;
    }
    const cite = target.closest<HTMLElement>('[data-reading-select]');
    if (cite?.dataset.readingSelect) {
      pendingJumpFocus = null;
      hooks.onSelectKey(cite.dataset.readingSelect);
      const inspection = document.getElementById('inspection');
      inspection?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, { signal });

  return {
    update(reading: NatalReading) {
      natalReading = reading;
      if (mode === 'natal') {
        lastRenderSignature = '';
        render();
        statusEl.textContent = `Birth-chart reading updated: ${reading.overview.headline}.`;
      } else {
        syncHeader();
      }
    },
    updateTransits(reading: TransitReading) {
      transitReading = reading;
      if (mode === 'transits') {
        lastRenderSignature = '';
        render();
      } else {
        syncHeader();
      }
    },
    open(moveFocus = true, targetMode: ReadingMode = 'natal') { setMode(targetMode, moveFocus); },
    close() { setMode(null); },
    isOpen: () => mode !== null,
    activeMode: () => mode,
  };
}
