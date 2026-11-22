import type { Chart, TimedChart } from '../domain/chart';
import type { EphemeraEngine } from '../engine/ephemera';
import { buildPersonalizedResearchPackage, DEFAULT_RESEARCH_PART_BYTES, toResearchDownloadFile, validateResearchPackage } from '../export/research-package';
import type { PersonalizedResearchPackage, ResearchDownload, ResearchExportMoment } from '../export/research-package';
import { researchExportChoices } from '../research/export-selection';
import type { PersonalizedResearchScope, ResearchSelection, ResultScope } from '../research/export-selection';
import { privacyNotices, resolveExportPrivacy } from '../export/research-privacy';
import { isSessionCompatibleWithChart } from '../research/session';
import type { ResearchSession } from '../research/session';
import { planetName } from './chart-data';
import { downloadBlob } from './download';
import { node } from './readings';
import { byId } from './timeline';

const scopeNames: Record<ResultScope, string> = {
  all: 'All', relevant: 'Relevant', primary: 'Primary', context: 'Broader context',
};
const modeNames: Record<PersonalizedResearchScope, string> = {
  current: 'Current filtered results', relevant: 'Relevant findings', complete: 'Complete original research',
};
const categoryNames = { exact: 'Exact contacts & stations', station: 'Stations only', all: 'All windows' };
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const changedChart = 'The natal chart changed. Run a search for this chart in Events, then choose Export Research.';
const changedSearch = 'The Events search changed. Choose Export Research again once the results are up to date.';

function timeLabel(moment: ResearchExportMoment): string {
  if (!moment) return 'Unavailable';
  if ('offsetTtDays' in moment) return `day ${number.format(moment.offsetTtDays)}`;
  if (moment.utc) return moment.utc.replace('T', ' ').replace('Z', ' UTC');
  return moment.jdTt === null ? 'Unavailable' : `JD ${number.format(moment.jdTt)} TT`;
}

export function mountResearchExportStudio(
  engine: EphemeraEngine,
  getChart: () => Chart,
  getTransitChart: () => TimedChart | null,
  chartGuard: () => string,
  signal: AbortSignal,
) {
  const snapshotChoice = byId<HTMLInputElement>('workflow-snapshot');
  const researchChoice = byId<HTMLInputElement>('workflow-research');
  const source = byId('research-export-source');
  const scopeHint = byId('research-export-scope-hint');
  const status = byId('research-export-status');
  const form = byId<HTMLFormElement>('research-export-form');
  const controls = byId<HTMLFieldSetElement>('research-export-controls');
  const birthPrivacy = byId<HTMLSelectElement>('research-birth-privacy');
  const datePrivacy = byId<HTMLSelectElement>('research-date-privacy');
  const format = byId<HTMLSelectElement>('research-export-format');
  const partSize = byId<HTMLSelectElement>('research-export-part-size');
  const includeNatal = byId<HTMLInputElement>('research-opt-natal');
  const includeTransit = byId<HTMLInputElement>('research-opt-transit');
  const output = byId('research-export-output');
  const filePicker = byId<HTMLSelectElement>('research-export-file');
  const preview = byId<HTMLTextAreaElement>('research-export-preview');
  const fileDetails = byId('research-file-details');
  const aiNote = byId('research-ai-context');
  const aiSteps = byId('research-ai-steps');
  const summary = byId('research-export-summary');
  const details = byId('research-export-details');
  const overview = byId('research-export-overview');
  const choiceCounts = byId('research-selection-counts');
  const linkedWrap = byId('research-linked-wrap');
  const linked = byId<HTMLInputElement>('research-linked-evidence');
  const selected = () => form.querySelector<HTMLInputElement>('input[name="research-export-mode"]:checked')!;
  const decoder = new TextDecoder();
  let session: ResearchSession | null = null;
  let selection: ResearchSelection | null = null;
  let choices: ReturnType<typeof researchExportChoices> | null = null;
  let ready: PersonalizedResearchPackage | null = null;
  let generation = 0;
  let building = false;

  function showWorkflow() {
    byId('snapshot-workflow').hidden = researchChoice.checked;
    byId('research-workflow').hidden = !researchChoice.checked;
  }

  function privacy() {
    return resolveExportPrivacy({
      birthDetails: birthPrivacy.value === 'full' ? 'full' : 'redacted',
      eventDates: datePrivacy.value === 'omit' ? 'omit' : datePrivacy.value === 'calendar' ? 'calendar' : 'relative',
    });
  }

  function updatePrivacyHint() {
    byId('research-privacy-hint').textContent = privacyNotices(privacy()).join(' ');
  }

  function clearPreview() {
    ++generation;
    building = false;
    ready = null;
    preview.value = '';
    filePicker.replaceChildren();
    fileDetails.textContent = '';
    output.hidden = true;
    form.hidden = session === null;
    controls.disabled = false;
  }

  function invalidateSource(message: string) {
    if (!session) return;
    session = null;
    selection = null;
    choices = null;
    clearPreview();
    source.textContent = message;
    scopeHint.hidden = true;
    scopeHint.textContent = '';
    status.textContent = '';
  }

  function sourceProblem(bound: ResearchSession) {
    return chartGuard() || (!isSessionCompatibleWithChart(bound, getChart()) ? changedChart : '');
  }

  function updateChoices() {
    if (!choices || !selection) return;
    const scope = selected().value as PersonalizedResearchScope;
    linkedWrap.hidden = scope !== 'current' || choices.linked === 0;
    byId('research-linked-label').textContent = `Include ${number.format(choices.linked)} linked return ${choices.linked === 1 ? 'window' : 'windows'}`;
    const include = choices.linked > 0 && linked.checked;
    const currentCount = choices.current + (include ? choices.linked : 0);
    byId('research-current-count').textContent = `· ${number.format(currentCount)} events`;
    byId('research-relevant-count').textContent = `· ${number.format(choices.relevant)} events`;
    byId('research-complete-count').textContent = `· ${number.format(choices.complete)} events`;
    const count = scope === 'current' ? currentCount : choices[scope];
    const excluded = choices.complete - count;
    const grouped = scope === 'current' && selection.filters.top !== null
      ? ` ${choices.current} selected groups with ${include ? choices.linked : 0} linked windows included.` : '';
    choiceCounts.textContent = count === 0
      ? `This choice exports an empty timeline and its research context. ${number.format(excluded)} events from the complete search stay outside this export.`
      : `${number.format(count)} events selected. ${number.format(excluded)} of ${number.format(choices.complete)} complete research events excluded.${grouped}`;
  }

  function accept(frozen: ResearchSelection): string {
    const bound = frozen.session;
    const problem = sourceProblem(bound);
    if (problem) return problem;
    session = bound;
    selection = frozen;
    choices = researchExportChoices(frozen);
    clearPreview();
    status.textContent = '';
    form.reset();
    byId<HTMLInputElement>('research-mode-current').checked = true;
    updatePrivacyHint();
    updateChoices();
    const { query, focus } = bound;
    const planets = focus.effectiveTransitingBodies.map(planetName);
    const searchMode = { everything: 'Explore Everything', themes: 'Life Themes', custom: 'Custom Search' }[query.mode];
    const labels = [
      `${searchMode} · ${query.range.startDate} to ${query.range.endDate} (UTC) · ${number.format(choices.complete)} results`,
      `${planets.length ? planets.join(', ') : 'No transiting planets in scope'} · Moon ${planets.includes('Moon') ? 'included' : 'excluded'}`,
      ...(focus.activeThemes.length ? [`Themes: ${focus.activeThemes.map(theme => theme.label).join(', ')}`] : []),
      ...(focus.activeHouses.length ? [`Focus houses: ${focus.activeHouses.join(', ')}`] : []),
    ];
    source.replaceChildren(...labels.map(text => node('span', text)));
    const { filters } = frozen;
    scopeHint.textContent = `Events view: ${scopeNames[filters.scope]}. ${categoryNames[filters.category]} · Impact ${filters.minimumImpact === null ? 'Off' : `${filters.minimumImpact}+`} · Top ${filters.top ?? 'All'} · Moon ${filters.showMoon ? 'visible when calculated' : 'hidden'}${filters.matchTheme ? ' · selected-theme matches' : ''}${filters.multiThemeOnly ? ' · multi-theme only' : ''}. The current selection includes all matching pages at handoff.`;
    scopeHint.hidden = false;
    researchChoice.checked = true;
    showWorkflow();
    if (location.hash !== '#export') location.hash = 'export';
    return '';
  }

  function showFile() {
    if (!ready) return;
    const index = Math.max(0, filePicker.selectedIndex);
    const file = ready.files[index];
    const entry = ready.document.schema === 'divine-orchestration/research-manifest' ? ready.document.parts[index - 1] : undefined;
    preview.value = decoder.decode(file.bytes);
    fileDetails.textContent = [
      file.name,
      entry ? `${number.format(entry.eventCount)} events` : '',
      entry?.eventIndexRange ? `Events ${number.format(entry.eventIndexRange[0])}–${number.format(entry.eventIndexRange[1])}` : '',
      `${number.format(file.bytes.length / 1000)} KB`,
      `About ${number.format(file.estimatedTokens ?? 0)} tokens`,
      entry?.exceedsPartBudget ? 'Exceeds target file size' : '',
    ].filter(Boolean).join(' · ');
  }

  function showPackage(pkg: PersonalizedResearchPackage) {
    const { research } = pkg.document;
    const manifest = pkg.document.schema === 'divine-orchestration/research-manifest' ? pkg.document : null;
    const { counts, moon } = research.scope;
    const { personalized } = research;
    const chosen = personalized.selection;
    const { coverage, status: calculationStatus, reason, unavailable } = research.calculation;
    summary.replaceChildren(...[
      modeNames[chosen.scope],
      `${number.format(counts.exported.total)} exported events`,
      `${number.format(chosen.counts.distinctCycles)} distinct contacts or cycles`,
      manifest ? `Manifest + ${number.format(manifest.parts.length)} event ${manifest.parts.length === 1 ? 'file' : 'files'}` : 'One research file',
      `${number.format(pkg.zip.bytes.length / 1000)} KB ZIP`,
      `About ${number.format(pkg.estimatedTokens)} tokens total`,
    ].map(text => Object.assign(node('li', text), { className: 'chip' })));

    const coverageText = `Coverage: ${calculationStatus}. ${number.format(coverage.requestedDays)} days requested · ${number.format(coverage.effectiveDays)} days calculated.`;
    const selectedMoment = research.selectedMomentTransit;
    details.replaceChildren(...[
      coverageText,
      ...(coverage.clippedToCoverage ? [reason === 'outside-coverage'
        ? 'The requested dates fall outside ephemeris coverage.'
        : 'The calculated interval was clipped to the available ephemeris.'] : []),
      ...(unavailable.length ? [`${unavailable.length} calculation inputs were unavailable. See the file's calculation details.`] : []),
      ...(research.privacy.eventDates !== 'omit' && coverage.effectiveDays > 0 ? [
        `Requested: ${timeLabel(coverage.requestedStart)} to ${timeLabel(coverage.requestedEnd)}. Calculated: ${timeLabel(coverage.effectiveStart)} to ${timeLabel(coverage.effectiveEnd)}.`,
      ] : []),
      `Search Moon scope: ${moon.included ? 'included' : 'excluded'} · ${number.format(counts.exported.moon)} Moon events exported.`,
      `${number.format(chosen.counts.excludedFromComplete)} of ${number.format(chosen.counts.complete)} complete research events excluded.`,
      ...(chosen.currentExclusions ? [
        `Current-result exclusions: ${chosen.currentExclusions.outsideViewScope} by view scope, ${chosen.currentExclusions.displayFilters} by display filters, ${chosen.currentExclusions.impactCutoff} by Impact, ${chosen.currentExclusions.topLimit} by Top N, ${chosen.currentExclusions.linkedEvidence} optional linked windows.`,
        `${chosen.counts.primary} selected events and ${chosen.counts.linkedIncluded} linked return ${chosen.counts.linkedIncluded === 1 ? 'window' : 'windows'} included.`,
      ] : []),
      `${number.format(counts.omittedBroaderContext)} broader-context events omitted by scope.`,
      ...(counts.outsideCalculatedBodyScope + counts.outsideExportComputationScope > 0
        ? ['Cached events outside your current calculation settings are excluded.'] : []),
      ...(counts.exported.axisCompanions > 0
        ? [`${number.format(counts.exported.axisCompanions)} folded axis windows are attached to their shared contacts.`] : []),
      ...(coverage.reference ? [`Past and future in the timeline use the Events reference moment · ${timeLabel(coverage.reference)}.`] : []),
      ...(research.natalSynthesis !== 'not-requested' ? [`Natal interpretation: ${research.natalSynthesis}.`] : []),
      ...(selectedMoment ? [`Selected-moment transit interpretation: ${selectedMoment.status}${selectedMoment.at ? ` · ${timeLabel(selectedMoment.at)}` : ''}.`] : []),
      ...(manifest?.parts.some(part => part.exceedsPartBudget)
        ? ['An event or its file header exceeds the target size. The export preserves the entire record.'] : []),
      research.privacyNotices.join(' '),
    ].map(text => node('li', text)));
    const insights = personalized.overview;
    overview.replaceChildren(...[
      personalized.convention,
      insights.strongest.length ? `Showing ${insights.strongest.length} strongest events from ${chosen.counts.exported} exported.` : 'No events are included in this timeline.',
      ...insights.strongest.map(event => `${event.eventId} · ${event.label} · Impact ${event.personalImpact} · Theme Relevance ${event.themeRelevance}`),
      `${insights.overlaps.totalPeriods} sustained overlaps at Impact ${insights.overlaps.minimumImpact}+ in the included evidence. ${insights.overlaps.highlights.length} highlighted.`,
      ...insights.overlaps.highlights.map(period => `Overlap ${period.periodNumber} · ${period.bodies.map(planetName).join(', ')} · peak ${period.peakConcurrentBodies} concurrent · ${number.format(period.observedDays)} observed days${period.start ? ` · ${timeLabel(period.start)} to ${timeLabel(period.end)}` : ''}${period.complete ? '' : ' · incomplete coverage'} · ${period.eventIds.join(', ')}`),
    ].map(text => node('li', text)));

    filePicker.replaceChildren(...pkg.files.map((_file, index) => {
      const label = manifest && index === 0 ? '00 · Research overview and manifest'
        : manifest ? `Part ${index} of ${manifest.parts.length} · ${number.format(manifest.parts[index - 1].eventCount)} events`
          : 'Research export';
      return node('option', label);
    }));
    byId('research-file-picker').hidden = pkg.files.length < 2;
    aiNote.textContent = research.ai.contextNote;
    aiSteps.replaceChildren(...research.ai.instructions.map(line => node('li', line)));
    ready = pkg;
    showFile();
    form.hidden = true;
    output.hidden = false;
    status.textContent = 'Research preview ready. Files verified.';
    if (researchChoice.checked && location.hash === '#export') byId('research-export-preview-heading').focus();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!session || !selection || building) return;
    const problem = sourceProblem(session);
    if (problem) { invalidateSource(problem); return; }
    const selectedTransitChart = includeTransit.checked ? getTransitChart() : null;
    if (includeTransit.checked && !selectedTransitChart) {
      status.textContent = 'Choose a valid Time Machine moment on the Chart tab or turn off the selected-moment interpretation.';
      return;
    }
    const bound = session;
    const request = ++generation;
    building = true;
    controls.disabled = true;
    status.textContent = 'Preparing and verifying research files…';
    try {
      const scope = selected().value as PersonalizedResearchScope;
      const pkg = await buildPersonalizedResearchPackage(selection, getChart(), {
        scope,
        includeLinked: scope === 'current' && !linkedWrap.hidden && linked.checked,
        format: format.value === 'json' ? 'json' : 'markdown',
        privacy: privacy(),
        partByteBudget: partSize.value === 'unsplit' ? null : partSize.value === 'standard' ? DEFAULT_RESEARCH_PART_BYTES : Number(partSize.value),
        interpretations: { includeNatal: includeNatal.checked, selectedTransitChart: selectedTransitChart ?? undefined, dateOnlyEngine: engine },
      });
      if (request !== generation || signal.aborted) return;
      await validateResearchPackage(pkg.files, pkg.zip.bytes);
      if (request !== generation || signal.aborted) return;
      const currentProblem = sourceProblem(bound);
      if (currentProblem) invalidateSource(currentProblem);
      else showPackage(pkg);
    } catch {
      if (request === generation) status.textContent = 'The research files could not be prepared or verified. Try preparing them again.';
    } finally {
      if (request === generation) {
        controls.disabled = false;
        building = false;
      }
    }
  }, { signal });

  function getReady() {
    if (!session || !ready) return null;
    const problem = sourceProblem(session);
    if (problem) { invalidateSource(problem); return null; }
    return ready;
  }

  async function copy(text: string, success: string, isFile: boolean) {
    const request = generation;
    try {
      await navigator.clipboard.writeText(text);
      if (request === generation) status.textContent = success;
    } catch {
      if (request !== generation) return;
      if (isFile) { preview.focus(); preview.select(); }
      status.textContent = isFile ? 'Clipboard access was unavailable. Copy the selected text or download the file.'
        : 'Clipboard access was unavailable. Select and copy the instructions above.';
    }
  }

  function download(file: ResearchDownload) {
    downloadBlob(file.name, toResearchDownloadFile(file));
    status.textContent = `Download started · ${file.name}`;
  }

  byId('research-copy-file').addEventListener('click', () => {
    if (getReady()) void copy(preview.value, 'Research file copied.', true);
  }, { signal });
  byId('research-download-file').addEventListener('click', () => {
    const pkg = getReady();
    if (pkg) download(pkg.files[Math.max(0, filePicker.selectedIndex)]);
  }, { signal });
  byId('research-download-zip').addEventListener('click', () => {
    const pkg = getReady();
    if (pkg) download(pkg.zip);
  }, { signal });
  byId('research-copy-prompt').addEventListener('click', () => {
    const pkg = getReady();
    if (!pkg) return;
    const { ai } = pkg.document.research;
    void copy([ai.contextNote, ...ai.instructions].join('\n\n'), 'Research instructions copied.', false);
  }, { signal });
  byId('research-export-back').addEventListener('click', () => {
    clearPreview();
    status.textContent = '';
    selected().focus();
  }, { signal });
  filePicker.addEventListener('change', showFile, { signal });
  form.addEventListener('change', event => {
    if (event.target === linked || (event.target as HTMLInputElement).name === 'research-export-mode') updateChoices();
  }, { signal });
  birthPrivacy.addEventListener('change', updatePrivacyHint, { signal });
  datePrivacy.addEventListener('change', updatePrivacyHint, { signal });
  for (const choice of [snapshotChoice, researchChoice]) choice.addEventListener('change', showWorkflow, { signal });
  showWorkflow();
  updatePrivacyHint();

  return {
    accept,
    showSnapshot() {
      snapshotChoice.checked = true;
      showWorkflow();
    },
    syncChart() {
      if (!session) return;
      const problem = sourceProblem(session);
      if (problem) invalidateSource(problem);
    },
    invalidateQuery() { invalidateSource(changedSearch); },
    invalidateMoment() {
      if (includeTransit.checked && (ready || building)) {
        clearPreview();
        status.textContent = 'The Time Machine moment changed. Prepare the research files again to update the selected-moment interpretation.';
      }
    },
  };
}
