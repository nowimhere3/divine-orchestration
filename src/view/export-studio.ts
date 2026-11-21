import { PLANET_IDS } from '../domain/chart';
import type { EphemeraEngine } from '../engine/ephemera';
import { selectEventContext } from '../export/event-selection';
import type { EventSelection } from '../export/event-selection';
import { createSnapshotV0, renderSnapshotMarkdown, serializeSnapshot } from '../export/snapshot';
import type { SnapshotInput, SnapshotV0 } from '../export/snapshot';
import { natalSymbolicMeanings, transitSymbolicMeanings } from '../interpret';
import type { NatalReading, TransitReading } from '../interpret';
import { startEventSearch } from '../search/client';
import type { EventSearchJob } from '../search/client';
import type { FixedNatalPoint } from '../search/events';
import { downloadText } from './download';
import { byId } from './timeline';

export const interpretationPrompt = [
  'Interpret only the calculated facts supplied in the Divine Orchestration snapshot.',
  'Separate symbolic interpretation from astronomical facts. Cite the relevant planet, aspect, event or chart entry for each claim.',
  'Use the selected instant and relative event timing provided. A near miss is not an exact contact, and a clipped or unavailable value must remain unspecified.',
  'Do not invent planetary positions, times, events, birth details or missing interpretations. If the data is insufficient, say what is missing.',
].join(' ');

export const natalDeepDivePrompt = [
  'Using only the calculated natal chart facts (and any local symbolic synthesis) supplied in this Divine Orchestration snapshot, offer a thoughtful, personalized birth-chart synthesis.',
  'Organize the reading around core placements (Sun, Moon, Ascendant and chart ruler when available), major multi-factor themes (element/modality balance, stelliums, tightest aspects) and constructive reflection questions.',
  'Keep astronomical measurements clearly distinct from traditional astrological symbolism. Never present symbolism as guaranteed prediction, never invent missing houses, angles, degrees or birth details, and note any unavailable data honestly.',
].join(' ');

export const transitDeepDivePrompt = [
  'Using only the calculated natal positions, transiting sky positions, transit-to-natal aspects, planetary events and any local transit synthesis in this Divine Orchestration snapshot, provide a grounded, personalized transit reflection for the selected moment.',
  'Distinguish long-term outer-planet cycles from shorter medium-term and lunar transits, note applying versus separating motion and retrograde passes where supplied, and keep astronomical facts separate from traditional symbolism.',
  'Never invent exact pass dates, houses, angles or events that are not supplied, never treat near misses as exact contacts, and frame all guidance for reflection and planning rather than guaranteed prediction.',
].join(' ');

export function mountExportStudio(
  engine: EphemeraEngine,
  capture: () => { input: SnapshotInput; targets: readonly FixedNatalPoint[]; natalReading?: NatalReading; transitReading?: TransitReading } | null,
  signal: AbortSignal,
  /** Returns a reason when the chart on screen is not the one the person has entered, so nothing is exported. */
  guard: () => string = () => '',
) {
  const form = byId<HTMLFormElement>('export-form');
  const controls = byId<HTMLFieldSetElement>('export-controls');
  const options = byId('export-event-options');
  const includeNatal = byId<HTMLInputElement>('export-include-natal');
  const includeTransits = byId<HTMLInputElement>('export-include-transits');
  const stepTwo = byId('export-step-two');
  const summary = byId('export-summary');
  const moment = byId('export-moment');
  const choice = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
  const privacy = () => choice('export-privacy');
  const context = () => choice('export-context');
  const format = () => choice('export-format');
  const promptPreset = () => choice('export-prompt-preset');
  const preview = byId<HTMLTextAreaElement>('export-preview');
  const status = byId('export-status');
  const cancel = byId<HTMLButtonElement>('export-cancel');
  const progress = byId<HTMLProgressElement>('export-progress');
  const actions = ['export-copy', 'export-md', 'export-json'].map(id => byId<HTMLButtonElement>(id));
  let snapshot: SnapshotV0 | undefined;
  let job: EventSearchJob | undefined;

  function activePrompt() {
    const preset = promptPreset();
    return preset === 'natal' ? natalDeepDivePrompt
      : preset === 'transit' ? transitDeepDivePrompt
        : interpretationPrompt;
  }

  function showPrompt() {
    byId('interpretation-prompt').textContent = activePrompt();
  }

  function showPreview() {
    preview.value = !snapshot ? '' : format() === 'json' ? serializeSnapshot(snapshot) : renderSnapshotMarkdown(snapshot);
    for (const action of actions) action.disabled = !snapshot;
  }

  /** Step 1 configures; step 2 previews and exports. Moving to step 2 puts focus on its heading. */
  function showStep(step: 1 | 2, moveFocus = false) {
    form.hidden = step !== 1;
    stepTwo.hidden = step !== 2;
    for (const [id, number] of [['step-configure', 1], ['step-preview', 2]] as const) {
      const item = byId(id);
      if (number === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('done', number < step);
    }
    if (moveFocus) byId(step === 2 ? 'export-preview-heading' : 'export-heading').focus();
  }

  /** The selected moment is the Time Machine's own text, so the two can never disagree. */
  function showMoment() {
    const relative = document.getElementById('time-relative')?.textContent;
    moment.textContent = `${byId('selected-epoch').textContent ?? ''}${relative ? ` · ${relative}` : ''}`;
  }

  function setBusy(busy: boolean) {
    controls.disabled = busy;
    progress.hidden = cancel.hidden = !busy;
  }

  function invalidate(message = 'Selection changed. Prepare a new export.') {
    if (!snapshot && !job) return;
    const previous = job;
    job = undefined;
    previous?.cancel();
    snapshot = undefined;
    setBusy(false);
    showPreview();
    showStep(1);
    status.textContent = message;
  }

  function showOptions() {
    const show = context() === 'events';
    options.hidden = !show;
    for (const input of options.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) input.disabled = !show;
  }

  async function copy(text: string, note: string) {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = note;
    } catch {
      status.textContent = 'Clipboard access was unavailable. Select and copy the text manually or download the preview.';
    }
  }

  form.addEventListener('input', () => { invalidate(); showOptions(); }, { signal });
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="export-format"]')) radio.addEventListener('change', showPreview, { signal });
  byId('export-back').addEventListener('click', () => { showStep(1); form.querySelector<HTMLElement>('input:checked, button[type="submit"]')?.focus(); }, { signal });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (job) return;
    const blocked = guard();
    if (blocked) { status.textContent = blocked; return; }
    const captured = capture();
    if (!captured) { status.textContent = 'Wait for the current chart and Time Machine moment to finish updating.'; return; }
    invalidate();
    const redactBirthDetails = privacy() !== 'full';
    let input = captured.input;
    let active: EventSearchJob | undefined;
    try {
      if (context() === 'events') {
        const daysBefore = byId<HTMLInputElement>('export-before').valueAsNumber;
        const daysAfter = byId<HTMLInputElement>('export-after').valueAsNumber;
        if (![daysBefore, daysAfter].every(days => Number.isInteger(days) && days >= 0 && days <= 90) ||
            daysBefore + daysAfter === 0) throw new Error('Choose 1 to 180 days of context, with at most 90 days on each side.');
        const selection: EventSelection = {
          daysBefore, daysAfter,
          timing: byId<HTMLSelectElement>('export-timing').value as EventSelection['timing'],
          filter: byId<HTMLSelectElement>('export-kind').value as EventSelection['filter'],
          limit: Number(byId<HTMLSelectElement>('export-limit').value),
        };
        const referenceTt = input.context.selectedAt!.jdTt!;
        status.textContent = 'Searching events for this export…';
        progress.removeAttribute('value');
        setBusy(true);
        active = startEventSearch({
          startTt: referenceTt - daysBefore, endTt: referenceTt + daysAfter, referenceTt,
          transitChartId: 'transit', bodies: PLANET_IDS, targets: captured.targets, rules: input.aspectRules,
        }, ({ completed, total }) => {
          if (active !== job) return;
          progress.max = total;
          progress.value = completed;
        });
        job = active;
        const result = await active.result;
        if (active !== job) return;
        input = { ...input, context: { ...input.context, ...selectEventContext(result, selection) } };
      }
      if (!redactBirthDetails && (includeNatal.checked || includeTransits.checked)) {
        const natalChartId = input.charts.find(c => c.kind === 'natal')?.id ?? 'natal';
        const transitChartId = input.charts.find(c => c.kind === 'transit')?.id ?? 'transit';
        const fullMeanings = [
          ...(includeNatal.checked && captured.natalReading ? natalSymbolicMeanings(captured.natalReading, natalChartId) : []),
          ...(includeTransits.checked && captured.transitReading ? transitSymbolicMeanings(captured.transitReading, transitChartId, natalChartId) : []),
        ];
        input = { ...input, interpretations: fullMeanings };
      }
      snapshot = createSnapshotV0(input, {
        redactBirthDetails,
        includeRedactedNatalSynthesis: includeNatal.checked,
        includeRedactedTransitSynthesis: includeTransits.checked,
        dateOnlyEngine: engine,
      });
      showPreview();
      const eventSummary = input.context.eventSummary;
      const synthCount = snapshot.interpretations.length;
      status.textContent = eventSummary
        ? `Preview ready. Includes ${eventSummary.includedEvents} of ${eventSummary.totalEvents} events. Search status: ${eventSummary.status}.`
        : synthCount
          ? `Preview ready for the selected moment, with ${synthCount} local symbolic notes.`
          : 'Preview ready for the selected moment.';
      summary.replaceChildren(...[
        redactBirthDetails ? 'Redacted' : 'Full',
        eventSummary ? `${eventSummary.includedEvents} of ${eventSummary.totalEvents} events` : 'Selected moment only',
        eventSummary ? `Search ${eventSummary.status}` : '',
        synthCount ? `${synthCount} symbolic notes` : '',
        `${preview.value.length.toLocaleString('en')} characters`,
      ].filter(Boolean).map(text => Object.assign(document.createElement('li'), { className: 'chip', textContent: text })));
      showStep(2, true);
    } catch (error) {
      if (active && active !== job) return;
      status.textContent = error instanceof Error ? error.message : 'Could not prepare the export.';
    } finally {
      if (active === job) { job = undefined; setBusy(false); }
    }
  }, { signal });
  cancel.addEventListener('click', () => {
    invalidate('Export search canceled.');
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  }, { signal });
  actions[0].addEventListener('click', () => { if (snapshot) void copy(preview.value, 'Preview copied.'); }, { signal });
  for (const [index, extension, mime, render] of [
    [1, 'md', 'text/markdown', renderSnapshotMarkdown], [2, 'json', 'application/json', serializeSnapshot],
  ] as const) {
    actions[index].addEventListener('click', () => {
      if (!snapshot) return;
      downloadText(`divine-orchestration-${snapshot.privacy}.${extension}`, render(snapshot), mime);
      status.textContent = 'Snapshot downloaded.';
    }, { signal });
  }
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="export-prompt-preset"]')) {
    radio.addEventListener('change', showPrompt, { signal });
  }
  showPrompt();
  byId('export-copy-prompt').addEventListener('click', () => void copy(activePrompt(), 'Interpretation prompt copied.'), { signal });
  signal.addEventListener('abort', () => job?.cancel(), { once: true });
  new MutationObserver(showMoment).observe(byId('selected-epoch'), { childList: true, characterData: true, subtree: true });
  const relative = document.getElementById('time-relative');
  if (relative) new MutationObserver(showMoment).observe(relative, { childList: true, characterData: true, subtree: true });
  showMoment();
  showOptions();
  showStep(1);
  setBusy(false);
  return { invalidate };
}
