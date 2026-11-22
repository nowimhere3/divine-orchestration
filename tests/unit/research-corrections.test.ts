import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Chart, PlanetId } from '../../src/domain/chart';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import type { EphemeraEngine } from '../../src/engine/ephemera';
import {
  buildRangeSearchRequest,
  canReuseSessionComputation,
  createCustomSearchQuery,
  createEverythingQuery,
  createLifeThemesQuery,
  createResearchSession,
  mergeAxisContacts,
  prepareExportHandoff,
  reEvaluateResearchSession,
  resolveChartFactors,
  resolveResearchFocus,
  retimeRangeResult,
} from '../../src/research';
import type { ResearchQuery } from '../../src/research';
import type { AngleAspectWindowEvent, EventRangeSearchRequest, RangeEvent } from '../../src/search/range';
import { searchEventRange } from '../../src/search/range';
import { resolveBirthTime } from '../../src/time/resolve';
import { calculateNatal } from '../../src/view/chart-data';

let engine: EphemeraEngine;
let chart: Chart;

const utcTt = (date: string) => {
  const res = resolveBirthTime({ date, time: '00:00', offsetOverride: '+00:00' }, engine.modelDeltaTSeconds);
  if (res.kind !== 'resolved') throw new Error(`Could not resolve ${date}`);
  return res.jdTt;
};

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  engine = await createEphemeraEngine(await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm')));
  const born = resolveBirthTime({ date: '1987-03-14', time: '07:25', timeZone: 'America/Edmonton' }, engine.modelDeltaTSeconds);
  if (born.kind !== 'resolved') throw new Error('Expected resolved birth time.');
  chart = calculateNatal(engine, born, { latitudeDeg: 51.0447, longitudeDeg: -114.0719 }, 'Placidus');
});

const START = '2026-01-01';
const END = '2026-03-01';

function run(query: ResearchQuery, referenceDate: string | null = START) {
  const startTt = utcTt(query.range.startDate);
  const endTt = utcTt(query.range.endDate);
  const referenceTt = referenceDate === null ? null : utcTt(referenceDate);
  const factors = resolveChartFactors(chart, { rulershipPolicy: query.focus.rulershipPolicy });
  const focus = resolveResearchFocus(query, factors);
  const request: EventRangeSearchRequest = buildRangeSearchRequest(query, chart, focus, { startTt, endTt, referenceTt });
  const raw = searchEventRange(engine, request);
  const session = createResearchSession({ chart, query, rangeRequest: request, rawResult: raw });
  return { startTt, endTt, referenceTt, request, raw, session };
}

const bodyOf = (event: RangeEvent): PlanetId =>
  event.kind === 'station' || event.kind === 'house-ingress' ? event.planet.planetId : event.transit.planetId;
const angleEvents = (events: readonly RangeEvent[]) =>
  events.filter((e): e is AngleAspectWindowEvent => e.kind === 'angle-aspect-window');
const firstTt = (e: AngleAspectWindowEvent) => e.passes[0]?.at.jdTt ?? e.startsAt?.jdTt ?? e.endsAt?.jdTt ?? NaN;

describe('B2: one physical axis contact is presented once', () => {
  const moonQuery = createEverythingQuery({ startDate: START, endDate: END });

  test('with Moon included every angle is solved directly, yet no contact is listed twice', () => {
    const { raw, session, request } = run(moonQuery);
    expect(request.includeAngles).toEqual(['asc', 'mc', 'dsc', 'ic']);
    const calculatedAngle = angleEvents(raw.events);
    expect(calculatedAngle.some(e => e.targetAngle === 'dsc')).toBe(true);

    const presented = angleEvents(session.evaluated.all.map(item => item.event));
    // Counts reconcile exactly: nothing disappears without being accounted for.
    expect(session.evaluated.counts.calculatedEvents).toBe(raw.events.length);
    expect(session.evaluated.counts.axisDuplicatesMerged).toBeGreaterThan(0);
    expect(session.evaluated.counts.total + session.evaluated.counts.axisDuplicatesMerged).toBe(raw.events.length);
    expect(presented.length + session.evaluated.counts.axisDuplicatesMerged).toBe(calculatedAngle.length);

    // No two presented angle windows describe the same body, axis and exact moment.
    const seen = new Set<string>();
    for (const event of presented) {
      const axis = event.targetAngle === 'asc' || event.targetAngle === 'dsc' ? 'asc' : 'mc';
      const key = `${event.transit.planetId}|${axis}|${Math.round(firstTt(event) * 2880)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('equal-orb opposites (conjunction/opposition, square) keep both aspect labels on one event', () => {
    const { session } = run(moonQuery);
    const withCompanions = session.evaluated.all.filter(item => item.axisCompanions.length > 0);
    expect(withCompanions.length).toBeGreaterThan(0);
    const dualOf: Record<string, string> = { conjunction: 'opposition', opposition: 'conjunction', sextile: 'trine', trine: 'sextile', square: 'square' };
    const opposite: Record<string, string> = { asc: 'dsc', dsc: 'asc', mc: 'ic', ic: 'mc' };
    for (const item of withCompanions) {
      const event = item.event as AngleAspectWindowEvent;
      for (const companion of item.axisCompanions) {
        expect(companion.angle).toBe(opposite[event.targetAngle]);
        expect(companion.aspect).toBe(dualOf[event.aspect]);
      }
    }
    const equal = withCompanions.filter(item => item.axisCompanions.every(c => c.allowedOrbDeg === (item.event as AngleAspectWindowEvent).allowedOrbDeg));
    expect(equal.length).toBeGreaterThan(0);
    // The explanation mentions both ends of the axis.
    expect(equal.some(item => item.relevance.matchedAngles.length === 2)).toBe(true);
  });

  test('asymmetric Moon sextile/trine orbs keep the wider window and the narrower window boundaries', () => {
    const { raw, session } = run(moonQuery);
    const unequal = session.evaluated.all.filter(item =>
      item.axisCompanions.some(c => c.allowedOrbDeg !== (item.event as AngleAspectWindowEvent).allowedOrbDeg));
    expect(unequal.length).toBeGreaterThan(0);
    const rawById = new Map(angleEvents(raw.events).map(e => [e.id, e] as const));
    for (const item of unequal) {
      const host = item.event as AngleAspectWindowEvent;
      expect(host.transit.planetId).toBe('moon');
      for (const companion of item.axisCompanions) {
        // The host is the wider window (5° trine / 4° sextile pairs) and fully contains the narrower one.
        expect(host.allowedOrbDeg).toBeGreaterThan(companion.allowedOrbDeg);
        const original = rawById.get(companion.eventId)!;
        expect(original).toBeDefined();
        // The companion keeps exactly its own calculated boundaries: nothing was resized or discarded.
        expect(companion.startsAt).toBe(original.startsAt);
        expect(companion.endsAt).toBe(original.endsAt);
        expect(companion.allowedOrbDeg).toBe(original.allowedOrbDeg);
        const hostStart = host.clippedStart ? -Infinity : host.startsAt!.jdTt!;
        const hostEnd = host.clippedEnd ? Infinity : host.endsAt!.jdTt!;
        const lo = companion.clippedStart ? -Infinity : companion.startsAt!.jdTt!;
        const hi = companion.clippedEnd ? Infinity : companion.endsAt!.jdTt!;
        expect(lo).toBeGreaterThanOrEqual(hostStart - 1e-3);
        expect(hi).toBeLessThanOrEqual(hostEnd + 1e-3);
      }
      // The explanation names each end's own orb when the allowances differ.
      expect(item.relevance.whyRelevant).toMatch(/orb windows differ/);
    }
  });

  test('a Moon-off search keeps solving ASC/MC only and projecting, with nothing merged', () => {
    const { request, session, raw } = run(createEverythingQuery({ startDate: START, endDate: END, includeMoon: false }));
    expect(request.includeAngles).toEqual(['asc', 'mc']);
    expect(session.evaluated.counts.axisDuplicatesMerged).toBe(0);
    expect(session.evaluated.counts.total).toBe(raw.events.length);
  });

  test('themes with both axis ends active count each physical contact once and credit it to both ends', () => {
    const { raw, session } = run(createLifeThemesQuery({ startDate: START, endDate: END, includeHouses: [1, 7] }));
    const relevantAngle = session.evaluated.relevant.filter(item => item.event.kind === 'angle-aspect-window');
    const keys = relevantAngle.map(item => {
      const e = item.event as AngleAspectWindowEvent;
      return `${e.transit.planetId}|${e.targetAngle === 'asc' || e.targetAngle === 'dsc' ? 'asc' : 'mc'}|${Math.round(firstTt(e) * 2880)}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
    const physicalContacts = angleEvents(raw.events).length - session.evaluated.counts.axisDuplicatesMerged;
    expect(relevantAngle.length).toBeLessThanOrEqual(physicalContacts);
    const both = relevantAngle.filter(item => item.relevance.matchedAngles.includes('asc') && item.relevance.matchedAngles.includes('dsc'));
    expect(both.length).toBeGreaterThan(0);
    for (const item of both) {
      // +25 is awarded once for the physical axis contact, never twice.
      expect(item.relevance.reasons.filter(r => r.code === 'angle-axis-contact')).toHaveLength(1);
      expect(item.relevance.rawScore).toBe(item.relevance.reasons.reduce((sum, r) => sum + r.points, 0));
    }
  });

  test('presents the contact through the ends the query asks about', () => {
    // Excluding DSC leaves the ASC end as the only eligible one, with no DSC label attached.
    const noDsc = run(createCustomSearchQuery({ startDate: START, endDate: END, excludeFocusAngles: ['dsc'] }));
    const ascHosts = noDsc.session.evaluated.all.filter(item => item.event.kind === 'angle-aspect-window' && item.event.targetAngle === 'asc');
    expect(ascHosts.length).toBeGreaterThan(0);
    expect(noDsc.session.evaluated.all.every(item => item.axisCompanions.every(c => c.angle !== 'dsc'))).toBe(true);
    expect(noDsc.session.evaluated.all.every(item => !item.relevance.matchedAngles.includes('dsc'))).toBe(true);

    // Only DSC wanted: the DSC end is presented (with its own orb) even when ASC is the wider window.
    const onlyDsc = run(createCustomSearchQuery({ startDate: START, endDate: END, includeFocusAngles: ['dsc'], includeAspects: ['sextile', 'trine'] }));
    const relevantAngles = onlyDsc.session.evaluated.relevant.filter(item => item.event.kind === 'angle-aspect-window');
    expect(relevantAngles.length).toBeGreaterThan(0);
    for (const item of relevantAngles) {
      expect(item.relevance.matchedAngles).toContain('dsc');
      expect((item.event as AngleAspectWindowEvent).targetAngle).toBe('dsc');
    }
  });

  test('mergeAxisContacts leaves a window with no containing partner untouched', () => {
    const { raw } = run(moonQuery);
    const dscOnly = raw.events.filter(e => !(e.kind === 'angle-aspect-window' && (e.targetAngle === 'asc' || e.targetAngle === 'mc')));
    const merged = mergeAxisContacts(dscOnly);
    expect(merged.merged).toBe(0);
    expect(merged.presented).toHaveLength(dscOnly.length);
  });

  test('the export handoff counts presented events and reports the calculated total separately', () => {
    const { raw, session } = run(moonQuery);
    const handoff = prepareExportHandoff(session, chart);
    expect(handoff.totalEvents).toBe(session.evaluated.counts.total);
    expect(handoff.calculatedEvents).toBe(raw.events.length);
    expect(handoff.totalEvents).toBeLessThan(handoff.calculatedEvents);
    // Nothing is exported twice: every presented id is unique.
    const ids = handoff.evaluated.all.map(item => item.event.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('B3: Moon excluded from the query is excluded from results and counts, even from a reused superset', () => {
  test('unticking Moon reuses the calculation but hides every Moon event and its counts', () => {
    const withMoon = run(createEverythingQuery({ startDate: START, endDate: END }));
    const moonRaw = withMoon.raw.events.filter(e => bodyOf(e) === 'moon').length;
    expect(moonRaw).toBeGreaterThan(0);
    expect(withMoon.session.evaluated.counts.moonCount).toBeGreaterThan(0);

    const noMoonQuery = createEverythingQuery({ startDate: START, endDate: END, includeMoon: false });
    const range = { startTt: withMoon.startTt, endTt: withMoon.endTt, referenceTt: withMoon.referenceTt, transitChartId: 'transit' };
    expect(canReuseSessionComputation(withMoon.session, noMoonQuery, chart, range)).toBe(true);
    const reused = reEvaluateResearchSession(withMoon.session, noMoonQuery, chart);
    expect(reused.rawResult).toBe(withMoon.session.rawResult);
    expect(reused.evaluated.all.every(item => bodyOf(item.event) !== 'moon')).toBe(true);
    expect(reused.evaluated.counts.moonCount).toBe(0);
    expect(reused.evaluated.counts.byBody.moon).toBeUndefined();
    expect(reused.evaluated.broaderContext.every(item => bodyOf(item.event) !== 'moon')).toBe(true);
    expect(reused.evaluated.counts.outsideQueryScope).toBe(moonRaw);
    expect(reused.evaluated.counts.calculatedEvents).toBe(withMoon.raw.events.length);

    // The reused numbers equal a fresh Moon-off search: same events, same count.
    const fresh = run(noMoonQuery);
    expect(reused.evaluated.counts.total).toBe(fresh.session.evaluated.counts.total);
    expect(reused.evaluated.counts.byKind).toEqual(fresh.session.evaluated.counts.byKind);
  });

  test('adding the Moon back needs a new calculation', () => {
    const noMoon = run(createEverythingQuery({ startDate: START, endDate: END, includeMoon: false }));
    const moonQuery = createEverythingQuery({ startDate: START, endDate: END });
    const range = { startTt: noMoon.startTt, endTt: noMoon.endTt, referenceTt: noMoon.referenceTt, transitChartId: 'transit' };
    expect(canReuseSessionComputation(noMoon.session, moonQuery, chart, range)).toBe(false);
  });

  test('the same holds for any deselected planet, in themes and custom modes', () => {
    const wide = run(createEverythingQuery({ startDate: START, endDate: END, includeMoon: false }));
    const mars = createLifeThemesQuery({ startDate: START, endDate: END, transitingBodies: ['mars'], activeThemeIds: ['finances'] });
    const reused = reEvaluateResearchSession(wide.session, mars, chart);
    expect(reused.evaluated.all.length).toBeGreaterThan(0);
    expect(reused.evaluated.all.every(item => bodyOf(item.event) === 'mars')).toBe(true);
    expect(reused.evaluated.counts.outsideQueryScope).toBeGreaterThan(0);
  });
});

describe('I1: a moved Time Machine re-times results without recalculation', () => {
  test('retimed events match a fresh search at the new reference for every kind, including clipped windows', () => {
    const query = createEverythingQuery({ startDate: START, endDate: '2026-04-01', includeMoon: false });
    const base = run(query, START);
    const references = ['2025-11-01', '2026-01-01', '2026-02-10', '2026-03-31', '2026-06-01'];
    for (const date of references) {
      const retimed = retimeRangeResult(base.raw, utcTt(date));
      const fresh = run(query, date).raw;
      expect(retimed.events).toHaveLength(fresh.events.length);
      retimed.events.forEach((event, index) => {
        expect(event.id).toBe(fresh.events[index].id);
        expect(event.timing).toBe(fresh.events[index].timing);
      });
      expect(retimed.settings.referenceTt).toBe(utcTt(date));
    }
    // A null reference makes every timing unknown, as in a fresh search.
    expect(retimeRangeResult(base.raw, null).events.every(e => e.timing === 'unknown')).toBe(true);
    // Nothing else changes: same windows, passes and ids; the source result is never mutated.
    expect(base.raw.settings.referenceTt).toBe(utcTt(START));
  });

  test('theme and house edits after a Time Machine jump reuse the calculation with accurate timing', () => {
    const first = run(createLifeThemesQuery({ startDate: START, endDate: END, includeMoon: false, activeThemeIds: ['finances'] }), START);
    const jumped = utcTt('2026-02-01');
    const edited = createLifeThemesQuery({ startDate: START, endDate: END, includeMoon: false, activeThemeIds: ['finances', 'entrepreneurship'] });
    const range = { startTt: first.startTt, endTt: first.endTt, referenceTt: jumped, transitChartId: 'transit' };
    expect(canReuseSessionComputation(first.session, edited, chart, range)).toBe(true);
    const next = reEvaluateResearchSession(first.session, edited, chart, undefined, jumped);
    expect(next.rawResult.events).toHaveLength(first.raw.events.length);
    expect(next.evaluated.counts.primary + next.evaluated.counts.secondary).toBeGreaterThan(first.session.evaluated.counts.primary + first.session.evaluated.counts.secondary);

    const fresh = run(edited, '2026-02-01');
    const timingById = new Map(fresh.raw.events.map(e => [e.id, e.timing] as const));
    for (const item of next.evaluated.all) expect(item.event.timing).toBe(timingById.get(item.event.id));
    expect(next.evaluated.all.some(item => item.event.timing === 'past')).toBe(true);
    expect(next.evaluated.all.some(item => item.event.timing === 'future')).toBe(true);
  });
});
