import { Temporal } from '@js-temporal/polyfill';
import { createAspectRuleSet } from '../domain/aspects';
import type { AspectId, AspectRuleSetV0 } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { Chart, HouseId, PlanetId } from '../domain/chart';
import {
  ALL_ASPECT_IDS,
  ALL_HOUSE_IDS,
  ALL_RANGE_EVENT_KINDS,
  ALL_RESEARCH_ANGLES,
  createResearchQuery,
  HOUSE_AREA_DESCRIPTORS,
  resolveChartFactors,
  SUN_TO_PLUTO_BODIES,
  THEME_CONVENTION_DISCLAIMER,
  validateQueryRangeSpan,
} from '../research';
import type {
  ChartFactors,
  RangeEventKind,
  RangePresetId,
  ResearchAngleId,
  ResearchMode,
  ResearchQuery,
  ResearchThemePreset,
  RulershipPolicy,
  ThemeRegistry,
} from '../research';
import type { RangeOrbPolicy } from '../search/range';
import { SLOW_PLANET_IDS } from '../search/series';
import { loadThemeRegistry, saveThemeRegistry } from '../store/theme-presets';
import { resolveBirthTime } from '../time/resolve';
import { planetName, titleCase } from './chart-data';
import { node } from './readings';
import { byId } from './timeline';

const ANGLE_LABELS: Readonly<Record<ResearchAngleId, string>> = {
  asc: 'ASC (1st cusp axis)',
  mc: 'MC (10th cusp axis)',
  dsc: 'DSC (7th cusp axis)',
  ic: 'IC (4th cusp axis)',
};

const EVENT_KIND_LABELS: Readonly<Record<RangeEventKind, string>> = {
  'aspect-window': 'Planet-to-natal aspects',
  'angle-aspect-window': 'Angle contacts (ASC/MC/DSC/IC)',
  'house-ingress': 'Natal house crossings',
  station: 'Planetary stations (℞ / direct)',
};

export interface ResearchControlsCallbacks {
  onFocusChanged(): void;
  onRangeChanged(): void;
}

export interface ResearchControls {
  getMode(): ResearchMode;
  setMode(mode: ResearchMode): void;
  getRegistry(): ThemeRegistry;
  getChartFactors(): ChartFactors | null;
  syncChart(chart: Chart): void;
  setDisabled(disabled: boolean): void;
  buildQuery(): ResearchQuery;
  updateCoverageNote(): { readonly ok: boolean; readonly reason?: string };
}

function addMonths(dateStr: string, months: number): string {
  const plain = Temporal.PlainDate.from(dateStr);
  return plain.add({ months }).toString();
}

function addDays(dateStr: string, days: number): string {
  const plain = Temporal.PlainDate.from(dateStr);
  return plain.add({ days }).toString();
}

function slugifyThemeId(label: string, existing: readonly ResearchThemePreset[]): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'custom-theme';
  let candidate = base.startsWith('custom-') ? base : `custom-${base}`;
  let suffix = 2;
  const taken = new Set(existing.map(t => t.id));
  while (taken.has(candidate)) {
    candidate = `${base.slice(0, 40)}-${suffix++}`;
  }
  return candidate;
}

export function mountResearchControls(
  deltaT: (year: number) => number,
  callbacks: ResearchControlsCallbacks,
  signal: AbortSignal,
): ResearchControls {
  const modesEl = byId('research-modes');
  const modeButtons = [...modesEl.querySelectorAll<HTMLButtonElement>('[data-research-mode]')];
  const chartStatusEl = byId('research-chart-status');
  const fromInput = byId<HTMLInputElement>('event-from');
  const toInput = byId<HTMLInputElement>('event-to');
  const bodySelect = byId<HTMLSelectElement>('event-body');
  const presetStrip = byId('research-range-presets');
  const includeMoonEl = byId<HTMLInputElement>('research-include-moon');
  const coverageNoteEl = byId('research-coverage-note');
  const orbPolicySelect = byId<HTMLSelectElement>('research-orb-policy');
  const compAnglesEl = byId<HTMLInputElement>('research-comp-angles');
  const compIngressesEl = byId<HTMLInputElement>('research-comp-ingresses');
  const compStationsEl = byId<HTMLInputElement>('research-comp-stations');
  const customOrbsBox = byId('research-custom-orbs');
  const themesPanel = byId('research-panel-themes');
  const customPanel = byId('research-panel-custom');
  const configuration = byId<HTMLDetailsElement>('research-configuration');
  const clearSelections = byId<HTMLButtonElement>('research-clear-selections');
  const clearStatus = byId('research-clear-status');

  // Populate Transiting planet select cleanly while keeping 'all' as default value
  const sunToPlutoOpt = node('option', 'Sun–Pluto (no Moon)');
  sunToPlutoOpt.value = 'sun-pluto';
  const slowOpt = node('option', 'Slow planets (Jupiter–Pluto, up to 10y)');
  slowOpt.value = 'slow';
  bodySelect.append(sunToPlutoOpt, slowOpt);
  for (const id of PLANET_IDS) {
    const opt = node('option', planetName(id));
    opt.value = id;
    bodySelect.append(opt);
  }
  // Shown only while the selected planets do not match any named scope (for example Mars + Moon).
  const customScopeOpt = node('option', 'Custom selection');
  customScopeOpt.value = 'custom';
  customScopeOpt.hidden = true;
  bodySelect.append(customScopeOpt);

  // Default 30-day window (matches historical default)
  const today = new Date().toISOString().slice(0, 10);
  fromInput.value = today;
  toInput.value = addDays(today, 30);
  const dateRangeKey = () => `${fromInput.value}|${toInput.value}`;
  let observedDateRange = dateRangeKey();

  let mode: ResearchMode = 'everything';
  let activePreset: RangePresetId = '30d';
  let registry = loadThemeRegistry();
  let activeChart: Chart | null = null;
  let chartFactors: ChartFactors | null = null;

  // Focus state shared between Life Themes and Custom Search
  let activeThemeIds = new Set<string>();
  let includeHouses = new Set<HouseId>();
  let excludeHouses = new Set<HouseId>();
  let includeRulers = true;
  let rulershipPolicy: RulershipPolicy = 'traditional';
  let includeHouseOccupants = true;
  let includeNatalPlanets = new Set<PlanetId>();
  let excludeNatalPlanets = new Set<PlanetId>();
  let includeFocusAngles = new Set<ResearchAngleId>();
  let excludeFocusAngles = new Set<ResearchAngleId>();
  let includeAspects = new Set<AspectId>(ALL_ASPECT_IDS);
  let includeEventKinds = new Set<RangeEventKind>(ALL_RANGE_EVENT_KINDS);
  let exactOnly = false;
  let customOrbsDeg: AspectRuleSetV0['orbsDeg'] = { ...createAspectRuleSet().orbsDeg };
  let transitingBodies = new Set<PlanetId>(PLANET_IDS);
  let editingThemeId: string | null = null;
  let editorStatus = '';
  let editorOpen = false;
  let disabled = false;

  // Render custom orbs editor inside Calculation options
  const orbInputs = new Map<AspectId, HTMLInputElement>();
  for (const aspect of ALL_ASPECT_IDS) {
    const label = node('label', `${titleCase(aspect)} (°)`);
    const input = node('input');
    input.type = 'number';
    input.min = '0';
    input.max = '15';
    input.step = '0.5';
    input.value = String(customOrbsDeg[aspect]);
    input.dataset.customOrb = aspect;
    label.append(input);
    customOrbsBox.append(label);
    orbInputs.set(aspect, input);
  }

  function orderedPlanets(set: ReadonlySet<PlanetId>): readonly PlanetId[] {
    return PLANET_IDS.filter(p => set.has(p));
  }

  function syncTransitingFromSelect() {
    const val = bodySelect.value;
    if (val === 'all') {
      transitingBodies = new Set(PLANET_IDS);
      includeMoonEl.checked = true;
    } else if (val === 'sun-pluto') {
      transitingBodies = new Set(SUN_TO_PLUTO_BODIES);
      includeMoonEl.checked = false;
    } else if (val === 'slow') {
      transitingBodies = new Set(SLOW_PLANET_IDS);
      includeMoonEl.checked = false;
    } else if (PLANET_IDS.includes(val as PlanetId)) {
      transitingBodies = new Set([val as PlanetId]);
      includeMoonEl.checked = val === 'moon';
    }
    // 'custom' keeps the current explicit selection untouched.
    syncSelectFromTransiting();
  }

  /**
   * Keeps the planet menu and the Moon checkbox truthful for the real selection. Any set that is not
   * all ten planets, Sun–Pluto, Jupiter–Pluto or a single planet is shown as "Custom selection"
   * and never as "All planets".
   */
  function syncSelectFromTransiting() {
    const list = orderedPlanets(transitingBodies);
    const hasMoon = transitingBodies.has('moon');
    if (list.length === PLANET_IDS.length) {
      bodySelect.value = 'all';
    } else if (list.length === SUN_TO_PLUTO_BODIES.length && !hasMoon) {
      bodySelect.value = 'sun-pluto';
    } else if (list.length === SLOW_PLANET_IDS.length && SLOW_PLANET_IDS.every(p => transitingBodies.has(p))) {
      bodySelect.value = 'slow';
    } else if (list.length === 1) {
      bodySelect.value = list[0];
    } else {
      customScopeOpt.textContent = `Custom selection (${list.length} planets)`;
      customScopeOpt.hidden = false;
      bodySelect.value = 'custom';
    }
    if (bodySelect.value !== 'custom') customScopeOpt.hidden = true;
    includeMoonEl.checked = hasMoon;
  }

  function updateCustomOrbVisibility() {
    customOrbsBox.hidden = orbPolicySelect.value !== 'custom';
  }

  function updateCoverageNote(): { readonly ok: boolean; readonly reason?: string } {
    const bodies = orderedPlanets(transitingBodies);
    const startRes = fromInput.value
      ? resolveBirthTime({ date: fromInput.value, time: '00:00', offsetOverride: '+00:00' }, deltaT)
      : null;
    const endRes = toInput.value
      ? resolveBirthTime({ date: toInput.value, time: '00:00', offsetOverride: '+00:00' }, deltaT)
      : null;

    if (!startRes || !endRes || startRes.kind !== 'resolved' || endRes.kind !== 'resolved') {
      coverageNoteEl.textContent = 'Enter valid UTC start and end dates (supported ephemeris: 1550–2650).';
      coverageNoteEl.dataset.state = 'warn';
      return { ok: false, reason: 'Enter valid dates for the search interval.' };
    }

    const span = validateQueryRangeSpan(bodies, startRes.jdTt, endRes.jdTt);
    const moonIncluded = transitingBodies.has('moon');
    if (!span.ok) {
      coverageNoteEl.textContent = span.reason ?? 'Invalid date range.';
      coverageNoteEl.dataset.state = 'error';
      return { ok: false, reason: span.reason };
    }

    const days = Math.round(span.spanDays);
    const parts: string[] = [];
    parts.push(`${days.toLocaleString('en')} days`);
    parts.push(
      span.slowBodiesOnly
        ? 'Slow-planet mode (up to 10 years)'
        : 'General mode (up to 5 years)',
    );
    if (bodySelect.value === 'custom') {
      parts.push(`Planets: ${bodies.map(planetName).join(', ')}`);
    }
    if (moonIncluded) {
      parts.push(
        days > 90
          ? 'Moon included (~75% of multi-month contacts are lunar; uncheck to focus on slower cycles)'
          : 'Moon included',
      );
    } else {
      parts.push('Moon excluded');
    }
    coverageNoteEl.textContent = parts.join(' · ');
    coverageNoteEl.dataset.state = moonIncluded && days > 90 ? 'warn' : 'ok';
    return { ok: true };
  }

  function renderChartStatus() {
    chartStatusEl.replaceChildren();
    if (!chartFactors) return;
    const { availability } = chartFactors;
    const msg = node('p');
    if (!availability.natalPositionsAvailable) {
      chartStatusEl.dataset.state = 'warn';
      msg.textContent =
        'Birth time unknown: natal longitudes, house crossings and angle contacts are unavailable. Planetary stations remain searchable.';
    } else if (!availability.housesAvailable) {
      chartStatusEl.dataset.state = 'warn';
      msg.textContent =
        'Birthplace coordinates missing: houses and angles are unavailable. Life Themes fall back to planetary natural significators only.';
    } else {
      chartStatusEl.dataset.state = availability.polarHouseFallback ? 'warn' : 'ok';
      const systemLabel = availability.effectiveHouseSystem === 'WholeSign'
        ? 'Whole Sign'
        : availability.polarHouseFallback
          ? 'Porphyry (polar fallback)'
          : availability.effectiveHouseSystem ?? 'Houses';
      const rulerSummary = chartFactors.chartRuler
        ? ` · Chart ruler: ${planetName(chartFactors.chartRuler.traditional)}`
        : '';
      msg.textContent = `Active chart linkage: ${systemLabel} houses & ASC/MC/DSC/IC ready${rulerSummary}.`;
    }
    chartStatusEl.append(msg);

    if (chartFactors.sensitivityNotes.length) {
      const details = node('details');
      details.className = 'research-sensitivity';
      details.append(node('summary', `Chart sensitivity notes (${chartFactors.sensitivityNotes.length})`));
      const ul = node('ul');
      for (const noteText of chartFactors.sensitivityNotes) {
        ul.append(node('li', noteText));
      }
      details.append(ul);
      chartStatusEl.append(details);
    }
  }

  function renderPresetEditor(): HTMLElement {
    const details = node('details');
    details.className = 'research-disclosure research-theme-editor';
    details.open = editorOpen;
    details.addEventListener('toggle', () => { editorOpen = details.open; });

    const summary = node('summary', 'Create or edit theme presets');
    details.append(summary);

    const wrap = node('div');
    wrap.className = 'theme-editor-body';
    const note = node('p', THEME_CONVENTION_DISCLAIMER);
    note.className = 'hint';
    wrap.append(note);

    const editingPreset = editingThemeId ? registry.get(editingThemeId) ?? null : null;

    // Select existing preset to edit or create new
    const selectorRow = node('div');
    selectorRow.className = 'theme-editor-select-row';
    const selectLabel = node('label', 'Preset to edit');
    const presetSelect = node('select');
    presetSelect.id = 'theme-editor-select';
    const newOpt = node('option', '+ New custom theme preset');
    newOpt.value = '';
    presetSelect.append(newOpt);
    for (const preset of registry.list()) {
      const tag = preset.builtIn ? (registry.isModifiedBuiltIn(preset.id) ? ' (edited)' : '') : ' (custom)';
      const opt = node('option', `${preset.label}${tag}`);
      opt.value = preset.id;
      if (editingThemeId === preset.id) opt.selected = true;
      presetSelect.append(opt);
    }
    selectLabel.append(presetSelect);
    selectorRow.append(selectLabel);
    wrap.append(selectorRow);

    const labelField = node('label', 'Theme name');
    const labelInput = node('input');
    labelInput.type = 'text';
    labelInput.maxLength = 80;
    labelInput.placeholder = 'e.g. Creative Launch';
    labelInput.value = editingPreset?.label ?? '';
    labelField.append(labelInput);

    const descField = node('label', 'Description (optional)');
    const descInput = node('input');
    descInput.type = 'text';
    descInput.maxLength = 300;
    descInput.placeholder = 'What life area this theme explores';
    descInput.value = editingPreset?.description ?? '';
    descField.append(descInput);

    const fieldsGrid = node('div');
    fieldsGrid.className = 'theme-editor-fields';
    fieldsGrid.append(labelField, descField);
    wrap.append(fieldsGrid);

    const housesFieldset = node('fieldset');
    housesFieldset.className = 'research-check-group';
    housesFieldset.append(node('legend', 'Houses included in preset'));
    const editorHouses = new Set<HouseId>(editingPreset?.houses ?? []);
    for (const h of ALL_HOUSE_IDS) {
      const lbl = node('label', `H${h}`);
      lbl.className = 'check-pill';
      const cb = node('input');
      cb.type = 'checkbox';
      cb.checked = editorHouses.has(h);
      cb.addEventListener('change', () => {
        if (cb.checked) editorHouses.add(h);
        else editorHouses.delete(h);
      });
      lbl.prepend(cb);
      housesFieldset.append(lbl);
    }
    wrap.append(housesFieldset);

    const sigFieldset = node('fieldset');
    sigFieldset.className = 'research-check-group';
    sigFieldset.append(node('legend', 'Natural planetary significators (symbolic fallback)'));
    const editorSigs = new Set<PlanetId>(editingPreset?.naturalSignificators ?? []);
    for (const p of PLANET_IDS) {
      const lbl = node('label', planetName(p));
      lbl.className = 'check-pill';
      const cb = node('input');
      cb.type = 'checkbox';
      cb.checked = editorSigs.has(p);
      cb.addEventListener('change', () => {
        if (cb.checked) editorSigs.add(p);
        else editorSigs.delete(p);
      });
      lbl.prepend(cb);
      sigFieldset.append(lbl);
    }
    wrap.append(sigFieldset);

    const anglesFieldset = node('fieldset');
    anglesFieldset.className = 'research-check-group';
    anglesFieldset.append(node('legend', 'Angles'));
    const editorAngles = new Set<ResearchAngleId>(editingPreset?.angles ?? []);
    for (const a of ALL_RESEARCH_ANGLES) {
      const lbl = node('label', a.toUpperCase());
      lbl.className = 'check-pill';
      const cb = node('input');
      cb.type = 'checkbox';
      cb.checked = editorAngles.has(a);
      cb.addEventListener('change', () => {
        if (cb.checked) editorAngles.add(a);
        else editorAngles.delete(a);
      });
      lbl.prepend(cb);
      anglesFieldset.append(lbl);
    }
    wrap.append(anglesFieldset);

    const actions = node('div');
    actions.className = 'theme-editor-actions';

    const saveBtn = node('button', editingPreset ? 'Save preset changes' : 'Save new preset');
    saveBtn.type = 'button';
    saveBtn.className = 'primary';
    saveBtn.disabled = disabled;
    saveBtn.addEventListener('click', () => {
      try {
        const allPresets = registry.list();
        const id = editingPreset ? editingPreset.id : slugifyThemeId(labelInput.value, allPresets);
        registry = registry.upsert({
          id,
          label: labelInput.value,
          description: descInput.value,
          houses: ALL_HOUSE_IDS.filter(h => editorHouses.has(h)),
          naturalSignificators: PLANET_IDS.filter(p => editorSigs.has(p)),
          angles: ALL_RESEARCH_ANGLES.filter(a => editorAngles.has(a)),
        });
        saveThemeRegistry(registry);
        activeThemeIds.add(id);
        editingThemeId = id;
        editorStatus = `Saved preset “${labelInput.value.trim()}”.`;
        renderModePanels();
        callbacks.onFocusChanged();
      } catch (err) {
        editorStatus = err instanceof Error ? err.message : 'Could not save theme preset.';
        renderModePanels();
      }
    });
    actions.append(saveBtn);

    if (editingPreset?.builtIn && registry.isModifiedBuiltIn(editingPreset.id)) {
      const resetBtn = node('button', 'Reset to default');
      resetBtn.type = 'button';
      resetBtn.className = 'secondary';
      resetBtn.disabled = disabled;
      resetBtn.addEventListener('click', () => {
        registry = registry.resetBuiltIn(editingPreset.id);
        saveThemeRegistry(registry);
        editorStatus = `Restored default houses and planets for “${registry.get(editingPreset.id)?.label ?? editingPreset.id}”.`;
        renderModePanels();
        callbacks.onFocusChanged();
      });
      actions.append(resetBtn);
    }

    if (editingPreset && !editingPreset.builtIn) {
      const deleteBtn = node('button', 'Delete preset');
      deleteBtn.type = 'button';
      deleteBtn.className = 'quiet-danger';
      deleteBtn.disabled = disabled;
      deleteBtn.addEventListener('click', () => {
        const deletedLabel = editingPreset.label;
        registry = registry.remove(editingPreset.id);
        activeThemeIds.delete(editingPreset.id);
        saveThemeRegistry(registry);
        editingThemeId = null;
        editorStatus = `Deleted custom preset “${deletedLabel}”.`;
        renderModePanels();
        callbacks.onFocusChanged();
      });
      actions.append(deleteBtn);
    }

    wrap.append(actions);
    if (editorStatus) {
      const statusP = node('p', editorStatus);
      statusP.className = 'form-note';
      statusP.setAttribute('role', 'status');
      wrap.append(statusP);
    }

    presetSelect.addEventListener('change', () => {
      editingThemeId = presetSelect.value || null;
      editorStatus = '';
      editorOpen = true;
      renderModePanels();
    });

    details.append(wrap);
    return details;
  }

  function renderThemesPanel() {
    themesPanel.replaceChildren();
    const housesAvailable = Boolean(chartFactors?.availability.housesAvailable);

    const intro = node('p', THEME_CONVENTION_DISCLAIMER);
    intro.className = 'hint';
    themesPanel.append(intro);

    // 1. Theme presets grid (simultaneous multi-select)
    const themeGroup = node('fieldset');
    themeGroup.className = 'research-theme-grid';
    themeGroup.append(node('legend', 'Life theme presets (select one or many simultaneously)'));

    for (const preset of registry.list()) {
      const btn = node('button');
      btn.type = 'button';
      btn.className = 'theme-card';
      btn.disabled = disabled;
      const selected = activeThemeIds.has(preset.id);
      btn.setAttribute('aria-pressed', String(selected));
      btn.dataset.themeId = preset.id;

      const head = node('span');
      head.className = 'theme-card-head';
      head.append(node('strong', preset.label));
      if (!preset.builtIn) {
        const tag = node('span', 'Custom');
        tag.className = 'chip';
        head.append(tag);
      } else if (registry.isModifiedBuiltIn(preset.id)) {
        const tag = node('span', 'Edited');
        tag.className = 'chip';
        head.append(tag);
      }

      const houseText = preset.houses.length ? preset.houses.map(h => `H${h}`).join(' · ') : 'Planetary';
      const meta = node('small', `${houseText}${preset.description ? ` — ${preset.description}` : ''}`);
      btn.append(head, meta);

      btn.addEventListener('click', () => {
        if (activeThemeIds.has(preset.id)) activeThemeIds.delete(preset.id);
        else activeThemeIds.add(preset.id);
        renderThemesPanel();
        callbacks.onFocusChanged();
      });
      themeGroup.append(btn);
    }
    themesPanel.append(themeGroup);

    // 2. All 12 Houses individually selectable (showing chart-specific cusp sign, ruler & occupants)
    const housesGroup = node('fieldset');
    housesGroup.className = 'research-house-grid';
    housesGroup.append(node('legend', 'All 12 houses (select individual houses directly)'));
    for (const desc of HOUSE_AREA_DESCRIPTORS) {
      const hf = chartFactors?.houses?.[desc.houseId - 1] ?? null;
      const lbl = node('label');
      lbl.className = 'house-tile';
      if (!housesAvailable) lbl.dataset.unavailable = 'true';

      const cb = node('input');
      cb.type = 'checkbox';
      cb.checked = includeHouses.has(desc.houseId);
      cb.disabled = disabled || !housesAvailable;
      cb.dataset.houseId = String(desc.houseId);
      cb.addEventListener('change', () => {
        if (cb.checked) includeHouses.add(desc.houseId);
        else includeHouses.delete(desc.houseId);
        callbacks.onFocusChanged();
      });

      const textWrap = node('span');
      textWrap.className = 'house-tile-text';
      textWrap.append(node('strong', `H${desc.houseId} · ${desc.tagline}`));
      const linkageText = hf
        ? `${hf.cuspSignName} cusp · Ruler ${planetName(hf.traditionalRuler)}`
          + (rulershipPolicy === 'traditional-plus-modern' && hf.modernCoRuler ? ` / ${planetName(hf.modernCoRuler)}` : '')
          + (hf.occupants.length ? ` · Natal: ${hf.occupants.map(planetName).join(', ')}` : '')
        : 'Houses unavailable for this chart';
      textWrap.append(node('small', linkageText));

      lbl.append(cb, textWrap);
      housesGroup.append(lbl);
    }
    themesPanel.append(housesGroup);

    // 3. Rulership & occupant controls
    const rulerRow = node('div');
    rulerRow.className = 'research-option-row';
    const modernLbl = node('label', 'Include modern co-rulers (Uranus/Neptune/Pluto)');
    modernLbl.className = 'check';
    const modernCb = node('input');
    modernCb.type = 'checkbox';
    modernCb.checked = rulershipPolicy === 'traditional-plus-modern';
    modernCb.disabled = disabled || !housesAvailable;
    modernCb.addEventListener('change', () => {
      rulershipPolicy = modernCb.checked ? 'traditional-plus-modern' : 'traditional';
      if (activeChart) chartFactors = resolveChartFactors(activeChart, { rulershipPolicy });
      renderThemesPanel();
      callbacks.onFocusChanged();
    });
    modernLbl.prepend(modernCb);

    const occLbl = node('label', 'Include natal planets occupying selected houses');
    occLbl.className = 'check';
    const occCb = node('input');
    occCb.type = 'checkbox';
    occCb.checked = includeHouseOccupants;
    occCb.disabled = disabled || !housesAvailable;
    occCb.addEventListener('change', () => {
      includeHouseOccupants = occCb.checked;
      callbacks.onFocusChanged();
    });
    occLbl.prepend(occCb);

    rulerRow.append(modernLbl, occLbl);
    themesPanel.append(rulerRow);

    // 4. Collapsible editable/custom preset editor
    themesPanel.append(renderPresetEditor());
  }

  function renderCustomPanel() {
    customPanel.replaceChildren();
    const natalAvailable = Boolean(chartFactors?.availability.natalPositionsAvailable);
    const housesAvailable = Boolean(chartFactors?.availability.housesAvailable);

    const intro = node(
      'p',
      'Combine exact inclusions and exclusions across houses, cusp rulers, natal/transiting planets, angles, aspects, stations and house crossings.',
    );
    intro.className = 'hint';
    customPanel.append(intro);

    // Section 1: Houses & Rulers
    const houseDetails = node('details');
    houseDetails.className = 'research-disclosure';
    houseDetails.open = true;
    houseDetails.append(node('summary', 'Houses & cusp rulers (include / exclude)'));
    const houseBody = node('div');
    houseBody.className = 'custom-section-body';

    const houseRulesRow = node('div');
    houseRulesRow.className = 'research-option-row';
    const rLbl = node('label', 'Include cusp rulers of selected houses');
    rLbl.className = 'check';
    const rCb = node('input');
    rCb.type = 'checkbox';
    rCb.checked = includeRulers;
    rCb.disabled = disabled || !housesAvailable;
    rCb.addEventListener('change', () => { includeRulers = rCb.checked; callbacks.onFocusChanged(); });
    rLbl.prepend(rCb);

    const mLbl = node('label', 'Include modern co-rulers');
    mLbl.className = 'check';
    const mCb = node('input');
    mCb.type = 'checkbox';
    mCb.checked = rulershipPolicy === 'traditional-plus-modern';
    mCb.disabled = disabled || !housesAvailable || !includeRulers;
    mCb.addEventListener('change', () => {
      rulershipPolicy = mCb.checked ? 'traditional-plus-modern' : 'traditional';
      if (activeChart) chartFactors = resolveChartFactors(activeChart, { rulershipPolicy });
      renderCustomPanel();
      callbacks.onFocusChanged();
    });
    mLbl.prepend(mCb);

    const oLbl = node('label', 'Include natal house occupants');
    oLbl.className = 'check';
    const oCb = node('input');
    oCb.type = 'checkbox';
    oCb.checked = includeHouseOccupants;
    oCb.disabled = disabled || !housesAvailable;
    oCb.addEventListener('change', () => { includeHouseOccupants = oCb.checked; callbacks.onFocusChanged(); });
    oLbl.prepend(oCb);

    houseRulesRow.append(rLbl, mLbl, oLbl);
    houseBody.append(houseRulesRow);

    const houseMatrix = node('div');
    houseMatrix.className = 'custom-house-matrix';
    for (const desc of HOUSE_AREA_DESCRIPTORS) {
      const hf = chartFactors?.houses?.[desc.houseId - 1] ?? null;
      const cell = node('div');
      cell.className = 'custom-matrix-item';
      const title = node('span', `H${desc.houseId}${hf ? ` (${hf.cuspSignName} · ${planetName(hf.traditionalRuler)})` : ''}`);
      title.className = 'custom-matrix-label';
      const select = node('select');
      select.setAttribute('aria-label', `House ${desc.houseId} rule`);
      select.disabled = disabled || !housesAvailable;
      for (const [val, text] of [['neutral', 'Any'], ['include', 'Include'], ['exclude', 'Exclude']] as const) {
        const opt = node('option', text);
        opt.value = val;
        if (val === 'include' && includeHouses.has(desc.houseId)) opt.selected = true;
        else if (val === 'exclude' && excludeHouses.has(desc.houseId)) opt.selected = true;
        else if (val === 'neutral' && !includeHouses.has(desc.houseId) && !excludeHouses.has(desc.houseId)) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        includeHouses.delete(desc.houseId);
        excludeHouses.delete(desc.houseId);
        if (select.value === 'include') includeHouses.add(desc.houseId);
        else if (select.value === 'exclude') excludeHouses.add(desc.houseId);
        callbacks.onFocusChanged();
      });
      cell.append(title, select);
      houseMatrix.append(cell);
    }
    houseBody.append(houseMatrix);
    houseDetails.append(houseBody);
    customPanel.append(houseDetails);

    // Section 2: Transiting & Natal Planets
    const planetDetails = node('details');
    planetDetails.className = 'research-disclosure';
    planetDetails.append(node('summary', 'Transiting & natal planets'));
    const planetBody = node('div');
    planetBody.className = 'custom-section-body';

    const transitGroup = node('fieldset');
    transitGroup.className = 'research-check-group';
    transitGroup.append(node('legend', 'Transiting planets (computation scope)'));
    for (const p of PLANET_IDS) {
      const lbl = node('label', planetName(p));
      lbl.className = 'check-pill';
      const cb = node('input');
      cb.type = 'checkbox';
      cb.checked = transitingBodies.has(p);
      cb.disabled = disabled;
      cb.addEventListener('change', () => {
        if (cb.checked) transitingBodies.add(p);
        else if (transitingBodies.size > 1) transitingBodies.delete(p);
        else { cb.checked = true; return; }
        syncSelectFromTransiting();
        updateCoverageNote();
        callbacks.onRangeChanged();
      });
      lbl.prepend(cb);
      transitGroup.append(lbl);
    }
    planetBody.append(transitGroup);

    const natalMatrix = node('div');
    natalMatrix.className = 'custom-house-matrix';
    for (const p of PLANET_IDS) {
      const cell = node('div');
      cell.className = 'custom-matrix-item';
      const lbl = node('span', `Natal ${planetName(p)}`);
      lbl.className = 'custom-matrix-label';
      const select = node('select');
      select.setAttribute('aria-label', `Natal ${planetName(p)} rule`);
      select.disabled = disabled || !natalAvailable;
      for (const [val, text] of [['neutral', 'Any'], ['include', 'Include'], ['exclude', 'Exclude']] as const) {
        const opt = node('option', text);
        opt.value = val;
        if (val === 'include' && includeNatalPlanets.has(p)) opt.selected = true;
        else if (val === 'exclude' && excludeNatalPlanets.has(p)) opt.selected = true;
        else if (val === 'neutral' && !includeNatalPlanets.has(p) && !excludeNatalPlanets.has(p)) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        includeNatalPlanets.delete(p);
        excludeNatalPlanets.delete(p);
        if (select.value === 'include') includeNatalPlanets.add(p);
        else if (select.value === 'exclude') excludeNatalPlanets.add(p);
        callbacks.onFocusChanged();
      });
      cell.append(lbl, select);
      natalMatrix.append(cell);
    }
    planetBody.append(natalMatrix);
    planetDetails.append(planetBody);
    customPanel.append(planetDetails);

    // Section 3: Angles, Aspects & Event Kinds
    const factorDetails = node('details');
    factorDetails.className = 'research-disclosure';
    factorDetails.append(node('summary', 'Angles, aspects, stations & house crossings'));
    const factorBody = node('div');
    factorBody.className = 'custom-section-body';

    const angleMatrix = node('div');
    angleMatrix.className = 'custom-house-matrix';
    for (const a of ALL_RESEARCH_ANGLES) {
      const cell = node('div');
      cell.className = 'custom-matrix-item';
      const lbl = node('span', ANGLE_LABELS[a]);
      lbl.className = 'custom-matrix-label';
      const select = node('select');
      select.setAttribute('aria-label', `${a.toUpperCase()} angle rule`);
      select.disabled = disabled || !housesAvailable;
      for (const [val, text] of [['neutral', 'Any'], ['include', 'Include'], ['exclude', 'Exclude']] as const) {
        const opt = node('option', text);
        opt.value = val;
        if (val === 'include' && includeFocusAngles.has(a)) opt.selected = true;
        else if (val === 'exclude' && excludeFocusAngles.has(a)) opt.selected = true;
        else if (val === 'neutral' && !includeFocusAngles.has(a) && !excludeFocusAngles.has(a)) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        includeFocusAngles.delete(a);
        excludeFocusAngles.delete(a);
        if (select.value === 'include') includeFocusAngles.add(a);
        else if (select.value === 'exclude') excludeFocusAngles.add(a);
        callbacks.onFocusChanged();
      });
      cell.append(lbl, select);
      angleMatrix.append(cell);
    }
    factorBody.append(angleMatrix);

    const aspectGroup = node('fieldset');
    aspectGroup.className = 'research-check-group';
    aspectGroup.append(node('legend', 'Aspects'));
    for (const aspect of ALL_ASPECT_IDS) {
      const lbl = node('label', titleCase(aspect));
      lbl.className = 'check-pill';
      const cb = node('input');
      cb.type = 'checkbox';
      cb.checked = includeAspects.has(aspect);
      cb.disabled = disabled;
      cb.addEventListener('change', () => {
        if (cb.checked) includeAspects.add(aspect);
        else if (includeAspects.size > 1) includeAspects.delete(aspect);
        else { cb.checked = true; return; }
        callbacks.onFocusChanged();
      });
      lbl.prepend(cb);
      aspectGroup.append(lbl);
    }
    factorBody.append(aspectGroup);

    const kindsGroup = node('fieldset');
    kindsGroup.className = 'research-check-group';
    kindsGroup.append(node('legend', 'Event kinds'));
    for (const kind of ALL_RANGE_EVENT_KINDS) {
      const lbl = node('label', EVENT_KIND_LABELS[kind]);
      lbl.className = 'check-pill';
      const cb = node('input');
      cb.type = 'checkbox';
      cb.checked = includeEventKinds.has(kind);
      cb.disabled = disabled;
      cb.addEventListener('change', () => {
        if (cb.checked) includeEventKinds.add(kind);
        else if (includeEventKinds.size > 1) includeEventKinds.delete(kind);
        else { cb.checked = true; return; }
        callbacks.onFocusChanged();
      });
      lbl.prepend(cb);
      kindsGroup.append(lbl);
    }
    factorBody.append(kindsGroup);

    const exactLbl = node('label', 'Focus on exact contacts only (exclude near misses & orb-only windows from relevant focus)');
    exactLbl.className = 'check';
    const exactCb = node('input');
    exactCb.type = 'checkbox';
    exactCb.checked = exactOnly;
    exactCb.disabled = disabled;
    exactCb.addEventListener('change', () => {
      exactOnly = exactCb.checked;
      callbacks.onFocusChanged();
    });
    exactLbl.prepend(exactCb);
    factorBody.append(exactLbl);

    factorDetails.append(factorBody);
    customPanel.append(factorDetails);
  }

  function renderModePanels() {
    for (const btn of modeButtons) {
      const active = btn.dataset.researchMode === mode;
      btn.setAttribute('aria-selected', String(active));
    }
    themesPanel.hidden = mode !== 'themes';
    customPanel.hidden = mode !== 'custom';
    if (mode === 'themes') renderThemesPanel();
    else if (mode === 'custom') renderCustomPanel();
  }

  function applyRangePreset(presetId: RangePresetId) {
    activePreset = presetId;
    const baseDate = fromInput.value && /^\d{4}-\d{2}-\d{2}$/.test(fromInput.value)
      ? fromInput.value
      : new Date().toISOString().slice(0, 10);
    fromInput.value = baseDate;
    try {
      switch (presetId) {
        case '30d': toInput.value = addDays(baseDate, 30); break;
        case '90d': toInput.value = addDays(baseDate, 90); break;
        case '12m': toInput.value = addMonths(baseDate, 12); break;
        case '2y': toInput.value = addMonths(baseDate, 24); break;
        case '5y': toInput.value = addMonths(baseDate, 60); break;
        case '10y-slow':
          toInput.value = addMonths(baseDate, 120);
          transitingBodies = new Set(SLOW_PLANET_IDS);
          syncSelectFromTransiting();
          break;
        default: break;
      }
    } catch {
      // Leave user's typed date untouched if Temporal rejects an out-of-bounds value.
    }
    observedDateRange = dateRangeKey();
    for (const btn of presetStrip.querySelectorAll<HTMLButtonElement>('[data-range-preset]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.rangePreset === activePreset));
    }
    if (mode === 'custom') renderCustomPanel();
    updateCoverageNote();
    callbacks.onRangeChanged();
  }

  // Wire static controls
  modesEl.addEventListener('click', event => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-research-mode]');
    if (!btn || disabled) return;
    const next = btn.dataset.researchMode as ResearchMode;
    if (next !== 'everything') configuration.open = true;
    if (next === mode) return;
    mode = next;
    renderModePanels();
    callbacks.onFocusChanged();
  }, { signal });

  clearSelections.addEventListener('click', () => {
    activeThemeIds.clear();
    includeHouses.clear();
    excludeHouses.clear();
    includeNatalPlanets.clear();
    excludeNatalPlanets.clear();
    includeFocusAngles.clear();
    excludeFocusAngles.clear();
    includeAspects = new Set(ALL_ASPECT_IDS);
    includeEventKinds = new Set(ALL_RANGE_EVENT_KINDS);
    includeRulers = includeHouseOccupants = true;
    exactOnly = false;
    rulershipPolicy = 'traditional';
    if (activeChart) chartFactors = resolveChartFactors(activeChart, { rulershipPolicy });
    renderModePanels();
    clearStatus.textContent = 'Life themes and custom focus cleared. Saved presets and search settings are available as before.';
    callbacks.onFocusChanged();
  }, { signal });

  presetStrip.addEventListener('click', event => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-range-preset]');
    if (!btn || disabled) return;
    applyRangePreset(btn.dataset.rangePreset as RangePresetId);
  }, { signal });

  bodySelect.addEventListener('change', () => {
    syncTransitingFromSelect();
    if (mode === 'custom') renderCustomPanel();
    updateCoverageNote();
    callbacks.onRangeChanged();
  }, { signal });

  includeMoonEl.addEventListener('change', () => {
    if (includeMoonEl.checked) {
      transitingBodies.add('moon');
    } else if (transitingBodies.size > 1) {
      transitingBodies.delete('moon');
    } else {
      // If only Moon was selected, switching Moon off selects Sun–Pluto cleanly.
      transitingBodies = new Set(SUN_TO_PLUTO_BODIES);
    }
    syncSelectFromTransiting();
    if (mode === 'custom') renderCustomPanel();
    updateCoverageNote();
    callbacks.onRangeChanged();
  }, { signal });

  function onDateEdited() {
    const key = dateRangeKey();
    if (key === observedDateRange) return;
    observedDateRange = key;
    activePreset = 'custom';
    for (const btn of presetStrip.querySelectorAll<HTMLButtonElement>('[data-range-preset]')) {
      btn.setAttribute('aria-pressed', 'false');
    }
    updateCoverageNote();
    callbacks.onRangeChanged();
  }
  for (const dateField of [fromInput, toInput]) {
    dateField.addEventListener('input', onDateEdited, { signal });
    dateField.addEventListener('change', onDateEdited, { signal });
  }

  orbPolicySelect.addEventListener('change', () => {
    updateCustomOrbVisibility();
    callbacks.onRangeChanged();
  }, { signal });

  customOrbsBox.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    const aspect = input.dataset.customOrb as AspectId | undefined;
    if (!aspect) return;
    const val = input.valueAsNumber;
    if (Number.isFinite(val) && val >= 0 && val <= 180) {
      customOrbsDeg = { ...customOrbsDeg, [aspect]: val };
      callbacks.onRangeChanged();
    }
  }, { signal });

  for (const compCb of [compAnglesEl, compIngressesEl, compStationsEl]) {
    compCb.addEventListener('change', () => {
      callbacks.onRangeChanged();
    }, { signal });
  }

  function buildQuery(): ResearchQuery {
    const bodies = orderedPlanets(transitingBodies);
    const orbPolicy = (orbPolicySelect.value || 'transit-focused') as RangeOrbPolicy;
    return createResearchQuery({
      mode,
      startDate: fromInput.value,
      endDate: toInput.value,
      preset: activePreset,
      transitingBodies: bodies,
      orbPolicy,
      ...(orbPolicy === 'custom' ? { customOrbsDeg } : {}),
      includeAngles: compAnglesEl.checked,
      includeHouseIngresses: compIngressesEl.checked,
      includeStations: compStationsEl.checked,
      fetchScope: 'broad',
      ...(mode === 'everything'
        ? {}
        : {
          activeThemeIds: [...activeThemeIds],
          includeHouses: ALL_HOUSE_IDS.filter(h => includeHouses.has(h)),
          excludeHouses: mode === 'custom' ? ALL_HOUSE_IDS.filter(h => excludeHouses.has(h)) : [],
          includeRulers: mode === 'custom' ? includeRulers : true,
          rulershipPolicy,
          includeHouseOccupants: mode === 'custom' ? includeHouseOccupants : true,
          includeNatalPlanets: mode === 'custom' ? orderedPlanets(includeNatalPlanets) : [],
          excludeNatalPlanets: mode === 'custom' ? orderedPlanets(excludeNatalPlanets) : [],
          includeFocusAngles: mode === 'custom' ? ALL_RESEARCH_ANGLES.filter(a => includeFocusAngles.has(a)) : [],
          excludeFocusAngles: mode === 'custom' ? ALL_RESEARCH_ANGLES.filter(a => excludeFocusAngles.has(a)) : [],
          includeAspects: mode === 'custom' ? ALL_ASPECT_IDS.filter(a => includeAspects.has(a)) : ALL_ASPECT_IDS,
          includeEventKinds: mode === 'custom'
            ? ALL_RANGE_EVENT_KINDS.filter(k => includeEventKinds.has(k))
            : ALL_RANGE_EVENT_KINDS,
          exactOnly: mode === 'custom' ? exactOnly : false,
        }),
    });
  }

  updateCustomOrbVisibility();
  updateCoverageNote();
  renderModePanels();

  return {
    getMode: () => mode,
    setMode(next) {
      if (mode === next) return;
      mode = next;
      renderModePanels();
      callbacks.onFocusChanged();
    },
    getRegistry: () => registry,
    getChartFactors: () => chartFactors,
    syncChart(chart) {
      activeChart = chart;
      chartFactors = resolveChartFactors(chart, { rulershipPolicy });
      renderChartStatus();
      renderModePanels();
    },
    setDisabled(nextDisabled) {
      disabled = nextDisabled;
      renderModePanels();
    },
    buildQuery,
    updateCoverageNote,
  };
}
