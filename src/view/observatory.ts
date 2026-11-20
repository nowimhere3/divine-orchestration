import { PLANET_IDS } from '../domain/chart';
import { createAspectRuleSet } from '../domain/aspects';
import type { Chart, PlanetFact, PlanetId, TimedChart } from '../domain/chart';
import type { EphemeraEngine, Observer } from '../engine/ephemera';
import type { SnapshotInput } from '../export/snapshot';
import type { NatalProfile } from '../store/library';
import { resolveBirthTime } from '../time/resolve';
import type { BirthTimeInput, OffsetCandidate, TimeResolution } from '../time/resolve';
import { AstroWheel, pointKey } from './astro-wheel';
import { availablePositions, calculateNatal, calculatePositions, chartAspects, planetName } from './chart-data';
import type { PositionMap } from './chart-data';
import { aspectTable, houseName, houseTables, node, planetTable, unavailableText } from './readings';
import { renderInspection } from './inspector';
import { mountChartTools } from './chart-tools';
import { bindTimeline, byId } from './timeline';
import { mountEventSearch } from './event-search';
import { mountProfiles } from './profile-panel';
import { mountExportStudio } from './export-studio';

type Readings = 'natal' | 'transit' | 'aspects' | 'houses';
type Unresolved = Extract<TimeResolution, { kind: 'unresolved' }>;

const timeErrors: Record<Unresolved['reason'], string> = {
  'invalid-date': 'Enter a valid birth date.',
  'invalid-time': 'Enter a local time as HH:MM or HH:MM:SS.',
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
  const unknown = byId<HTMLInputElement>('unknown-time');
  const birthTime = byId<HTMLInputElement>('birth-time');
  const foldArea = byId('fold-choices');
  const fold = byId<HTMLSelectElement>('fold-choice');
  const data = byId('data-view');
  const inspection = byId('inspection');
  const transitStatus = byId('transit-status');
  const wheel = new AstroWheel(byId('wheel'), select);
  const tools = mountChartTools(wheel, { select, inspection }, signal);
  let natal: Chart;
  let natalFacts: readonly PlanetFact[] = [];
  let natalPoints: PositionMap = new Map();
  let transitFacts: readonly PlanetFact[] = [];
  let transitPoints: PositionMap = new Map();
  let birthAspects = chartAspects(natalPoints);
  let transitAspects = birthAspects;
  let selectedKey = '';
  let reading: Readings = 'natal';
  let selectedDate = '';
  let selectedTime = '';
  let selectedTt: number | null = null;
  let transitChart: TimedChart | null = null;
  let provenance: SnapshotInput['engine'] = null;
  let birthEdited = false;
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
  }, signal);
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
      time: unknown.checked ? null : birthTime.value.trim(),
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
      status.textContent = (!lat !== !lon
        ? 'Enter both latitude and longitude, or leave both blank. Nothing was calculated or saved.'
        : 'Enter both coordinates with latitude between −90° and 90° and longitude from −180° to 180°, or leave both blank.') + birthSuffix();
      return false;
    }
    const resolved = resolveBirthTime(input, engine.modelDeltaTSeconds);
    if (resolved.kind === 'unresolved') {
      if (resolved.candidates) showFold(resolved.candidates);
      status.textContent = timeErrors[resolved.reason] + birthSuffix();
      return false;
    }
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
    if (!example) eventSearch.reset('Natal chart updated. Search this chart for events.');
    exportStudio.invalidate();
    status.textContent = resolved.kind === 'unknown-time' ? unavailableText('unknown-birth-time')
      : example ? 'Greenwich example. Edit birth details to use your own.'
        : natalPoints.size === 0 ? unavailableText(natalFacts[0]?.position.status === 'unavailable' ? natalFacts[0].position.reason : '')
          : `Birth time resolved with offset ${resolved.offset.value}.`;
    byId('chart-notice').textContent = status.textContent;
    queueRedraw();
    return true;
  }

  function aspectForSelection() {
    return [...birthAspects, ...transitAspects].find(aspect => aspect.id === selectedKey);
  }

  function relatedAspects() {
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
      position: layer === 'natal' ? natalPoints.get(id) : layer === 'transit' ? transitPoints.get(id) : undefined,
    });
    if (active) [...inspection.querySelectorAll<HTMLButtonElement>('[data-select-key]')]
      .find(button => button.dataset.selectKey === active)?.focus({ preventScroll: true });
  }

  function markSelection() {
    for (const button of data.querySelectorAll<HTMLElement>('[data-inspect-key]')) {
      button.setAttribute('aria-pressed', String(button.dataset.inspectKey === selectedKey));
    }
    wheel.select(selectedKey, aspectForSelection(), natalPoints, transitPoints, relatedAspects());
    tools.refreshStrip(natalPoints, transitPoints);
    tools.markSelection(selectedKey);
  }

  function select(key: string) {
    selectedKey = key;
    showInspection();
    markSelection();
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
    byId('selected-epoch').textContent = `${selectedDate} · ${selectedTime} ${instant.kind === 'resolved' && !instant.utc ? 'approx. UT1' : 'UTC'}`;
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
    if (event.target === fold) return;
    birthTime.disabled = unknown.checked;
    foldArea.hidden = true;
    byId('birth-status').textContent = 'Birth details changed. Calculate to update the wheel.';
  }, { signal });
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
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-select-key]')?.dataset.selectKey;
    if (!key) return;
    select(key);
    // The clicked button was replaced, so move focus to the new heading to keep keyboard users oriented.
    inspection.querySelector<HTMLElement>('.inspect-title')?.focus({ preventScroll: true });
  }, { signal });
  byId<HTMLButtonElement>('calculate').disabled = false;
  calculateBirth(true);
  bindTimeline((date, time) => {
    if (date === selectedDate && time === selectedTime) return;
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
