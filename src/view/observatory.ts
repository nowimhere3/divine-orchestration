import { PLANET_IDS } from '../domain/chart';
import { createAspectRuleSet } from '../domain/aspects';
import type { Chart, PlanetFact, PlanetId, TimedChart } from '../domain/chart';
import type { EphemeraEngine, Observer } from '../engine/ephemera';
import type { SnapshotInput } from '../export/snapshot';
import type { NatalProfile } from '../store/library';
import { normalizeBirthTime, resolveBirthTime } from '../time/resolve';
import type { BirthTimeInput, OffsetCandidate, TimeResolution } from '../time/resolve';
import { AstroWheel, pointKey } from './astro-wheel';
import { availablePositions, calculateNatal, calculatePositions, chartAspects, planetName } from './chart-data';
import type { PositionMap } from './chart-data';
import { aspectTable, houseName, houseTables, node, planetTable, unavailableText } from './readings';
import { regionMembers, renderInspection } from './inspector';
import { parseElementKey } from '../knowledge';
import { mountChartTools } from './chart-tools';
import { bindTimeline, byId } from './timeline';
import { mountEventSearch } from './event-search';
import { mountProfiles } from './profile-panel';
import { mountExportStudio } from './export-studio';

type Readings = 'natal' | 'transit' | 'aspects' | 'houses';
type Unresolved = Extract<TimeResolution, { kind: 'unresolved' }>;

const timeErrors: Record<Unresolved['reason'], string> = {
  'invalid-date': 'Enter a valid birth date.',
  'invalid-time': 'Enter a local time as H:MM or HH:MM (24-hour), optionally with seconds.',
  'invalid-zone': 'Enter an IANA time zone such as Europe/London.',
  'invalid-offset': 'Enter a recorded offset such as +05:30 or −04:00 (using the minus key).',
  'missing-zone-or-offset': 'Enter a time zone or a recorded UTC offset.',
  'invalid-disambiguation': 'Choose the matching offset or use a single recorded override.',
  'nonexistent-wall-time': 'That wall time was skipped by a clock change. Check the time or enter a recorded offset.',
  'ambiguous-wall-time': 'That wall time occurred twice. Choose the recorded offset and calculate again.',
  'invalid-leap-second': 'No known UTC leap second corresponds to that local time.',
  'delta-t-unavailable': 'Delta-T is unavailable for this date.',
};

const warnings: Readonly<Record<string, string>> = {
  'historical-zone-offset-uncertain': 'Historical zone offsets can vary across browsers. Use a recorded offset when available.',
  'offset-override-differs-from-zone': 'The recorded offset differs from the time zone’s rules and was used as entered.',
  'pre-utc-ut1-approximation': 'This date predates the UTC records used here. UT1 is approximate.',
  'modeled-delta-t': 'UT1 uses the Ephemera Delta-T model.',
  'future-utc-assumption': 'Future UTC assumes the latest confirmed leap-second offset.',
  'near-coverage-edge': 'This date is near the edge of the planetary data range.',
  'polar-house-fallback': 'Placidus is undefined here. The engine returned Porphyry cusps.',
};

export function mountObservatory(engine: EphemeraEngine) {
  const controls = new AbortController();
  const { signal } = controls;
  const form = byId<HTMLFormElement>('birth-form');
  byId('birth-alberta').addEventListener('click', () => {
    const zone = byId<HTMLInputElement>('birth-zone');
    zone.value = 'America/Edmonton';
    zone.dispatchEvent(new Event('input', { bubbles: true }));
  }, { signal });
  const unknown = byId<HTMLInputElement>('unknown-time');
  const birthTime = byId<HTMLInputElement>('birth-time');
  const foldArea = byId('fold-choices');
  const fold = byId<HTMLSelectElement>('fold-choice');
  const data = byId('data-view');
  const inspection = byId('inspection');
  const transitStatus = byId('transit-status');
  const wheel = new AstroWheel(byId('wheel'), select);
  const tools = mountChartTools(wheel, { select, inspection, explore }, signal);
  let natal: Chart;
  let natalFacts: readonly PlanetFact[] = [];
  let natalPoints: PositionMap = new Map();
  let transitFacts: readonly PlanetFact[] = [];
  let transitPoints: PositionMap = new Map();
  let birthAspects = chartAspects(natalPoints);
  let transitAspects = birthAspects;
  let selectedKey = '';
  /** Where a glossary concept was opened from, so the reader can step back. */
  let returnTo: { key: string; label: string } | undefined;
  let reading: Readings = 'natal';
  let selectedDate = '';
  let selectedTime = '';
  let selectedLabel = '';
  let selectedTt: number | null = null;
  let transitChart: TimedChart | null = null;
  let provenance: SnapshotInput['engine'] = null;
  let birthEdited = false;
  // What the wheel currently shows, in words, and whether a failed attempt is waiting for correction.
  let applied = { demo: true, text: '' };
  let attemptFailed = false;
  const timeError = byId('birth-time-error');
  const noticeEl = byId('chart-notice');
  const sourceEl = byId('export-source');
  const birthDialog = byId<HTMLDialogElement>('birth-dialog');

  function setTimeError(message: string) {
    timeError.textContent = message;
    timeError.hidden = !message;
    if (message) birthTime.setAttribute('aria-invalid', 'true');
    else birthTime.removeAttribute('aria-invalid');
  }

  const coordinates = (place: Observer | null | false | undefined) => place
    ? `${Math.abs(place.latitudeDeg).toFixed(2)}°${place.latitudeDeg < 0 ? 'S' : 'N'} ${Math.abs(place.longitudeDeg).toFixed(2)}°${place.longitudeDeg < 0 ? 'W' : 'E'}`
    : 'no birthplace coordinates';

  function describeBirth(input: BirthTimeInput, place: Observer | null, offset?: string) {
    const clock = input.time === null ? 'birth time unknown' : input.time;
    const zone = input.timeZone || (input.offsetOverride ? `recorded offset ${input.offsetOverride}` : '');
    return [`${input.date} ${clock}`, zone && offset ? `${zone} (UTC${offset})` : zone, coordinates(place)].filter(Boolean).join(' · ');
  }

  /** One statement of which chart is on screen, shown above the chart and in Export. */
  function refreshContext() {
    const pending = birthEdited && (attemptFailed || !birthDialog.open);
    const lead = applied.demo ? 'Demonstration chart (Greenwich), not your birth details' : 'Calculated chart';
    const base = `${lead}: ${applied.text}`;
    const state = pending ? 'pending' : applied.demo ? 'demo' : 'custom';
    const notice = pending
      ? `Not applied: your new birth details have not been calculated. The chart still shows the ${applied.demo ? 'Greenwich demonstration chart' : 'previous chart'}: ${applied.text}.`
      : applied.demo ? 'Greenwich demo chart, not yours. Use Edit birth details.' : `${base}.`;
    noticeEl.textContent = notice;
    noticeEl.dataset.state = state;
    sourceEl.textContent = pending
      ? `Export is blocked: your new birth details were not calculated. It would describe the ${applied.demo ? 'Greenwich demonstration chart' : 'previous chart'} (${applied.text}). Open Edit birth details and calculate first.`
      : applied.demo ? `Export source: ${base}. Calculate your own birth details to export them.` : `Export source: ${base}.`;
    sourceEl.dataset.state = state;
  }
  let activeProfileId: string | undefined;
  let frame = 0;
  const targets = () => PLANET_IDS.map(planetId => ({
      chartId: 'natal', planetId, longitudeDeg: natalPoints.get(planetId)?.longitudeDeg ?? null,
    }));
  const eventSearch = mountEventSearch(engine.modelDeltaTSeconds, () => ({
    targets: targets(),
    referenceTt: selectedTt,
  }), signal);
  const exportStudio = mountExportStudio(() => {
    if (frame) {
      cancelAnimationFrame(frame);
      redraw();
    }
    if (!natal || !transitChart) return null;
    const { utc, jdUt, jdTt } = transitChart.time;
    const selectedAt = { utc, jdUt, jdTt };
    return { targets: targets(), input: {
      engine: provenance, aspectRules: createAspectRuleSet(), charts: [natal, transitChart],
      aspects: [...birthAspects, ...transitAspects],
      context: { selectedAt, referenceAt: selectedAt, eventSearch: null },
    } };
  }, signal, () => birthEdited && (attemptFailed || !birthDialog.open)
    ? 'Export is blocked because your new birth details have not been calculated. Open Edit birth details and calculate first.' : '');
  mountProfiles(engine.modelDeltaTSeconds, () => {
    if (!natal || birthEdited) return null;
    return { birth: natal.time.input, observer: natal.settings.observer,
      houseSystem: natal.settings.requestedHouseSystem === 'Placidus' ? 'Placidus' : 'WholeSign' };
  }, profile => calculateBirth(false, profile), (id, name, saved) => {
    if (saved && (birthEdited || natal.time.input !== saved.birth)) return;
    if (saved || activeProfileId === id) {
      activeProfileId = name ? id : undefined;
      natal = { ...natal, label: name };
      exportStudio.invalidate();
    }
  }, signal);

  const houses = () => natal?.houses.status === 'available' ? natal.houses.value : null;
  const birthSuffix = () => natal ? ' The wheel still shows the last calculated birth details.' : '';

  function showFold(candidates: readonly OffsetCandidate[]) {
    const options = [node('option', 'Choose recorded offset')];
    options[0].value = '';
    for (const [index, candidate] of candidates.entries()) {
      const utc = candidate.utc?.replace('T', ' ').replace('.000Z', ' UTC') ?? candidate.historicalUt1Iso;
      const option = node('option', `${candidate.offset} · ${utc}`);
      option.value = index === 0 ? 'earlier' : 'later';
      options.push(option);
    }
    fold.replaceChildren(...options);
    foldArea.hidden = false;
  }

  function birthInput(): BirthTimeInput {
    const timezone = byId<HTMLInputElement>('birth-zone').value.trim();
    const offset = byId<HTMLInputElement>('birth-offset').value.trim().replace(/^−/, '-');
    const choice = foldArea.hidden ? '' : fold.value;
    return {
      date: byId<HTMLInputElement>('birth-date').value,
      time: unknown.checked ? null : normalizeBirthTime(birthTime.value),
      ...(timezone ? { timeZone: timezone } : {}),
      ...(offset && !unknown.checked ? { offsetOverride: offset } : {}),
      ...(choice === 'earlier' || choice === 'later' ? { disambiguation: choice } : {}),
    };
  }

  function observer(): Observer | null | false {
    const lat = byId<HTMLInputElement>('birth-lat');
    const lon = byId<HTMLInputElement>('birth-lon');
    if (lat.validity.badInput || lon.validity.badInput) return false;
    if (!lat.value && !lon.value) return null;
    const latitudeDeg = lat.valueAsNumber;
    const longitudeDeg = lon.valueAsNumber;
    if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) >= 90 ||
        !Number.isFinite(longitudeDeg) || Math.abs(longitudeDeg) > 180) return false;
    return { latitudeDeg, longitudeDeg };
  }

  function calculateBirth(example = false, profile?: NatalProfile) {
    const status = byId('birth-status');
    const input = profile ? profile.birth : birthInput();
    const location = profile ? profile.observer : observer();
    if (location === false) {
      const lat = byId<HTMLInputElement>('birth-lat').value;
      const lon = byId<HTMLInputElement>('birth-lon').value;
      attemptFailed = true;
      status.textContent = (!lat !== !lon
        ? 'Enter both latitude and longitude, or leave both blank. Nothing was calculated or saved.'
        : 'Enter both coordinates with latitude between −90° and 90° and longitude from −180° to 180°, or leave both blank.') + birthSuffix();
      refreshContext();
      return false;
    }
    const resolved = resolveBirthTime(input, engine.modelDeltaTSeconds);
    if (resolved.kind === 'unresolved') {
      if (resolved.candidates) showFold(resolved.candidates);
      attemptFailed = true;
      if (!profile && (resolved.reason === 'invalid-time' || resolved.reason === 'nonexistent-wall-time')) {
        const typed = birthTime.value.trim();
        setTimeError(resolved.reason === 'invalid-time'
          ? `${typed ? `“${typed}” is not a valid time. ` : 'Enter a birth time. '}Use the 24-hour clock as H:MM or HH:MM, for example 2:00, 02:00 or 14:30. AM and PM are not accepted (2:00 PM is 14:00).`
          : `${timeErrors[resolved.reason]}`);
        status.textContent = `The birth time needs attention, so the chart was not updated.${birthSuffix()}`;
        birthTime.focus();
      } else {
        status.textContent = timeErrors[resolved.reason] + birthSuffix();
      }
      refreshContext();
      return false;
    }
    setTimeError('');
    attemptFailed = false;
    const system = profile?.houseSystem ?? (byId<HTMLSelectElement>('house-system').value === 'Placidus' ? 'Placidus' : 'WholeSign');
    const label = profile?.name ?? (!birthEdited ? natal?.label ?? null : null);
    natal = { ...calculateNatal(engine, resolved, location || null, system), label };
    if (profile || birthEdited) activeProfileId = profile?.id;
    birthEdited = false;
    if (profile) {
      byId<HTMLInputElement>('birth-date').value = input.date;
      birthTime.value = input.time ?? '';
      birthTime.disabled = unknown.checked = input.time === null;
      byId<HTMLInputElement>('birth-zone').value = input.timeZone ?? '';
      byId<HTMLInputElement>('birth-offset').value = input.offsetOverride ?? '';
      byId<HTMLInputElement>('birth-lat').value = location ? String(location.latitudeDeg) : '';
      byId<HTMLInputElement>('birth-lon').value = location ? String(location.longitudeDeg) : '';
      byId<HTMLSelectElement>('house-system').value = system;
      foldArea.hidden = true;
      if (input.disambiguation) {
        const pending = resolveBirthTime({ ...input, disambiguation: undefined }, engine.modelDeltaTSeconds);
        if (pending.kind === 'unresolved' && pending.candidates) {
          showFold(pending.candidates);
          fold.value = input.disambiguation;
        }
      }
    }
    natalFacts = natal.planets.status === 'available' ? natal.planets.value : [];
    natalPoints = availablePositions(natalFacts);
    birthAspects = chartAspects(natalPoints);
    selectedKey = '';
    returnTo = undefined;
    if (!example) eventSearch.reset('Natal chart updated. Search this chart for events.');
    exportStudio.invalidate();
    status.textContent = resolved.kind === 'unknown-time' ? unavailableText('unknown-birth-time')
      : example ? 'Greenwich example. Edit birth details to use your own.'
        : natalPoints.size === 0 ? unavailableText(natalFacts[0]?.position.status === 'unavailable' ? natalFacts[0].position.reason : '')
          : `Birth time resolved with offset ${resolved.offset.value}.`;
    applied = { demo: example, text: describeBirth(input, location || null, resolved.kind === 'resolved' ? resolved.offset.value : undefined) };
    refreshContext();
    if (!example) status.textContent = `Chart calculated for ${applied.text}. ${status.textContent}`;
    queueRedraw();
    return true;
  }

  function aspectForSelection() {
    return [...birthAspects, ...transitAspects].find(aspect => aspect.id === selectedKey);
  }

  function relatedAspects() {
    const element = parseElementKey(selectedKey);
    if (element?.type === 'aspect') return [...birthAspects, ...transitAspects].filter(aspect => aspect.aspect === element.aspect);
    const [layer] = selectedKey.split('/');
    if (layer !== 'natal' && layer !== 'transit') return [];
    return [...birthAspects, ...transitAspects].filter(aspect => pointKey(aspect.from) === selectedKey || pointKey(aspect.to) === selectedKey);
  }

  function showInspection() {
    const active = inspection.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.selectKey : null;
    const [layer, id] = selectedKey.split('/') as [string, PlanetId];
    renderInspection(inspection, {
      key: selectedKey, aspect: aspectForSelection(), houses: houses(), related: relatedAspects(),
      natal: natalPoints, transit: transitPoints, aspects: [...birthAspects, ...transitAspects],
      houseReason: natal?.houses.status === 'unavailable' ? natal.houses.reason : '',
      requestedSystem: natal?.settings.requestedHouseSystem ?? null, orbs: createAspectRuleSet().orbsDeg,
      moment: selectedLabel, birth: applied.text, demo: applied.demo, back: returnTo,
      position: layer === 'natal' ? natalPoints.get(id) : layer === 'transit' ? transitPoints.get(id) : undefined,
    });
    if (active) [...inspection.querySelectorAll<HTMLButtonElement>('[data-select-key]')]
      .find(button => button.dataset.selectKey === active)?.focus({ preventScroll: true });
  }

  function markSelection() {
    for (const button of data.querySelectorAll<HTMLElement>('[data-inspect-key]')) {
      button.setAttribute('aria-pressed', String(button.dataset.inspectKey === selectedKey));
    }
    // A glossary concept is not on the wheel, so the wheel and the strip show no selection for it.
    const onWheel = parseElementKey(selectedKey)?.type === 'concept' ? '' : selectedKey;
    wheel.select(onWheel, aspectForSelection(), natalPoints, transitPoints, relatedAspects(),
      regionMembers(onWheel, natalPoints, transitPoints, houses()));
    tools.refreshStrip(natalPoints, transitPoints);
    tools.markSelection(onWheel);
  }

  function select(key: string) {
    if (parseElementKey(key)?.type === 'concept') {
      if (parseElementKey(selectedKey)?.type !== 'concept') {
        returnTo = { key: selectedKey, label: inspection.querySelector('.inspect-title')?.textContent || 'the chart guide' };
      }
    } else returnTo = undefined;
    selectedKey = key;
    showInspection();
    markSelection();
  }

  /** Opens the chart guide: the Inspector's start state, with full-size buttons for every sign, house, angle and aspect type. */
  function explore() {
    select('');
    const smooth = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    inspection.scrollIntoView({ behavior: smooth, block: 'start' });
    inspection.querySelector<HTMLElement>('.inspect-intro')?.focus({ preventScroll: true });
  }

  function showData() {
    const active = data.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.inspectKey : null;
    const natalHouses = houses();
    switch (reading) {
      case 'natal':
        data.replaceChildren(natalFacts.length ? planetTable(natalFacts, 'natal', natalHouses)
          : node('p', unavailableText('unknown-birth-time')));
        break;
      case 'transit':
        data.replaceChildren(transitFacts.length ? planetTable(transitFacts, 'transit', natalHouses)
          : node('p', 'Transit positions are unavailable.'));
        break;
      case 'aspects':
        data.replaceChildren(
          birthAspects.length ? aspectTable(birthAspects, 'Natal aspects') : node('p', 'No natal aspects available.'),
          transitAspects.length ? aspectTable(transitAspects, 'Transit-to-natal aspects') : node('p', 'No transit-to-natal aspects available.'),
        );
        break;
      case 'houses':
        data.replaceChildren(...(natalHouses ? houseTables(natalHouses)
          : [node('p', unavailableText(natal.houses.status === 'unavailable' ? natal.houses.reason : ''))]));
    }
    if (active) [...data.querySelectorAll<HTMLButtonElement>('[data-inspect-key]')]
      .find(button => button.dataset.inspectKey === active)?.focus({ preventScroll: true });
  }

  function redraw() {
    frame = 0;
    if (!natal || !selectedDate) return;
    const start = performance.now();
    const selectedAspect = aspectForSelection();
    const instant = resolveBirthTime({ date: selectedDate, time: selectedTime, offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
    selectedTt = instant.kind === 'resolved' ? instant.jdTt : null;
    const transit = instant.kind === 'resolved' ? calculatePositions(engine, instant) : null;
    provenance = transit?.provenance ?? null;
    transitChart = instant.kind === 'resolved' && transit ? {
      kind: 'transit', id: 'transit', label: null, time: instant,
      settings: { zodiac: 'tropical', requestedHouseSystem: null, observer: null },
      planets: { status: 'available', value: transit.planets },
      houses: { status: 'unavailable', reason: 'missing-location' }, warnings: transit.warnings,
    } : null;
    transitFacts = transit?.planets ?? [];
    transitPoints = availablePositions(transitFacts);
    transitAspects = chartAspects(natalPoints, transitPoints);
    if (selectedAspect && !aspectForSelection()) selectedKey = '';
    byId('selected-epoch').textContent = selectedLabel;
    const system = houses()?.effectiveSystem;
    byId('wheel-caption').textContent = natalPoints.size ? `${natal.time.input.date} natal${system ? ` · ${houseName(system)}` : ' · no houses'}`
      : 'Transit only · natal chart unavailable';
    transitStatus.textContent = transitPoints.size ? '' : 'Transit positions are unavailable for this date and time.';
    transitStatus.hidden = !transitStatus.textContent;

    const notes = new Set([
      ...natal.warnings, ...(natal.time.kind === 'resolved' ? natal.time.warnings : []),
      ...transit?.warnings ?? [], ...(instant.kind === 'resolved' ? instant.warnings : []),
    ]);
    const messages = [...notes].map(code => warnings[code]).filter(Boolean);
    if (natal.houses.status === 'unavailable') messages.unshift(unavailableText(natal.houses.reason));
    try {
      wheel.render(natal, natalPoints, transitPoints, birthAspects);
    } catch (error) {
      wheel.clear();
      messages.push('The wheel could not be drawn. Calculated values remain in Chart data.');
      console.error(error);
    }
    byId('calculation-notes').replaceChildren(...messages.map(message => node('li', message)));
    showData();
    showInspection();
    markSelection();
    performance.clearMeasures('divine-orchestration:redraw');
    performance.measure('divine-orchestration:redraw', { start, end: performance.now() });
  }

  function queueRedraw() {
    if (!frame) frame = requestAnimationFrame(redraw);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!calculateBirth()) return;
    const dialog = byId<HTMLDialogElement>('birth-dialog');
    if (dialog.open) dialog.close();
  }, { signal });
  form.addEventListener('input', event => {
    birthEdited = true;
    if (event.target === birthTime || event.target === unknown) setTimeError('');
    if (event.target === fold) return;
    birthTime.disabled = unknown.checked;
    foldArea.hidden = true;
    byId('birth-status').textContent = 'Birth details changed. Calculate to update the wheel.';
    refreshContext();
  }, { signal });
  birthDialog.addEventListener('close', refreshContext, { signal });
  document.querySelector('.data-switch')!.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
    if (!button || !natal) return;
    reading = button.dataset.view as Readings;
    for (const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-pressed', String(other === button));
    showData();
    markSelection();
  }, { signal });
  data.addEventListener('click', event => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-inspect-key]')?.dataset.inspectKey;
    if (key) select(key);
  }, { signal });
  inspection.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-select-key]');
    if (!target) return;
    select(target.dataset.selectKey ?? '');
    // The clicked button was replaced, so move focus to the new heading to keep keyboard users oriented.
    inspection.querySelector<HTMLElement>('.inspect-title, .inspect-intro')?.focus({ preventScroll: true });
  }, { signal });
  byId<HTMLButtonElement>('calculate').disabled = false;
  calculateBirth(true);
  bindTimeline((date, time, label) => {
    selectedLabel = label;
    if (date === selectedDate && time === selectedTime) {
      if (!frame) byId('selected-epoch').textContent = label;
      return;
    }
    exportStudio.invalidate();
    selectedDate = date;
    selectedTime = time;
    queueRedraw();
  }, signal);

  return () => {
    controls.abort();
    cancelAnimationFrame(frame);
    wheel.dispose();
  };
}
