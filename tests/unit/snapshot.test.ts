import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, expect, test } from 'vitest';
import { aspectFactId, calculateAspects, createAspectRuleSet } from '../../src/domain/aspects';
import { createDateOnlyNatalChart } from '../../src/domain/chart';
import type { PlanetFact, TimedChart } from '../../src/domain/chart';
import type { EventMoment, SymbolicMeaning } from '../../src/domain/event';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import { createSnapshotV0, renderSnapshotMarkdown, serializeSnapshot } from '../../src/export/snapshot';
import * as snapshotApi from '../../src/export/snapshot';
import type { SnapshotInput } from '../../src/export/snapshot';
import { resolveBirthTime } from '../../src/time/resolve';

let input: SnapshotInput;
const privateId = 'private-2000-01-01';
const dateOnlyId = 'private-1991-04-15';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const engine = await createEphemeraEngine(await readFile(require.resolve('@astrologer/ephemera/wasm/ephemeris-1as.wasm')));
  const time = resolveBirthTime(
    { date: '2000-01-01', time: '11:58:55.816', timeZone: 'Europe/London' },
    engine.modelDeltaTSeconds,
  );
  if (time.kind !== 'resolved') throw new Error('Fixture time could not be resolved.');
  const result = engine.position('Sun', time);
  if (result.status !== 'ok') throw new Error('Fixture Sun position was unavailable.');
  const { longitude, latitude, distance, longitudeSpeed, latitudeSpeed, distanceSpeed, retrograde } = result.value;
  const sun: PlanetFact = {
    planetId: 'sun',
    position: {
      status: 'available',
      value: {
        longitudeDeg: longitude, latitudeDeg: latitude, distanceAu: distance,
        longitudeSpeedDegPerDay: longitudeSpeed, latitudeSpeedDegPerDay: latitudeSpeed,
        distanceSpeedAuPerDay: distanceSpeed, retrograde,
      },
    },
  };
  const chart: TimedChart = {
    id: privateId, label: 'Personal Birth Name <profile>', kind: 'natal', time,
    settings: {
      zodiac: 'tropical', requestedHouseSystem: 'Placidus',
      observer: { latitudeDeg: 51.5074, longitudeDeg: -0.1278 },
    },
    planets: {
      status: 'available',
      value: [sun, { planetId: 'moon', position: { status: 'unavailable', reason: 'calculation-unavailable' } }],
    },
    houses: { status: 'unavailable', reason: 'calculation-unavailable' },
    warnings: [],
  };
  const time2 = resolveBirthTime({ date: '1991-04-15', time: null }, engine.modelDeltaTSeconds);
  if (time2.kind !== 'unknown-time') throw new Error('Fixture date-only time was resolved unexpectedly.');
  const dateOnly = createDateOnlyNatalChart({ id: dateOnlyId, label: 'Date only', time: time2, settings: chart.settings });
  const transit: TimedChart = {
    ...chart, kind: 'transit', id: 'transit', label: null,
    planets: { status: 'available', value: [sun] },
  };
  const aspectRules = createAspectRuleSet({ conjunction: 3 });
  const aspects = calculateAspects([
    { chartId: chart.id, planetId: 'sun', longitudeDeg: longitude },
    { chartId: transit.id, planetId: 'sun', longitudeDeg: longitude + 2 },
  ], aspectRules);
  const selected: EventMoment = { utc: time.utc, jdUt: time.jdUt, jdTt: time.jdTt };
  input = {
    engine: result.engine, charts: [chart, dateOnly, transit], aspectRules, aspects,
    context: {
      selectedAt: selected, referenceAt: selected,
      eventSearch: {
        start: selected, end: selected,
        events: [{
          kind: 'aspect-window', timing: 'future', id: 'private-event-2000-01-01',
          transit: { chartId: transit.id, planetId: 'sun' }, target: { chartId: chart.id, planetId: 'sun' },
          aspect: 'conjunction', startsAt: null, endsAt: null, clippedStart: true, clippedEnd: true,
          allowedOrbDeg: 3, passes: [{ at: selected, state: 'near-miss', residualDeg: 0.1, toleranceDeg: null }],
        }],
      },
    },
  };
});

test('uses one versioned snapshot for canonical JSON and human-readable Markdown', () => {
  const snapshot = createSnapshotV0(input);
  const json = serializeSnapshot(snapshot);
  const parsed = JSON.parse(json);
  expect(parsed).toEqual(snapshot);
  expect(parsed).toMatchObject({ schemaVersion: 0, engine: { version: '0.4.1' }, interpretations: [] });
  expect(json).toBe(serializeSnapshot(createSnapshotV0({ ...input, engine: {
    frame: input.engine!.frame, dataMode: input.engine!.dataMode, name: input.engine!.name, version: input.engine!.version,
  } })));
  const markdown = renderSnapshotMarkdown(snapshot);
  expect(markdown).toBe(renderSnapshotMarkdown(parsed));
  expect(markdown).toContain('## Symbolic interpretations\n\n- None');
  expect(markdown).toContain('UTC — 2000-01-01T11:58:55.816Z');
  expect(markdown).toContain('Allowed orb deg — 3');
  expect(markdown).toContain('State — near-miss');
  expect(markdown).toContain('Reason — unknown-birth-time');
  expect(markdown).toContain('Reason — calculation-unavailable');
  expect(markdown).toContain('Personal Birth Name &lt;profile&gt;');
  const sun = parsed.charts[0].planets.value[0].position.value;
  expect(markdown).toContain(`Longitude deg — ${sun.longitudeDeg}`);
  expect(markdown).toContain(`Longitude speed deg per day — ${sun.longitudeSpeedDegPerDay}`);
});

test('redacts birth details, derived timestamps and IDs without breaking fact links', () => {
  const redacted = createSnapshotV0(input, { redactBirthDetails: true });
  const json = serializeSnapshot(redacted);
  const markdown = renderSnapshotMarkdown(redacted);
  for (const privateValue of [
    'Personal Birth Name', '2000-01-01', '1991-04-15', 'Europe/London', '51.5074', '-0.1278',
    '11:58:55.816', '2451545', privateId, dateOnlyId,
  ]) {
    expect(json).not.toContain(privateValue);
    expect(markdown).not.toContain(privateValue);
  }
  expect(redacted.charts[0]).toMatchObject({ id: 'chart-1', label: null, time: null, settings: { observer: null } });
  expect(redacted.aspects[0]).toMatchObject({ from: { chartId: 'chart-1' }, to: { chartId: 'chart-3' } });
  expect(redacted.context).toMatchObject({
    selectedAt: null,
    referenceAt: null,
    eventSearch: { events: [{ id: 'event-1', timing: 'future', target: { chartId: 'chart-1' } }] },
  });
  expect(redacted.charts[0].planets).toEqual(input.charts[0].planets);
});

test('supports an unsearched context and refuses non-finite calculation data', () => {
  const context = { selectedAt: null, referenceAt: null, eventSearch: null };
  expect(createSnapshotV0({ ...input, context }).context).toEqual(context);
  expect(() => createSnapshotV0({
    ...input, context: { ...context, selectedAt: { utc: null, jdUt: NaN, jdTt: null } },
  })).toThrow(/finite/);
});

test('caller-created seals cannot authorize private text, fabricated aspects or unknown themes', () => {
  const date = '1990-07-15';
  const profile = 'Fixture Profile';
  const resolved = resolveBirthTime({ date, time: '18:30', timeZone: 'America/Edmonton' }, () => 0);
  if (resolved.kind !== 'resolved') throw new Error('expected a resolved instant');
  const chart: TimedChart = {
    ...input.charts[0] as TimedChart,
    label: profile, time: resolved, id: 'natal',
    settings: { ...input.charts[0].settings, observer: { latitudeDeg: 51.0447, longitudeDeg: -114.0719 } },
  };
  const legacySeal = Reflect.get(snapshotApi, 'sealRedactionSafeMeaning') as ((meaning: SymbolicMeaning) => SymbolicMeaning) | undefined;
  const forge = legacySeal ?? Object.freeze;
  const privateValue = `${profile} ${date} 51.0447`;
  const ordinary = { description: 'Fixture notes for 15 July 1990.', tradition: 'Western tropical', ruleSetVersion: 'u5a-v1', sources: ['ptolemy'] };
  const forged = [
    forge({ ...ordinary, factId: 'natal/overview', ruleSetVersion: privateValue, sources: [privateValue] }),
    forge({ ...ordinary, factId: 'natal/theme/fixture-profile' }),
    forge({ ...ordinary, factId: JSON.stringify(['natal', 'sun', 'natal', 'sun', 'square']) }),
  ];
  const captured = { ...input, charts: [chart], aspects: [], context: { selectedAt: null, referenceAt: null, eventSearch: null }, interpretations: forged };
  const redacted = createSnapshotV0(captured, { redactBirthDetails: true });
  expect(redacted.interpretations).toEqual([]);
  for (const exported of [serializeSnapshot(redacted), renderSnapshotMarkdown(redacted)]) {
    for (const secret of [profile, date, '15 July 1990', '51.0447', 'fixture-profile']) expect(exported).not.toContain(secret);
  }
  expect(createSnapshotV0(captured).interpretations).toEqual(forged);
  const optIn = { redactBirthDetails: true, includeRedactedNatalSynthesis: true };
  const regenerated = createSnapshotV0(captured, optIn);
  expect(regenerated.interpretations.map(item => item.factId)).toContain('chart-1/sun');
  expect(regenerated).toEqual(createSnapshotV0({ ...captured, interpretations: [] }, optIn));
  expect(legacySeal).toBeUndefined();
});

test('only generates redacted aspect meanings for captured aspects that agree with chart geometry', () => {
  const base = input.charts[0] as TimedChart;
  if (base.planets.status !== 'available') throw new Error('expected available fixture planets');
  const original = base.planets.value[0].position;
  if (original.status !== 'available') throw new Error('expected available fixture Sun');
  const sun = original.value;
  const chart: TimedChart = {
    ...base,
    planets: { status: 'available', value: [
      { planetId: 'sun', position: { status: 'available', value: sun } },
      { planetId: 'moon', position: { status: 'available', value: { ...sun, longitudeDeg: sun.longitudeDeg + 1 } } },
      { planetId: 'venus', position: { status: 'available', value: { ...sun, longitudeDeg: sun.longitudeDeg + 2 } } },
    ] },
  };
  const aspectRules = input.aspectRules;
  const all = calculateAspects([
    { chartId: chart.id, planetId: 'sun', longitudeDeg: sun.longitudeDeg },
    { chartId: chart.id, planetId: 'moon', longitudeDeg: sun.longitudeDeg + 1 },
    { chartId: chart.id, planetId: 'venus', longitudeDeg: sun.longitudeDeg + 2 },
  ], aspectRules);
  const valid = all.find(fact => fact.from.planetId === 'moon' && fact.to.planetId === 'sun')!;
  const inaccurate = all.find(fact => fact.from.planetId === 'moon' && fact.to.planetId === 'venus')!;
  const self = { ...valid, id: aspectFactId(valid.to, valid.to, valid.aspect), from: valid.to };
  const redacted = createSnapshotV0({
    ...input, charts: [chart], aspects: [valid, { ...inaccurate, orbDeg: 2 }, self],
    context: { selectedAt: null, referenceAt: null, eventSearch: null },
  }, { redactBirthDetails: true, includeRedactedNatalSynthesis: true });

  expect(redacted.interpretations.filter(item => item.factId.startsWith('[')).map(item => item.factId)).toEqual([
    JSON.stringify(['chart-1', 'moon', 'chart-1', 'sun', 'conjunction']),
  ]);
});

test('redacted transit synthesis regenerates strictly from validated captured geometry and strips all PII and timestamps', () => {
  const natalBase = input.charts[0] as TimedChart;
  const transitBase = input.charts[2] as TimedChart;
  if (natalBase.planets.status !== 'available' || transitBase.planets.status !== 'available') {
    throw new Error('expected available fixture planets');
  }
  const sunPos = natalBase.planets.value[0].position;
  if (sunPos.status !== 'available') throw new Error('expected available fixture Sun');

  const natalChart: TimedChart = {
    ...natalBase,
    id: 'natal-secret-1990',
    label: 'Secret Transit User',
    settings: { ...natalBase.settings, observer: { latitudeDeg: 51.0447, longitudeDeg: -114.0719 } },
    planets: {
      status: 'available',
      value: [
        { planetId: 'sun', position: { status: 'available', value: sunPos.value } },
        { planetId: 'moon', position: { status: 'available', value: { ...sunPos.value, longitudeDeg: (sunPos.value.longitudeDeg + 90) % 360 } } },
      ],
    },
  };
  const transitChart: TimedChart = {
    ...transitBase,
    id: 'transit-2026-11-20',
    planets: {
      status: 'available',
      value: [
        { planetId: 'saturn', position: { status: 'available', value: { ...sunPos.value, longitudeDeg: (sunPos.value.longitudeDeg + 1.2) % 360, longitudeSpeedDegPerDay: 0.08, retrograde: false } } },
        { planetId: 'mars', position: { status: 'available', value: { ...sunPos.value, longitudeDeg: (sunPos.value.longitudeDeg + 90.5) % 360, longitudeSpeedDegPerDay: 0.5, retrograde: false } } },
      ],
    },
  };
  const computed = calculateAspects([
    { chartId: natalChart.id, planetId: 'sun', longitudeDeg: sunPos.value.longitudeDeg },
    { chartId: natalChart.id, planetId: 'moon', longitudeDeg: (sunPos.value.longitudeDeg + 90) % 360 },
    { chartId: transitChart.id, planetId: 'saturn', longitudeDeg: (sunPos.value.longitudeDeg + 1.2) % 360 },
    { chartId: transitChart.id, planetId: 'mars', longitudeDeg: (sunPos.value.longitudeDeg + 90.5) % 360 },
  ], input.aspectRules).filter(a => a.from.chartId !== a.to.chartId);

  const validSaturnSun = computed.find(a => a.from.planetId === 'sun' && a.to.planetId === 'saturn' || a.from.planetId === 'saturn' && a.to.planetId === 'sun')!;
  const forgedMarsSun = { ...validSaturnSun, id: aspectFactId({ chartId: natalChart.id, planetId: 'sun' }, { chartId: transitChart.id, planetId: 'mars' }, 'trine'), aspect: 'trine' as const, exactAngleDeg: 120, orbDeg: 0.1 };
  const callerPoison: SymbolicMeaning = {
    factId: 'transit-2026-11-20/transit-overview',
    tradition: 'Forged',
    ruleSetVersion: 'Secret Transit User 1990',
    description: 'Leaked 2026-11-20 America/Edmonton 51.0447 Secret Transit User',
    sources: ['Secret Transit User'],
  };

  const snapshotInput: SnapshotInput = {
    ...input,
    charts: [natalChart, transitChart],
    aspects: [validSaturnSun, forgedMarsSun],
    context: { selectedAt: null, referenceAt: null, eventSearch: null },
    interpretations: [callerPoison],
  };

  // Full export preserves caller-supplied interpretations
  expect(createSnapshotV0(snapshotInput).interpretations).toEqual([callerPoison]);

  // Redacted export without opt-in emits []
  expect(createSnapshotV0(snapshotInput, { redactBirthDetails: true }).interpretations).toEqual([]);

  // Redacted export with includeRedactedTransitSynthesis ignores callerPoison and rejects forgedMarsSun
  const redacted = createSnapshotV0(snapshotInput, {
    redactBirthDetails: true,
    includeRedactedTransitSynthesis: true,
  });
  const factIds = redacted.interpretations.map(i => i.factId);
  expect(factIds).toContain('chart-2/transit-overview');
  expect(factIds).toContain(JSON.stringify(['chart-1', 'sun', 'chart-2', 'saturn', 'conjunction']));
  expect(factIds).not.toContain(JSON.stringify(['chart-1', 'sun', 'chart-2', 'mars', 'trine']));
  expect(redacted).toEqual(createSnapshotV0({ ...snapshotInput, interpretations: [] }, {
    redactBirthDetails: true,
    includeRedactedTransitSynthesis: true,
  }));

  // Neither JSON nor Markdown leaks secrets, IDs, dates, timestamps or zones
  for (const text of [serializeSnapshot(redacted), renderSnapshotMarkdown(redacted)]) {
    for (const secret of [
      'Secret Transit User', 'natal-secret-1990', 'transit-2026-11-20', '2000-01-01',
      '2026-11-20', '11:58:55', '51.0447', '-114.0719', 'Europe/London', 'America/Edmonton', 'ABT', 'UTC',
    ]) {
      expect(text).not.toContain(secret);
    }
  }

  // Date-only redacted transit synthesis refuses spoofed/non-local engines
  const fakeEngine = {
    info: () => ({ name: 'Fake', version: '0', frame: 'tropical', dataMode: 'embedded' }),
    modelDeltaTSeconds: () => 0,
    position: () => ({ status: 'unavailable' as const, reason: 'spoofed' }),
    crossing: () => ({ status: 'unavailable' as const, reason: 'spoofed' }),
    houses: () => ({ status: 'unavailable' as const, reason: 'spoofed' }),
  } as unknown as Parameters<typeof createSnapshotV0>[1] extends { dateOnlyEngine?: infer E } ? E : never;

  const dateOnlyRedacted = createSnapshotV0({
    ...snapshotInput,
    charts: [input.charts[1], transitChart],
    aspects: [],
    interpretations: [callerPoison],
  }, {
    redactBirthDetails: true,
    includeRedactedTransitSynthesis: true,
    dateOnlyEngine: fakeEngine,
  });
  expect(dateOnlyRedacted.interpretations).toEqual([]);
});

test('redacted snapshots reject arbitrary invalid aspect, planet and event identifiers while preserving full exports', () => {
  const validAspect = input.aspects[0];
  const badAspectId = { ...validAspect, aspect: 'Zelda Secret' as unknown as typeof validAspect.aspect };
  const badPlanetId = {
    ...validAspect,
    from: { ...validAspect.from, planetId: 'chiron<script>' as unknown as typeof validAspect.from.planetId },
  };

  expect(() => createSnapshotV0({ ...input, aspects: [badAspectId] }, { redactBirthDetails: true }))
    .toThrow(/invalid aspect identifier/i);
  expect(() => createSnapshotV0({ ...input, aspects: [badPlanetId] }, { redactBirthDetails: true }))
    .toThrow(/invalid planet identifier/i);

  // Invalid planet identifier inside chart planets or eventSearch is also rejected in redacted mode
  const baseChart = input.charts[0] as TimedChart;
  if (baseChart.planets.status !== 'available') throw new Error('expected available planets');
  const badChart: TimedChart = {
    ...baseChart,
    planets: {
      status: 'available',
      value: [{ ...baseChart.planets.value[0], planetId: 'chiron<script>' as unknown as 'sun' }],
    },
  };
  expect(() => createSnapshotV0({ ...input, charts: [badChart, input.charts[1], input.charts[2]] }, { redactBirthDetails: true }))
    .toThrow(/invalid planet identifier/i);

  const origEvent = input.context.eventSearch!.events[0];
  if (origEvent.kind !== 'aspect-window') throw new Error('expected aspect-window fixture');
  const badEvent = { ...origEvent, aspect: 'Zelda Secret' as unknown as typeof origEvent.aspect };
  expect(() => createSnapshotV0({
    ...input,
    context: { ...input.context, eventSearch: { ...input.context.eventSearch!, events: [badEvent] } },
  }, { redactBirthDetails: true })).toThrow(/invalid aspect identifier/i);

  // Legitimate redacted snapshot preserves JSON & Markdown parity with canonical identifiers only
  const clean = createSnapshotV0(input, { redactBirthDetails: true });
  expect(serializeSnapshot(clean)).not.toContain('Zelda Secret');
  expect(renderSnapshotMarkdown(clean)).not.toContain('chiron');
  // Full export remains backward compatible for existing non-redacted callers
  expect(() => createSnapshotV0({ ...input, aspects: [badAspectId] })).not.toThrow();
});
