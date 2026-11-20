import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, expect, test } from 'vitest';
import { calculateAspects, createAspectRuleSet } from '../../src/domain/aspects';
import { createDateOnlyNatalChart } from '../../src/domain/chart';
import type { PlanetFact, TimedChart } from '../../src/domain/chart';
import type { EventMoment } from '../../src/domain/event';
import { createEphemeraEngine } from '../../src/engine/ephemera';
import { createSnapshotV0, renderSnapshotMarkdown, serializeSnapshot } from '../../src/export/snapshot';
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
