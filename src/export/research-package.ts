import type { Chart } from '../domain/chart';
import { isSessionCompatibleWithChart } from '../research/session';
import type { ResearchSession } from '../research/session';
import type { PersonalizedResearchScope, ResearchSelection } from '../research/export-selection';
import { exportCalculation, exportChartContext, exportChartFactors, exportQuery, exportThemes, themeAliases } from './research-context';
import type { ResearchInterpretationContext } from './research-context';
import { countExportEvents, selectResearchEvents } from './research-events';
import type { ResearchExportEventV1, ResearchExportMode } from './research-events';
import { IMPACT_CONVENTION, preparePersonalizedSelection, projectPersonalizedResearch } from './research-personalized';
import type { PersonalizedResearchV2, ResearchExportEventV2 } from './research-personalized';
import { knownValue, privacyNotices, projectMoments, resolveExportPrivacy } from './research-privacy';
import type { ResearchExportMoment, ResearchExportPrivacy } from './research-privacy';
import { AI_CONTEXT_NOTE, AI_RESEARCH_INSTRUCTIONS, partInstruction } from './research-prompts';
import { createStoreZip } from './zip-store';
import type { ArchiveFile } from './zip-store';

export type { ResearchInterpretationContext } from './research-context';
export type { ResearchExportEventV1, ResearchExportMode } from './research-events';
export type { ResearchExportEventV2 } from './research-personalized';
export type { ResearchExportMoment, ResearchExportPrivacy } from './research-privacy';

export type ResearchExportFormat = 'json' | 'markdown';
export const DEFAULT_RESEARCH_PART_BYTES = 180_000;

export interface ResearchExportOptions {
  readonly mode: ResearchExportMode;
  readonly format?: ResearchExportFormat;
  readonly privacy?: Partial<ResearchExportPrivacy>;
  /** UTF-8 bytes per event file. Null requests an unsplit event payload. */
  readonly partByteBudget?: number | null;
  readonly interpretations?: ResearchInterpretationContext;
}
export interface PersonalizedResearchExportOptions extends Omit<ResearchExportOptions, 'mode'> {
  readonly scope: PersonalizedResearchScope;
  readonly includeLinked?: boolean;
}

interface ResearchSharedV1 {
  readonly exportMode: ResearchExportMode;
  readonly privacy: ResearchExportPrivacy;
  readonly privacyNotices: readonly string[];
  readonly query: ReturnType<typeof exportQuery>;
  readonly themes: ReturnType<typeof exportThemes>;
  readonly scope: ReturnType<typeof selectResearchEvents>['scope'];
  readonly calculation: ReturnType<typeof exportCalculation>;
  readonly snapshot: ReturnType<typeof exportChartContext>['snapshot'];
  readonly chartFactors: ReturnType<typeof exportChartFactors>;
  readonly natalSynthesis: 'not-requested' | 'included' | 'unavailable';
  readonly selectedMomentTransit: ReturnType<typeof exportChartContext>['selectedMomentTransit'];
  readonly ai: { readonly contextNote: string; readonly instructions: readonly string[] };
}

const STANDALONE_SCHEMA = 'divine-orchestration/research-export';
const MANIFEST_SCHEMA = 'divine-orchestration/research-manifest';
const PART_SCHEMA = 'divine-orchestration/research-events-part';
type SchemaVersion = 1 | 2;
type ResearchSharedV2 = ResearchSharedV1 & { readonly personalized: PersonalizedResearchV2 };
type ResearchFor<V extends SchemaVersion> = V extends 1 ? ResearchSharedV1 : ResearchSharedV2;
type EventFor<V extends SchemaVersion> = V extends 1 ? ResearchExportEventV1 : ResearchExportEventV2;

interface ExportHeader<V extends SchemaVersion> {
  readonly schemaVersion: V;
  readonly packageId: string;
  readonly format: ResearchExportFormat;
}

interface ResearchExportDocument<V extends SchemaVersion> extends ExportHeader<V> {
  readonly schema: typeof STANDALONE_SCHEMA;
  readonly research: ResearchFor<V>;
  readonly events: readonly EventFor<V>[];
}

type EventIndexRange = readonly [first: number, last: number] | null;

export interface ResearchPartInventoryV1 {
  readonly partNumber: number;
  readonly totalParts: number;
  readonly filename: string;
  readonly eventCount: number;
  readonly eventIndexRange: EventIndexRange;
  /** Ordering moments of the first and last events, under the same date policy. */
  readonly orderSpan: readonly [ResearchExportMoment, ResearchExportMoment] | null;
  readonly bytes: number;
  readonly estimatedTokens: number;
  readonly exceedsPartBudget: boolean;
  readonly sha256: string;
}

interface ResearchManifest<V extends SchemaVersion> extends ExportHeader<V> {
  readonly schema: typeof MANIFEST_SCHEMA;
  readonly research: ResearchFor<V>;
  readonly partByteBudget: number | null;
  readonly parts: readonly ResearchPartInventoryV1[];
}

interface ResearchEventsPart<V extends SchemaVersion> extends ExportHeader<V> {
  readonly schema: typeof PART_SCHEMA;
  readonly privacy: ResearchExportPrivacy;
  readonly partNumber: number;
  readonly totalParts: number;
  readonly eventCount: number;
  readonly totalEvents: number;
  readonly eventIndexRange: EventIndexRange;
  readonly instruction: string;
  readonly events: readonly EventFor<V>[];
}
export type ResearchExportV1 = ResearchExportDocument<1>;
export type ResearchManifestV1 = ResearchManifest<1>;
export type ResearchEventsPartV1 = ResearchEventsPart<1>;
export type PersonalizedResearchManifest = ResearchManifest<2>;
export type PersonalizedResearchPart = ResearchEventsPart<2>;

export interface ResearchDownload extends ArchiveFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mediaType: string;
  readonly sha256: string;
  /** Rough bytes/4 heuristic for text files. ZIP is for transport. */
  readonly estimatedTokens: number | null;
}

interface VersionedResearchPackage<V extends SchemaVersion> {
  readonly document: ResearchExportDocument<V> | ResearchManifest<V>;
  readonly files: readonly ResearchDownload[];
  readonly zip: ResearchDownload;
  readonly estimatedTokens: number;
}
export type ResearchPackage = VersionedResearchPackage<1>;
export type PersonalizedResearchPackage = VersionedResearchPackage<2>;

type Artifact = ResearchExportDocument<SchemaVersion> | ResearchManifest<SchemaVersion> | ResearchEventsPart<SchemaVersion>;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const filenameExt = (format: ResearchExportFormat) => format === 'json' ? 'json' : 'md';
const textType = (format: ResearchExportFormat) => format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8';
const tokenEstimate = (bytes: number) => Math.ceil(bytes / 4);

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('Research export requires finite numbers.');
    return item;
  });
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function contentId(research: ResearchSharedV1, events: readonly ResearchExportEventV1[]): Promise<string> {
  return `research-${await sha256(encoder.encode(json([research, events])))}`;
}

function markdownHeader(value: Artifact): string {
  if (value.schema === PART_SCHEMA) {
    return `# Research events · Part ${value.partNumber} of ${value.totalParts}\n\n` +
      `${value.eventCount} events in this part · ${value.totalEvents} events in the package.\n\n${value.instruction}\n\n`;
  }
  const { research } = value;
  const heading = value.schema === MANIFEST_SCHEMA ? 'Research manifest' : 'Research export';
  const parts = value.schema === MANIFEST_SCHEMA ? ` · ${value.parts.length} numbered parts` : '';
  const personal = 'personalized' in research ? research.personalized : null;
  const overviewTime = (moment: ResearchExportMoment) => !moment ? '' : 'offsetTtDays' in moment
    ? `TT day ${Number(moment.offsetTtDays.toFixed(5))}` : (moment.utc ?? `JD ${moment.jdTt} TT`);
  const overview = personal ? '## Research overview\n\n' +
    `Scope: ${personal.selection.scope}. ${personal.selection.counts.exported} events in ${personal.selection.counts.distinctCycles} distinct contacts or cycles.\n\n` +
    `${personal.convention}\n\n` +
    personal.overview.strongest.map(event => `- ${event.eventId}: ${event.label} · Impact ${event.personalImpact} · Theme Relevance ${event.themeRelevance}\n`).join('') +
    `\n${personal.overview.overlaps.totalPeriods} sustained overlap periods at Impact ${personal.overview.overlaps.minimumImpact}+ within the exported evidence.\n\n` +
    personal.overview.overlaps.highlights.map(period =>
      `- Overlap ${period.periodNumber}${period.start ? ` · ${overviewTime(period.start)} to ${overviewTime(period.end)}` : ''} · peak ${period.peakConcurrentBodies} bodies · ${period.bodies.join(', ')} · references ${period.eventIds.join(', ')}\n`,
    ).join('') + '\n' : '';
  return `# Divine Orchestration · ${heading}\n\n` +
    `${research.scope.counts.exported.total} events${parts} · Calculation status ${research.calculation.status}.\n\n` +
    `${AI_CONTEXT_NOTE}\n\n## Privacy\n\n${research.privacyNotices.map(note => `- ${note}`).join('\n')}\n\n` +
    `## External AI instructions\n\n${research.ai.instructions.map((line, index) => `${index + 1}. ${line}`).join('\n')}\n\n` +
    overview + '## Research data\n\n';
}

/** Markdown uses the identical structured data in a fence, with one record per event line. */
function renderArtifact(value: Artifact, eventLines?: readonly string[]): string {
  const entries = Object.entries(value).map(([key, item]) =>
    key === 'events'
      ? `"events": [\n${(eventLines ?? (item as readonly ResearchExportEventV1[]).map(json)).join(',\n')}\n]`
      : `${json(key)}: ${json(item)}`,
  );
  const body = `{\n${entries.join(',\n')}\n}\n`;
  return value.format === 'json' ? body : `${markdownHeader(value)}\x60\x60\x60json\n${body}\x60\x60\x60\n`;
}

function exportHeader<V extends SchemaVersion>(format: ResearchExportFormat, packageId: string, schemaVersion: V): ExportHeader<V> {
  return { schemaVersion, packageId, format };
}

function partFileName(number: number, total: number, format: ResearchExportFormat): string {
  const width = Math.max(2, String(total).length);
  return `${String(number).padStart(width, '0')}-of-${String(total).padStart(width, '0')}.${filenameExt(format)}`;
}

function makePart<V extends SchemaVersion>(
  header: ExportHeader<V>, privacy: ResearchExportPrivacy, events: readonly EventFor<V>[],
  from: number, to: number, number: number, total: number,
): ResearchEventsPart<V> {
  return {
    schema: PART_SCHEMA, ...header, privacy, partNumber: number, totalParts: total,
    eventCount: to - from, totalEvents: events.length, eventIndexRange: from === to ? null : [from + 1, to],
    instruction: partInstruction(number, total), events: events.slice(from, to),
  };
}

function partitionEvents<V extends SchemaVersion>(
  header: ExportHeader<V>, privacy: ResearchExportPrivacy, events: readonly EventFor<V>[],
  lines: readonly string[], budget: number | null,
): readonly (readonly [number, number])[] {
  if (budget === null || events.length === 0) return [[0, events.length]];
  const max = events.length;
  // Reserve enough bytes for the largest index, count and instruction even before totalParts is known.
  const largestHeader: ResearchEventsPart<V> = {
    ...makePart(header, privacy, [], 0, 0, max, max),
    eventCount: max, totalEvents: max, eventIndexRange: [max, max], instruction: partInstruction(1, 2),
  };
  const overhead = encoder.encode(renderArtifact(largestHeader)).length;
  const ranges: [number, number][] = [];
  let from = 0;
  let size = overhead;
  for (const [index, line] of lines.entries()) {
    const lineSize = encoder.encode(line).length;
    if (index > from && size + 2 + lineSize > budget) {
      ranges.push([from, index]);
      from = index;
      size = overhead;
    }
    size += lineSize + (index > from ? 2 : 0);
  }
  ranges.push([from, lines.length]);
  return ranges;
}

function orderSpan(part: ResearchEventsPart<SchemaVersion>): ResearchPartInventoryV1['orderSpan'] {
  const first = part.events[0];
  if (!first || first.orderAt === null) return null;
  return [first.orderAt, part.events[part.events.length - 1].orderAt];
}

async function download(name: string, bytes: Uint8Array<ArrayBuffer>, mediaType: string): Promise<ResearchDownload> {
  return {
    name, bytes, mediaType, sha256: await sha256(bytes),
    estimatedTokens: mediaType === 'application/zip' ? null : tokenEstimate(bytes.length),
  };
}

/** Browser-ready file. Calling this does not start a download or transfer data. */
export function toResearchDownloadFile(download: ResearchDownload): File {
  return new File([download.bytes], download.name, { type: download.mediaType, lastModified: 0 });
}

/** Local-only export of the exact evaluated session. No event calculation or search is started here. */
export async function buildResearchPackage(
  session: ResearchSession, activeNatalChart: Chart, options: ResearchExportOptions,
): Promise<ResearchPackage> {
  const mode = knownValue(['focused', 'complete', 'research-package'], options.mode);
  const { research, events, budget, format } = projectResearchPackage(session, activeNatalChart, options, mode);
  return packageFiles(1, research, events, format, budget, mode === 'research-package');
}

export async function buildPersonalizedResearchPackage(
  selection: ResearchSelection, activeNatalChart: Chart, options: PersonalizedResearchExportOptions,
): Promise<PersonalizedResearchPackage> {
  const scope = knownValue(['current', 'relevant', 'complete'], options.scope);
  const includeLinked = options.includeLinked ?? false;
  const chosen = preparePersonalizedSelection(selection, scope, includeLinked);
  const mode = scope === 'relevant' ? 'focused' : 'complete';
  const { research, project, base, budget, format } = projectResearchPackage(selection.session, activeNatalChart, {
    ...options, privacy: { ...options.privacy, eventDates: options.privacy?.eventDates ?? 'relative' },
  }, mode, chosen.ids);
  const { events, personalized } = projectPersonalizedResearch(selection, scope, includeLinked, chosen, base, project);
  const personalizedResearch: ResearchSharedV2 = {
    ...research, personalized,
    ai: { contextNote: research.ai.contextNote, instructions: [
      ...AI_RESEARCH_INSTRUCTIONS,
      'Use the manifest overview to anchor analysis. Treat its highlights as a subset of the evidence. Cite selected event and cycle IDs from the numbered parts.',
      IMPACT_CONVENTION,
      'Add the four observed component values and round once. The maxima are 40 for natal connection, 25 for planetary cycle, 20 for precision and 15 for contact type. Duration and repeated passes add no points.',
      'Keep Theme Relevance separate from Personal Impact. Interpret overlapping transits using only the evidence included in this export.',
    ] },
  };
  return packageFiles(2, personalizedResearch, events, format, budget, true);
}

function projectResearchPackage(
  session: ResearchSession, activeNatalChart: Chart, options: Omit<ResearchExportOptions, 'mode'>,
  mode: ResearchExportMode, selectedIds?: ReadonlySet<string>,
) {
  if (activeNatalChart.kind !== 'natal' || !isSessionCompatibleWithChart(session, activeNatalChart)) {
    throw new Error('The natal chart no longer matches this research session.');
  }
  const format = knownValue(['json', 'markdown'], options.format ?? 'json');
  const privacy = resolveExportPrivacy(options.privacy);
  const budget = options.partByteBudget === undefined ? DEFAULT_RESEARCH_PART_BYTES : options.partByteBudget;
  if (budget !== null && (!Number.isSafeInteger(budget) || budget < 1)) throw new RangeError('Invalid research part byte budget.');
  if (session.rawResult.settings.startTt !== session.rangeRequest.startTt ||
      session.rawResult.settings.endTt !== session.rangeRequest.endTt) {
    throw new Error('The calculation interval does not match the bound research request.');
  }

  const project = projectMoments(privacy, session.rawResult.settings.startTt);
  const aliases = themeAliases(session);
  const base = selectResearchEvents(session, mode, project, aliases, selectedIds);
  const { events, scope } = base;
  const context = exportChartContext(activeNatalChart, session, privacy, project, options.interpretations);
  const research: ResearchSharedV1 = {
    exportMode: mode, privacy, privacyNotices: privacyNotices(privacy),
    query: exportQuery(session, privacy, aliases), themes: exportThemes(session, aliases), scope,
    calculation: exportCalculation(session.rawResult, project, privacy.eventDates, context.snapshot.engine),
    snapshot: context.snapshot,
    chartFactors: exportChartFactors(session.chartFactors, session, mode === 'focused', context.sensitivityNotes),
    natalSynthesis: context.synthesisStatus, selectedMomentTransit: context.selectedMomentTransit,
    ai: { contextNote: AI_CONTEXT_NOTE, instructions: AI_RESEARCH_INSTRUCTIONS },
  };

  return { research, base, project, events, budget, format };
}

async function packageFiles<V extends SchemaVersion>(
  version: V, research: ResearchFor<V>, events: readonly EventFor<V>[], format: ResearchExportFormat,
  budget: number | null, forceManifest: boolean,
): Promise<VersionedResearchPackage<V>> {
  const { privacy } = research;
  const header = exportHeader(format, await contentId(research, events), version);
  const ext = filenameExt(format);
  const mime = textType(format);
  const lines = events.map(json);
  let document: VersionedResearchPackage<V>['document'];
  let files: ResearchDownload[];
  const standalone: ResearchExportDocument<V> = { schema: STANDALONE_SCHEMA, ...header, research, events };
  const singleBytes = forceManifest ? null : encoder.encode(renderArtifact(standalone, lines));
  if (singleBytes && (budget === null || singleBytes.length <= budget)) {
    document = standalone;
    files = [await download(`research-export.${ext}`, singleBytes, mime)];
  } else {
    const ranges = partitionEvents(header, privacy, events, lines, budget);
    const generated = await Promise.all(ranges.map(async ([from, to], index) => {
      const number = index + 1;
      const part = makePart(header, privacy, events, from, to, number, ranges.length);
      const filename = partFileName(number, ranges.length, format);
      const bytes = encoder.encode(renderArtifact(part, lines.slice(from, to)));
      const file = await download(filename, bytes, mime);
      const entry: ResearchPartInventoryV1 = {
        partNumber: number, totalParts: ranges.length, filename, eventCount: part.eventCount,
        eventIndexRange: part.eventIndexRange, orderSpan: orderSpan(part), bytes: bytes.length,
        estimatedTokens: tokenEstimate(bytes.length), exceedsPartBudget: budget !== null && bytes.length > budget, sha256: file.sha256,
      };
      return { file, entry };
    }));
    document = {
      schema: MANIFEST_SCHEMA, ...header, research, partByteBudget: budget, parts: generated.map(item => item.entry),
    };
    files = [
      await download(`00-manifest.${ext}`, encoder.encode(renderArtifact(document)), mime),
      ...generated.map(item => item.file),
    ];
  }
  const zip = await download('divine-orchestration-research.zip', createStoreZip(files), 'application/zip');
  return { document, files, zip, estimatedTokens: files.reduce((sum, file) => sum + (file.estimatedTokens ?? 0), 0) };
}

function assertValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid research package. ${message}`);
}

function parseArtifact(file: ArchiveFile): Artifact {
  const text = decoder.decode(file.bytes);
  const markdown = file.name.endsWith('.md');
  const fence = /\n\x60\x60\x60json\n([\s\S]*)\n\x60\x60\x60\n$/.exec(text);
  assertValid(!markdown || fence, 'Missing Markdown research data.');
  const artifact = JSON.parse(markdown ? fence![1] : text) as Artifact;
  assertValid(artifact && typeof artifact === 'object' && (artifact.schemaVersion === 1 || artifact.schemaVersion === 2) &&
    /^research-[0-9a-f]{64}$/.test(artifact.packageId) &&
    artifact.format === (markdown ? 'markdown' : 'json'), 'Unsupported artifact header.');
  return artifact;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validateEvents(research: ResearchSharedV1, events: readonly ResearchExportEventV1[], omittedBySelection = 0): void {
  const { counts, includesBroaderContext, moon, transitingBodies } = research.scope;
  assertValid(research.scope.completeForSelectedScope === true &&
    counts.calculated === counts.presented + counts.axisDuplicatesMerged + counts.outsideCalculatedBodyScope &&
    counts.presented === counts.exported.total + counts.outsideExportComputationScope + counts.omittedBroaderContext + omittedBySelection &&
    json(countExportEvents(events)) === json(counts.exported), 'Event accounting does not reconcile.');
  assertValid(includesBroaderContext ? counts.omittedBroaderContext === 0 : counts.exported.byTier.context === 0,
    'Broader context does not match the declared scope.');
  assertValid(moon.included === transitingBodies.includes('moon') && (!moon.included || (moon.requested && moon.calculated)),
    'Moon coverage does not match the declared scope.');
  const ids = new Set<string>();
  const addId = (id: string) => {
    assertValid(/^event-[1-9]\d*$/.test(id) && !ids.has(id), 'Missing or duplicate event identity.');
    ids.add(id);
  };
  let last = -Infinity;
  for (const { id, facts, axisCompanions, orderAt } of events) {
    addId(id);
    assertValid(facts.id === id, 'Event fact identity differs from its record.');
    const body = 'planetId' in facts ? facts.planetId : facts.transitPlanetId;
    assertValid(transitingBodies.includes(body), 'An event is outside the declared planet scope.');
    for (const companion of axisCompanions) {
      assertValid(facts.kind === 'angle-aspect-window' && companion.kind === 'angle-aspect-window' &&
        companion.transitPlanetId === body, 'Axis companion does not match its contact.');
      addId(companion.id);
    }
    if (research.privacy.eventDates === 'omit') {
      assertValid(orderAt === null, 'Omitted event dates still appear in the ordering field.');
    } else {
      const order = orderAt === null ? null : 'offsetTtDays' in orderAt ? orderAt.offsetTtDays : orderAt.jdTt;
      assertValid(order !== null && Number.isFinite(order) && order >= last, 'Events are out of chronological order.');
      last = order;
    }
  }
}

function validatePersonalized(
  data: PersonalizedResearchV2, events: readonly ResearchExportEventV1[], dates: ResearchExportPrivacy['eventDates'],
) {
  const { selection, overview } = data;
  const { counts } = selection;
  const { filters } = selection;
  const scored = events.filter((event): event is ResearchExportEventV2 =>
    'personalImpact' in event && 'cycleId' in event && 'selection' in event);
  const byId = new Map(scored.map(event => [event.id, event]));
  const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
  assertValid(data.modelVersion === 'impact-v1' && data.convention === IMPACT_CONVENTION && scored.length === events.length &&
    ['current', 'relevant', 'complete'].includes(selection.scope) &&
    [null, 10, 20, 50].includes(filters.top) &&
    (filters.minimumImpact === null || integer(filters.minimumImpact) && filters.minimumImpact <= 100),
  'Personalized research metadata is incomplete.');
  assertValid(Object.values(counts).every(integer) && counts.exported === events.length &&
    counts.complete === counts.exported + counts.excludedFromComplete && counts.relevant <= counts.complete &&
    counts.current + counts.linked <= counts.complete && counts.primary + counts.linkedIncluded === counts.exported &&
    counts.distinctCycles === new Set(scored.map(event => event.cycleId)).size, 'Personalized counts do not reconcile.');

  const ranks = new Set<number>();
  const primaryCycles = new Set<string>();
  let linkedCount = 0;
  for (const event of scored) {
    const { personalImpact: impact, selection: evidence } = event;
    const values = Object.values(impact.components);
    const limits = [impact.components.natalConnection, impact.components.planetaryCycle, impact.components.precision, impact.components.contactType];
    assertValid(/^cycle-[1-9]\d*$/.test(event.cycleId) && impact.modelVersion === data.modelVersion &&
      values.length === 4 && limits.every((item, i) => item.points >= 0 && item.points <= item.possiblePoints &&
        item.possiblePoints <= [40, 25, 20, 15][i]) &&
      impact.total === Math.round(values.reduce((sum, item) => sum + item.points, 0)) &&
      impact.possibleUpperBound === Math.round(values.reduce((sum, item) => sum + item.possiblePoints, 0)) &&
      impact.band === (impact.total >= 80 ? 'high' : impact.total >= 65 ? 'notable' : 'background'),
    'Impact scoring does not reconcile.');
    const windows = [event.facts, ...event.axisCompanions].filter(fact => 'series' in fact);
    assertValid(impact.evidence.windows.length === windows.length &&
      new Set(impact.evidence.windows.map(window => window.eventId)).size === windows.length &&
      impact.evidence.windows.every(window => {
        const facts = windows.find(fact => fact.id === window.eventId);
        return facts && facts.series.id === window.seriesId &&
          window.exactPassCountInWindow === facts.passes.filter(pass => pass.state !== 'near-miss').length &&
          window.exactPassCountInSeries === facts.series.exactPassCountInRange && window.seriesComplete === facts.series.complete;
      }), 'Impact window or series references differ from the exported evidence.');
    const best = impact.evidence.bestPass;
    if (best) assertValid(integer(best.passIndex) && best.passIndex > 0 &&
      windows.some(window => window.id === best.eventId && best.passIndex <= window.passes.length),
    'Impact pass reference is missing from the evidence.');
    if (selection.scope !== 'current') {
      assertValid(evidence.role === 'scope' && evidence.displayRank === null && evidence.representativeId === null,
        'Unexpected current-view groups in a scope export.');
    } else {
      const body = 'planetId' in event.facts ? event.facts.planetId : event.facts.transitPlanetId;
      assertValid((filters.minimumImpact === null || impact.total >= filters.minimumImpact) &&
        (filters.showMoon || body !== 'moon') && (filters.category !== 'station' || event.facts.kind === 'station') &&
        (!filters.matchTheme || event.relevance.matchedThemeIds.length >= 1) &&
        (!filters.multiThemeOnly || event.relevance.matchedThemeIds.length >= 2),
      'An event falls outside the frozen display filters.');
      const rank = evidence.displayRank;
      assertValid(rank !== null && integer(rank) && rank > 0 && rank <= counts.primary, 'An event has no valid display rank.');
      if (evidence.role === 'primary') {
        assertValid(evidence.representativeId === event.id && !ranks.has(rank), 'Duplicate or invalid ranking slot.');
        ranks.add(rank);
        primaryCycles.add(event.cycleId);
      } else {
        const representative = byId.get(evidence.representativeId ?? '');
        assertValid(evidence.role === 'linked' && representative?.selection.role === 'primary' &&
          representative.selection.displayRank === rank && representative.cycleId === event.cycleId,
        'Linked evidence has no matching selected representative.');
        linkedCount += 1;
      }
    }
  }
  if (selection.scope === 'current') {
    const omitted = selection.currentExclusions;
    assertValid(omitted && Object.values(omitted).every(integer) &&
      Object.values(omitted).reduce((sum, count) => sum + count, 0) === counts.excludedFromComplete &&
      counts.primary === counts.current && ranks.size === counts.primary && linkedCount === counts.linkedIncluded &&
      counts.linkedIncluded === (selection.linkedEvidenceIncluded ? counts.linked : 0) &&
      omitted.linkedEvidence === counts.linked - counts.linkedIncluded &&
      (selection.filters.top === null ? counts.linked === 0 : primaryCycles.size === counts.primary && counts.primary <= selection.filters.top),
    'Current results or linked evidence counts do not reconcile.');
  } else {
    assertValid(selection.currentExclusions === null && !selection.linkedEvidenceIncluded && counts.linkedIncluded === 0 &&
      counts.exported === counts[selection.scope], 'The exported findings do not match the selected scope.');
  }
  const timestamp = (moment: ResearchExportMoment) => dates === 'omit' ? moment === null : dates === 'relative'
    ? moment !== null && 'offsetTtDays' in moment && Number.isFinite(moment.offsetTtDays)
    : moment !== null && 'jdTt' in moment && Number.isFinite(moment.jdTt);
  const ordered = [...scored].sort((a, b) => b.personalImpact.total - a.personalImpact.total);
  assertValid(overview.strongestLimit === 5 && overview.strongest.length === Math.min(overview.strongestLimit, scored.length) &&
    overview.strongest.every((item, i) => item.eventId === ordered[i].id && item.personalImpact === ordered[i].personalImpact.total &&
      item.themeRelevance === ordered[i].relevance.score) &&
    overview.limitedImpactEvidence === scored.filter(item => item.personalImpact.missingData.length > 0).length,
  'Overview findings do not match the evidence.');
  const overlaps = overview.overlaps;
  assertValid(overlaps.highlightLimit === 3 && overlaps.eventRefsPerHighlight === 12 && overlaps.markerRefsPerHighlight === 3 &&
    integer(overlaps.totalPeriods) && integer(overlaps.omittedWindows) &&
    Number.isFinite(overlaps.minimumImpact) && overlaps.minimumImpact >= 0 && overlaps.minimumImpact <= 100 &&
    overlaps.highlights.length === Math.min(overlaps.highlightLimit, overlaps.totalPeriods) &&
    overlaps.highlights.every((period, i) => integer(period.periodNumber) && period.periodNumber > 0 &&
      period.periodNumber <= overlaps.totalPeriods && (i === 0 || period.periodNumber > overlaps.highlights[i - 1].periodNumber) &&
      timestamp(period.start) && timestamp(period.end) && timestamp(period.peak.start) && timestamp(period.peak.end) &&
      period.observedDays > 0 && period.peakConcurrentBodies >= 2 &&
      period.peak.bodies.length === period.peakConcurrentBodies && period.bodies.every(body => body !== 'moon') &&
      period.eventIds.length === Math.min(period.contactCount, overlaps.eventRefsPerHighlight) &&
      new Set(period.eventIds).size === period.eventIds.length &&
      period.eventIds.every(id => byId.has(id) && byId.get(id)!.personalImpact.total >= overlaps.minimumImpact) &&
      period.markers.length === Math.min(period.markerCount, overlaps.markerRefsPerHighlight) &&
      period.markers.every(marker => byId.has(marker.eventId) && timestamp(marker.at))),
  'Overview overlap evidence or date policy does not reconcile.');
}

/**
 * Verify the exact exported files, reconstruct the chronology and optionally verify the STORE ZIP.
 * The hashes detect inconsistency or corruption. They do not authenticate whoever supplied the files.
 */
export async function validateResearchPackage(
  files: readonly ArchiveFile[], zip?: Uint8Array,
): Promise<{ readonly document: VersionedResearchPackage<SchemaVersion>['document']; readonly events: readonly EventFor<SchemaVersion>[] }> {
  const byName = new Map(files.map(file => [file.name, file]));
  assertValid(files.length > 0 && byName.size === files.length, 'Missing files or duplicate file names.');
  const roots = files.filter(file => /^(00-manifest|research-export)\.(json|md)$/.test(file.name));
  assertValid(roots.length === 1, 'Expected one manifest or standalone export.');
  const root = roots[0];
  const document = parseArtifact(root);
  const events: ResearchExportEventV1[] = [];
  const orderedFiles = [root];
  if (document.schema === STANDALONE_SCHEMA) {
    assertValid(document.schemaVersion === 1 && files.length === 1 && root.name.startsWith('research-export.'), 'Unexpected files for a standalone export.');
    for (const event of document.events) events.push(event);
  } else {
    assertValid(document.schema === MANIFEST_SCHEMA && root.name.startsWith('00-manifest.'), 'Expected a research manifest.');
    const { parts, partByteBudget } = document;
    assertValid(parts.length > 0 && files.length === parts.length + 1, 'File count differs from the manifest.');
    assertValid(partByteBudget === null || (Number.isSafeInteger(partByteBudget) && partByteBudget > 0), 'Invalid part budget.');
    for (const [index, entry] of parts.entries()) {
      const number = index + 1;
      const name = partFileName(number, parts.length, document.format);
      const file = byName.get(name);
      assertValid(entry.filename === name && file, 'Missing or misnumbered event file.');
      assertValid(file.bytes.length === entry.bytes && await sha256(new Uint8Array(file.bytes)) === entry.sha256,
        `File checksum or byte count differs for part ${number}.`);
      assertValid(entry.estimatedTokens === tokenEstimate(entry.bytes) &&
        entry.exceedsPartBudget === (partByteBudget !== null && entry.bytes > partByteBudget),
      'Part size metadata does not reconcile.');
      const part = parseArtifact(file);
      assertValid(part.schema === PART_SCHEMA && part.schemaVersion === document.schemaVersion && part.packageId === document.packageId &&
        part.partNumber === number && part.totalParts === parts.length && part.format === document.format &&
        json(part.privacy) === json(document.research.privacy) && part.instruction === partInstruction(number, parts.length),
      'Part header does not match the manifest.');
      const count = part.events.length;
      const range = count ? [events.length + 1, events.length + count] : null;
      assertValid(entry.partNumber === number && entry.totalParts === parts.length && entry.eventCount === count &&
        part.eventCount === count && part.totalEvents === document.research.scope.counts.exported.total &&
        json(part.eventIndexRange) === json(range) && json(entry.eventIndexRange) === json(range) &&
        json(entry.orderSpan) === json(orderSpan(part)) &&
        (count > 0 || (parts.length === 1 && part.totalEvents === 0)) &&
        (!entry.exceedsPartBudget || count <= 1), 'Part events, indexes or chronological span do not reconcile.');
      for (const event of part.events) events.push(event);
      orderedFiles.push(file);
    }
  }
  const personalized = 'personalized' in document.research ? document.research.personalized : null;
  assertValid((document.schemaVersion === 2) === Boolean(personalized), 'Personalized metadata does not match the schema version.');
  const selectionOmitted = personalized?.selection.scope === 'current' ? personalized.selection.counts.excludedFromComplete : 0;
  validateEvents(document.research, events, selectionOmitted);
  if (personalized) validatePersonalized(personalized, events, document.research.privacy.eventDates);
  assertValid(await contentId(document.research, events) === document.packageId, 'The research data fingerprint differs.');
  assertValid(sameBytes(encoder.encode(renderArtifact(document)), root.bytes), 'The manifest or standalone bytes differ from the rendered data.');
  if (zip) assertValid(sameBytes(createStoreZip(orderedFiles), zip), 'ZIP contents or directory differ from the verified files.');
  return { document, events };
}
