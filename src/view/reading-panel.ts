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
} from '../interpret';
import { aspectMeta, sourcesFor } from '../knowledge';
import type { ZodiacElement, ZodiacMode } from '../knowledge';
import { aspectSymbols, planetGlyphs, quiet } from './inspector';
import { node } from './readings';
import { byId } from './timeline';

const ELEMENTS: readonly ZodiacElement[] = ['fire', 'earth', 'air', 'water'];
const MODES: readonly ZodiacMode[] = ['cardinal', 'fixed', 'mutable'];

export interface ReadingPanelHooks {
  readonly onSelectKey: (key: string) => void;
  readonly onEditBirth: () => void;
}

export interface ReadingPanelController {
  update(reading: NatalReading): void;
  open(moveFocus?: boolean): void;
  close(): void;
  isOpen(): boolean;
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
          : theme.kind === 'hemisphere' ? 'Hemisphere'
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

export function mountReadingPanel(hooks: ReadingPanelHooks, signal: AbortSignal): ReadingPanelController {
  const section = byId('personal-reading');
  const body = byId('personal-reading-body');
  const trigger = byId<HTMLButtonElement>('interpret-birth-btn');
  const closeBtn = byId<HTMLButtonElement>('reading-close');
  const subtitle = byId('reading-subtitle');
  const statusEl = byId('reading-status');
  let openState = false;
  let current: NatalReading | null = null;
  let lastRenderSignature = '';

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render() {
    if (!current || !openState) return;
    const reading = current;
    const signature = JSON.stringify({
      mode: reading.mode,
      isDemo: reading.isDemo,
      profileLabel: reading.profileLabel,
      birthSummary: reading.birthSummary,
      houseSystemLabel: reading.houseSystemLabel,
      headline: reading.overview.headline,
      facts: reading.overview.factsSummary,
    });
    if (signature === lastRenderSignature && body.childElementCount > 0) return;

    const openDetails = new Set(
      [...body.querySelectorAll<HTMLDetailsElement>('details[open][data-reading-detail]')].map(d => d.dataset.readingDetail!),
    );

    subtitle.textContent = reading.isDemo
      ? 'Greenwich demonstration chart · not your birth details'
      : reading.profileLabel
        ? `Profile: ${reading.profileLabel} · ${reading.birthSummary}`
        : `Calculated chart · ${reading.birthSummary}`;

    const parts: HTMLElement[] = [];

    // 1. Demo-chart honesty banner
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

    // 2. Partial-data / omitted-factors & birth-time sensitivity notices
    if (reading.omittedNotes.length || reading.sensitivityNotes.length) {
      const notices = el('section', 'reading-banner reading-banner-caution');
      notices.setAttribute('aria-label', 'Chart scope and precision notes');
      const list = el('ul', 'meaning-list');
      for (const note of [...reading.omittedNotes, ...reading.sensitivityNotes]) {
        list.append(node('li', note));
      }
      notices.append(list);
      parts.push(notices);
    }

    // 3. Overview
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

    // 4. Core Trio & Chart Ruler
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

    // 5. Major Chart Themes
    if (reading.themes.length) {
      const themeSection = el('section', 'reading-block');
      themeSection.setAttribute('aria-labelledby', 'reading-themes-heading');
      themeSection.append(Object.assign(node('h3', 'Major chart themes'), { id: 'reading-themes-heading' }));
      const grid = el('div', 'reading-grid');
      for (const theme of reading.themes) grid.append(renderThemeCard(theme));
      themeSection.append(grid);
      parts.push(themeSection);
    }

    // 6. Element & Modality Balance
    if (reading.balance) {
      parts.push(renderBalance(reading.balance));
    }

    // 7. Planets in Signs & Houses
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

    // 8. Key Natal Aspects
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

    // 9. Optional Reflection & AI Export Studio bridge + Sources
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
    footer.append(bridge);

    const sources = node('details');
    sources.className = 'sources';
    sources.dataset.readingDetail = 'sources';
    sources.append(node('summary', 'Sources and attribution'));
    sources.append(quiet('All reading copy is original to Divine Orchestration and composed from the 49-entry local knowledge library.'));
    const sourceList = node('ul');
    for (const src of sourcesFor(reading.sources)) {
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
    footer.append(sources);
    parts.push(footer);

    body.replaceChildren(...parts);
    for (const key of openDetails) {
      body.querySelector<HTMLDetailsElement>(`details[data-reading-detail="${CSS.escape(key)}"]`)?.setAttribute('open', '');
    }
    lastRenderSignature = signature;
  }

  function syncSubtitle() {
    if (!current) return;
    subtitle.textContent = current.isDemo
      ? 'Greenwich demonstration chart · not your birth details'
      : current.profileLabel
        ? `Profile: ${current.profileLabel} · ${current.birthSummary}`
        : `Calculated chart · ${current.birthSummary}`;
  }

  function setOpen(next: boolean, moveFocus = false) {
    openState = next;
    body.hidden = !next;
    closeBtn.hidden = !next;
    trigger.hidden = next;
    trigger.setAttribute('aria-expanded', String(next));
    syncSubtitle();
    if (next) {
      render();
      statusEl.textContent = current
        ? `Personal birth-chart reading open: ${current.overview.headline}.`
        : 'Personal birth-chart reading open.';
      if (moveFocus) {
        section.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        byId('reading-heading').focus({ preventScroll: true });
      }
    } else {
      statusEl.textContent = '';
    }
  }

  trigger.addEventListener('click', () => {
    setOpen(true, true);
  }, { signal });

  closeBtn.addEventListener('click', () => {
    setOpen(false);
    trigger.focus({ preventScroll: true });
  }, { signal });

  body.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-reading-edit-birth]')) {
      hooks.onEditBirth();
      return;
    }
    const cite = target.closest<HTMLElement>('[data-reading-select]');
    if (cite?.dataset.readingSelect) {
      hooks.onSelectKey(cite.dataset.readingSelect);
      const inspection = document.getElementById('inspection');
      inspection?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, { signal });

  return {
    update(reading: NatalReading) {
      current = reading;
      lastRenderSignature = '';
      syncSubtitle();
      if (openState) {
        render();
        statusEl.textContent = `Birth-chart reading updated: ${reading.overview.headline}.`;
      }
    },
    open(moveFocus = true) { setOpen(true, moveFocus); },
    close() { setOpen(false); },
    isOpen: () => openState,
  };
}
