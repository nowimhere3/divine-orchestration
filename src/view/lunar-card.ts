import type { EngineInstant, EphemeraEngine } from '../engine/ephemera';
import {
  calculateLunarCycle,
  calculateMoonSky,
  calculateMoonState,
  formatLunarTimestamp,
  formatObserverCoordinates,
  isValidObserverCoordinates,
  loadObservingLocation,
  OBSERVER_PRESETS,
  resolveObservingLocation,
  saveObservingLocation,
} from '../lunar';
import type {
  LunarCycleInfo,
  MoonSkyState,
  MoonState,
  ObservingLocation,
  ResolvedObservingLocation,
} from '../lunar';
import type { NatalProfile } from '../store/library';
import { node } from './readings';
import { byId } from './timeline';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Monochrome inline SVG of the lunar disk and terminator, using Night Observatory stroke and fill.
 */
export function renderMoonPhaseSvg(elongationDeg: number, illumination: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('lunar-svg');

  const r = 10.5;
  const cx = 14;
  const cy = 14;

  const base = document.createElementNS(SVG_NS, 'circle');
  base.setAttribute('cx', String(cx));
  base.setAttribute('cy', String(cy));
  base.setAttribute('r', String(r));
  base.setAttribute('fill', 'none');
  base.setAttribute('stroke', 'currentColor');
  base.setAttribute('stroke-width', '1.4');
  base.setAttribute('opacity', '0.45');
  svg.append(base);

  const clamped = Math.max(0, Math.min(1, illumination));
  if (clamped > 0.01) {
    const waxing = ((elongationDeg % 360) + 360) % 360 < 180;
    if (clamped >= 0.99) {
      const full = document.createElementNS(SVG_NS, 'circle');
      full.setAttribute('cx', String(cx));
      full.setAttribute('cy', String(cy));
      full.setAttribute('r', String(r - 0.5));
      full.setAttribute('fill', 'currentColor');
      full.setAttribute('opacity', '0.88');
      svg.append(full);
    } else {
      // Terminator ellipse semi-axis rx = r * |2*k - 1|
      const rx = Math.max(0.2, r * Math.abs(2 * clamped - 1));
      const gibbous = clamped > 0.5;
      // Outer limb arc from top (cx, cy-r) to bottom (cx, cy+r)
      const limbSweep = waxing ? 1 : 0;
      // Terminator arc from bottom (cx, cy+r) back to top (cx, cy-r)
      const termSweep = waxing ? (gibbous ? 1 : 0) : (gibbous ? 0 : 1);
      const d = `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${limbSweep} ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${termSweep} ${cx} ${cy - r} Z`;
      const lit = document.createElementNS(SVG_NS, 'path');
      lit.setAttribute('d', d);
      lit.setAttribute('fill', 'currentColor');
      lit.setAttribute('opacity', '0.85');
      svg.append(lit);
    }
  }

  return svg;
}

function formatSignedAngle(deg: number, decimals = 2): string {
  const sign = deg >= 0 ? '+' : '−';
  return `${sign}${Math.abs(deg).toFixed(decimals)}°`;
}

export interface LunarCardSnapshot {
  readonly state: MoonState | null;
  readonly cycle: LunarCycleInfo | null;
  readonly sky: MoonSkyState | null;
  readonly resolvedLocation: ResolvedObservingLocation;
  readonly displayZone: string;
}

export interface LunarCardController {
  update(instant: EngineInstant | null, selectedEpochMs: number | null, displayZone: string): void;
  updateZone(displayZone: string): void;
  syncProfiles(profiles: readonly NatalProfile[]): void;
  getSnapshot(): LunarCardSnapshot;
}

export function mountLunarCard(
  engine: EphemeraEngine,
  options: {
    readonly onInspectMoon: () => void;
    readonly onObserverChange?: () => void;
  },
  signal: AbortSignal,
): LunarCardController {
  const container = byId('lunar-observatory');
  let savedProfiles: readonly NatalProfile[] = [];
  let observingLocation: ObservingLocation = loadObservingLocation();
  let currentInstant: EngineInstant | null = null;
  let currentEpochMs: number | null = null;
  let currentZone = 'UTC';
  let manualNotice = '';

  let lastState: MoonState | null = null;
  let lastCycle: LunarCycleInfo | null = null;
  let lastSky: MoonSkyState | null = null;
  let lastResolvedLocation: ResolvedObservingLocation = resolveObservingLocation(observingLocation, savedProfiles);

  // Build static DOM skeleton inside #lunar-observatory
  const header = node('div');
  header.className = 'lunar-header';

  const iconSlot = node('span');
  iconSlot.className = 'lunar-icon';
  iconSlot.setAttribute('aria-hidden', 'true');

  const primary = node('div');
  primary.className = 'lunar-primary';

  const titleRow = node('div');
  titleRow.className = 'lunar-title-row';
  const heading = Object.assign(node('h3', 'Lunar Observatory'), { id: 'lunar-heading', className: 'lunar-title' });
  const nowBadge = Object.assign(node('span', 'Now'), {
    id: 'lunar-now-badge',
    className: 'chip chip-timing-present lunar-now',
    hidden: true,
  });
  const locationChip = Object.assign(node('span', 'Geocentric only'), {
    id: 'lunar-observer-chip',
    className: 'chip lunar-location-chip',
  });
  titleRow.append(heading, nowBadge, locationChip);

  const statusLine = Object.assign(node('p'), { id: 'lunar-status-line', className: 'lunar-status' });
  const phaseNameEl = Object.assign(node('strong'), { id: 'lunar-phase-name', className: 'lunar-phase-name' });
  const illumEl = Object.assign(node('span'), { id: 'lunar-illumination' });
  const waxingEl = Object.assign(node('span'), { id: 'lunar-waxing' });
  const posEl = Object.assign(node('span'), { id: 'lunar-position' });

  const nextLine = Object.assign(node('p'), { id: 'lunar-next-line', className: 'lunar-next' });
  const nextPhaseEl = Object.assign(node('span'), { id: 'lunar-next-phase', className: 'lunar-next-phase' });
  const cycleBriefEl = Object.assign(node('span'), { id: 'lunar-cycle-brief', className: 'lunar-cycle-brief' });

  primary.append(titleRow, statusLine, nextLine);

  const actions = node('div');
  actions.className = 'lunar-actions';
  const inspectBtn = Object.assign(node('button', 'Moon details'), {
    id: 'lunar-inspect-moon',
    type: 'button' as const,
    className: 'secondary lunar-btn',
  });
  inspectBtn.setAttribute('aria-label', 'Moon details - Inspect Transit Moon in Chart Inspector');
  inspectBtn.addEventListener('click', () => options.onInspectMoon(), { signal });

  const learnLink = Object.assign(node('a', 'Learn'), {
    id: 'lunar-learn-link',
    href: '#learn/concept/moon-phases',
    className: 'button-link lunar-btn',
  });
  learnLink.setAttribute('aria-label', 'Learn about Moon phases and lunar parallax');
  actions.append(inspectBtn, learnLink);

  header.append(iconSlot, primary, actions);

  const detailsEl = Object.assign(node('details'), {
    id: 'lunar-details',
    className: 'lunar-details',
  });
  detailsEl.dataset.detail = 'lunar-sky';
  const summaryEl = Object.assign(node('summary', 'Local sky, cycle & observer location'), {
    className: 'lunar-summary-toggle',
  });

  const bodyEl = node('div');
  bodyEl.className = 'lunar-details-body';

  // 1. Cycle & Principal Phases section
  const cycleSection = node('div');
  cycleSection.className = 'lunar-section';
  const cycleHeading = Object.assign(node('h4', 'Cycle & principal phases (geocentric)'), { className: 'lunar-subhead' });
  const cycleDl = Object.assign(node('dl'), { id: 'lunar-cycle-dl', className: 'lunar-dl' });
  const upcomingList = Object.assign(node('ul'), {
    id: 'lunar-upcoming-phases',
    className: 'lunar-phase-list',
  });
  upcomingList.setAttribute('aria-label', 'Upcoming principal lunar phases');
  cycleSection.append(cycleHeading, cycleDl, upcomingList);

  // 2. Observer Location picker section
  const observerSection = node('div');
  observerSection.className = 'lunar-section lunar-observer-controls';
  const observerHeading = Object.assign(node('h4', 'Observer location & local sky'), { className: 'lunar-subhead' });

  const observerField = node('label');
  observerField.className = 'lunar-observer-field';
  observerField.append(node('span', 'Observer location (independent of display time zone & natal chart)'));
  const observerSelect = Object.assign(node('select'), { id: 'lunar-observer-select' });
  observerSelect.setAttribute('aria-label', 'Observer location');
  observerField.append(observerSelect);

  const manualBox = Object.assign(node('div'), {
    id: 'lunar-manual-controls',
    className: 'lunar-manual-controls',
    hidden: true,
  });
  const latLabel = node('label', 'Observer N/S (°N)');
  const latInput = Object.assign(node('input'), {
    id: 'lunar-observer-lat',
    type: 'number',
    step: 'any',
    min: '-90',
    max: '90',
    placeholder: '51.0447',
  });
  latLabel.append(latInput);

  const lonLabel = node('label', 'Observer E/W (°E)');
  const lonInput = Object.assign(node('input'), {
    id: 'lunar-observer-lon',
    type: 'number',
    step: 'any',
    min: '-180',
    max: '180',
    placeholder: '-114.0719',
  });
  lonLabel.append(lonInput);

  const applyManualBtn = Object.assign(node('button', 'Apply coordinates'), {
    id: 'lunar-observer-apply',
    type: 'button' as const,
    className: 'secondary lunar-apply-btn',
  });
  manualBox.append(latLabel, lonLabel, applyManualBtn);

  const observerStatus = Object.assign(node('p'), {
    id: 'lunar-observer-status',
    className: 'form-note',
  });
  observerStatus.setAttribute('role', 'status');

  const skyContainer = Object.assign(node('div'), {
    id: 'lunar-sky-readout',
    className: 'lunar-sky-readout',
  });

  observerSection.append(observerHeading, observerField, manualBox, observerStatus, skyContainer);
  bodyEl.append(cycleSection, observerSection);
  detailsEl.append(summaryEl, bodyEl);
  container.replaceChildren(header, detailsEl);

  function selectValueForLocation(loc: ObservingLocation): string {
    switch (loc.mode) {
      case 'none': return 'none';
      case 'preset': return `preset:${loc.presetId}`;
      case 'profile': return `profile:${loc.profileId}`;
      case 'manual': return 'manual';
    }
  }

  function rebuildObserverOptions(effectiveLocation: ObservingLocation) {
    const optionsList: HTMLOptionElement[] = [
      new Option('No location selected (geocentric only)', 'none'),
      new Option(OBSERVER_PRESETS.calgary.label, 'preset:calgary'),
      new Option(OBSERVER_PRESETS.edmonton.label, 'preset:edmonton'),
    ];
    for (const profile of savedProfiles) {
      const coords = profile.observer ? formatObserverCoordinates(profile.observer) : 'no coordinates';
      const opt = new Option(`Saved profile birthplace · ${profile.name} (${coords})`, `profile:${profile.id}`);
      if (!profile.observer) opt.disabled = true;
      optionsList.push(opt);
    }
    optionsList.push(new Option('Manual latitude & longitude', 'manual'));
    observerSelect.replaceChildren(...optionsList);

    const targetValue = selectValueForLocation(effectiveLocation);
    if ([...observerSelect.options].some(o => o.value === targetValue && !o.disabled)) {
      observerSelect.value = targetValue;
    } else {
      observerSelect.value = 'none';
    }
  }

  observerSelect.addEventListener('change', () => {
    const val = observerSelect.value;
    manualNotice = '';
    if (val === 'none') {
      observingLocation = { mode: 'none' };
      manualBox.hidden = true;
      saveObservingLocation(observingLocation);
    } else if (val === 'preset:calgary' || val === 'preset:edmonton') {
      const presetId = val === 'preset:calgary' ? 'calgary' : 'edmonton';
      observingLocation = { mode: 'preset', presetId };
      manualBox.hidden = true;
      saveObservingLocation(observingLocation);
    } else if (val.startsWith('profile:')) {
      const profileId = val.slice('profile:'.length);
      observingLocation = { mode: 'profile', profileId };
      manualBox.hidden = true;
      saveObservingLocation(observingLocation);
    } else if (val === 'manual') {
      manualBox.hidden = false;
      if (observingLocation.mode === 'manual') {
        latInput.value = String(observingLocation.observer.latitudeDeg);
        lonInput.value = String(observingLocation.observer.longitudeDeg);
      } else if (!latInput.value && !lonInput.value) {
        latInput.focus();
        observerStatus.textContent = 'Enter observer latitude (−90° to 90°) and longitude (−180° to 180°), then choose Apply coordinates.';
        return;
      }
      applyManualCoordinates();
      return;
    }
    recalculateAndRender();
    options.onObserverChange?.();
  }, { signal });

  function applyManualCoordinates() {
    if (latInput.validity.badInput || lonInput.validity.badInput || !latInput.value.trim() || !lonInput.value.trim()) {
      manualNotice = 'Enter both observer latitude (−90° to 90°) and longitude (−180° to 180°).';
      observerStatus.textContent = manualNotice;
      return;
    }
    const lat = Number(latInput.value);
    const lon = Number(lonInput.value);
    if (!isValidObserverCoordinates(lat, lon)) {
      manualNotice = 'Observer latitude must be between −90° and 90° and longitude between −180° and 180°.';
      observerStatus.textContent = manualNotice;
      return;
    }
    manualNotice = '';
    observingLocation = { mode: 'manual', observer: { latitudeDeg: lat, longitudeDeg: lon } };
    saveObservingLocation(observingLocation);
    recalculateAndRender();
    options.onObserverChange?.();
  }

  applyManualBtn.addEventListener('click', applyManualCoordinates, { signal });
  for (const input of [latInput, lonInput]) {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyManualCoordinates();
      }
    }, { signal });
  }

  function appendDlRow(dl: HTMLDListElement, term: string, desc: string) {
    dl.append(node('dt', term), node('dd', desc));
  }

  function renderSkySection() {
    skyContainer.replaceChildren();
    const resolved = lastResolvedLocation;
    locationChip.textContent = resolved.shortLabel;

    if (resolved.fallbackNotice) {
      observerStatus.textContent = resolved.fallbackNotice;
    } else if (manualNotice) {
      observerStatus.textContent = manualNotice;
    } else if (resolved.observer) {
      observerStatus.textContent = `Active observer: ${resolved.fullLabel}. Used only for local lunar altitude, meridian passage and topocentric longitude.`;
    } else {
      observerStatus.textContent = '';
    }

    if (!resolved.observer) {
      const empty = Object.assign(
        node(
          'p',
          'No observer location selected. Geocentric phase, illumination and sign remain active above; choose a saved profile birthplace, Calgary, Edmonton or manual coordinates to calculate local altitude, visibility, upper meridian passage and topocentric Moon longitude.',
        ),
        { id: 'lunar-sky-empty', className: 'quiet-note' },
      );
      skyContainer.append(empty);
      return;
    }

    if (!lastSky) {
      skyContainer.append(Object.assign(node('p', 'Local sky calculations are unavailable for this instant.'), { className: 'quiet-note' }));
      return;
    }

    const sky = lastSky;
    const dl = Object.assign(node('dl'), { id: 'lunar-sky-dl', className: 'lunar-dl' });
    appendDlRow(dl, 'Observing location', resolved.fullLabel);
    appendDlRow(
      dl,
      'Local Moon altitude',
      `${formatSignedAngle(sky.apparentAltitudeDeg, 1)} apparent (${formatSignedAngle(sky.geometricAltitudeDeg, 1)} geometric) · Azimuth ${sky.azimuthDeg.toFixed(1)}°`,
    );
    appendDlRow(dl, 'Horizon visibility', `${sky.visibilityLabel} (standard atmosphere)`);

    if (sky.localDateTransit) {
      const t = sky.localDateTransit;
      const timeStr = formatLunarTimestamp(t.epochMs, currentZone);
      const culmStr = `${formatSignedAngle(t.culminationApparentAltitudeDeg, 1)} (${t.culminationAboveHorizon ? 'above horizon' : 'below horizon'})`;
      appendDlRow(dl, 'Upper meridian passage', `${timeStr} · Culmination ${culmStr}`);
    } else if (sky.nextTransit || sky.nearestTransit) {
      const fallbackTransit = sky.nextTransit ?? sky.nearestTransit!;
      const timeStr = formatLunarTimestamp(fallbackTransit.epochMs, currentZone);
      const culmStr = formatSignedAngle(fallbackTransit.culminationApparentAltitudeDeg, 1);
      appendDlRow(
        dl,
        'Upper meridian passage',
        `No upper meridian passage on this local date · Next: ${timeStr} (culmination ${culmStr})`,
      );
    } else {
      appendDlRow(dl, 'Upper meridian passage', 'Unavailable near coverage boundary');
    }

    appendDlRow(
      dl,
      'Topocentric Moon (local)',
      `${sky.topocentricFormatted} (${sky.topocentricLongitudeDeg.toFixed(3)}° · parallax ${formatSignedAngle(sky.parallaxDeltaLonDeg, 2)} vs geocentric)`,
    );
    appendDlRow(
      dl,
      'Geocentric chart Moon',
      `${sky.geocentricFormatted} (${sky.geocentricLongitudeDeg.toFixed(3)}° · used by chart wheel, aspects & exports)`,
    );

    skyContainer.append(dl);

    if (sky.signDiffers && sky.signDifferenceNote) {
      const diffNote = Object.assign(node('p', sky.signDifferenceNote), {
        id: 'lunar-sign-diff-note',
        className: 'lunar-sign-diff',
      });
      diffNote.setAttribute('role', 'status');
      skyContainer.append(diffNote);
    }
  }

  function renderTimestampsAndCycle() {
    if (!lastState) {
      iconSlot.replaceChildren();
      phaseNameEl.textContent = 'Moon calculations unavailable';
      statusLine.replaceChildren(phaseNameEl);
      nextLine.textContent = 'Select a date within the supported ephemeris range (1550–2650).';
      cycleDl.replaceChildren();
      upcomingList.replaceChildren();
      return;
    }

    const s = lastState;
    iconSlot.replaceChildren(renderMoonPhaseSvg(s.elongationDeg, s.illumination));
    phaseNameEl.textContent = s.phaseLabel;
    illumEl.textContent = `${s.illuminationPercent.toFixed(1)}% illuminated`;
    waxingEl.textContent = s.waxingLabel;
    posEl.textContent = `${s.formattedPosition} (geocentric)`;

    statusLine.replaceChildren(
      phaseNameEl,
      ' · ',
      illumEl,
      ' · ',
      waxingEl,
      ' · ',
      posEl,
    );

    const c = lastCycle;
    if (c?.next) {
      nextPhaseEl.textContent = `Next: ${c.next.label} · ${formatLunarTimestamp(c.next.epochMs, currentZone)}`;
    } else {
      nextPhaseEl.textContent = 'Next principal phase: outside ephemeris range';
    }

    if (c && c.ageDays !== null) {
      const pct = Math.round(c.cycleProgress * 100);
      cycleBriefEl.textContent = `Age ${c.ageDays.toFixed(1)}d (${pct}% of cycle)`;
      nextLine.replaceChildren(nextPhaseEl, ' · ', cycleBriefEl);
    } else if (c) {
      const pct = Math.round(c.elongationProgress * 100);
      cycleBriefEl.textContent = `${pct}% of cycle`;
      nextLine.replaceChildren(nextPhaseEl, ' · ', cycleBriefEl);
    } else {
      nextLine.replaceChildren(nextPhaseEl);
    }

    cycleDl.replaceChildren();
    appendDlRow(cycleDl, 'Phase & elongation', `${s.phaseLabel} · ${s.waxingLabel} (${s.elongationDeg.toFixed(2)}° geocentric elongation)`);
    appendDlRow(cycleDl, 'Illumination', `${s.illuminationPercent.toFixed(1)}% lit (phase angle ${s.phaseAngleDeg.toFixed(2)}°)`);
    appendDlRow(cycleDl, 'Geocentric tropical Moon', `${s.formattedPosition} (${s.moonLongitudeDeg.toFixed(3)}° · lat ${formatSignedAngle(s.moonLatitudeDeg, 2)})`);

    if (c) {
      if (c.ageDays !== null && c.synodicLengthDays !== null) {
        appendDlRow(
          cycleDl,
          'Moon age & cycle progress',
          `${c.ageDays.toFixed(2)} days since New Moon · ${(c.cycleProgress * 100).toFixed(1)}% of ${c.synodicLengthDays.toFixed(2)}d synodic month`,
        );
      } else if (c.ageDays !== null) {
        appendDlRow(
          cycleDl,
          'Moon age & cycle progress',
          `${c.ageDays.toFixed(2)} days since New Moon · ${(c.elongationProgress * 100).toFixed(1)}% angular cycle progress`,
        );
      } else {
        appendDlRow(
          cycleDl,
          'Cycle progress',
          `${(c.elongationProgress * 100).toFixed(1)}% angular cycle progress (previous New Moon predates 1550 coverage start)`,
        );
      }

      if (c.previous) {
        appendDlRow(
          cycleDl,
          'Previous principal phase',
          `${c.previous.label} · ${formatLunarTimestamp(c.previous.epochMs, currentZone)}`,
        );
      }
    }

    upcomingList.replaceChildren();
    for (const ev of c?.upcoming ?? []) {
      const li = node('li');
      li.className = 'lunar-phase-item';
      li.append(
        node('strong', ev.label),
        ' · ',
        node('span', formatLunarTimestamp(ev.epochMs, currentZone)),
      );
      upcomingList.append(li);
    }
  }

  function recalculateAndRender() {
    lastResolvedLocation = resolveObservingLocation(observingLocation, savedProfiles);
    if (lastResolvedLocation.fallbackNotice && observingLocation.mode === 'profile') {
      observingLocation = { mode: 'none' };
      saveObservingLocation(observingLocation);
    }
    rebuildObserverOptions(lastResolvedLocation.effective);
    manualBox.hidden = observerSelect.value !== 'manual';
    if (observingLocation.mode === 'manual') {
      latInput.value = String(observingLocation.observer.latitudeDeg);
      lonInput.value = String(observingLocation.observer.longitudeDeg);
    }

    const isNow = currentEpochMs !== null && Math.abs(currentEpochMs - Date.now()) < 90_000;
    nowBadge.hidden = !isNow;

    if (!currentInstant) {
      lastState = null;
      lastCycle = null;
      lastSky = null;
      renderTimestampsAndCycle();
      renderSkySection();
      return;
    }

    const stateRes = calculateMoonState(engine, currentInstant);
    lastState = stateRes.status === 'ok' ? stateRes.value : null;

    const cycleRes = calculateLunarCycle(engine, currentInstant);
    lastCycle = cycleRes.status === 'ok' ? cycleRes.value : null;

    if (lastResolvedLocation.observer) {
      const skyRes = calculateMoonSky(engine, currentInstant, lastResolvedLocation.observer, currentZone);
      lastSky = skyRes.status === 'ok' ? skyRes.value : null;
    } else {
      lastSky = null;
    }

    renderTimestampsAndCycle();
    renderSkySection();
  }

  return {
    update(instant, selectedEpochMs, displayZone) {
      currentInstant = instant;
      currentEpochMs = selectedEpochMs;
      currentZone = displayZone || 'UTC';
      recalculateAndRender();
    },
    updateZone(displayZone) {
      currentZone = displayZone || 'UTC';
      if (currentInstant && lastResolvedLocation.observer) {
        const skyRes = calculateMoonSky(engine, currentInstant, lastResolvedLocation.observer, currentZone);
        lastSky = skyRes.status === 'ok' ? skyRes.value : null;
      }
      renderTimestampsAndCycle();
      renderSkySection();
    },
    syncProfiles(profiles) {
      savedProfiles = profiles;
      recalculateAndRender();
    },
    getSnapshot() {
      return {
        state: lastState,
        cycle: lastCycle,
        sky: lastSky,
        resolvedLocation: lastResolvedLocation,
        displayZone: currentZone,
      };
    },
  };
}
