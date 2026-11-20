import type { AspectFact, AspectId } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { HouseFacts, HouseId, PlanetId } from '../domain/chart';
import type { SymbolicMeaning } from '../domain/event';
import {
  angleEntry, aspectEntry, aspectMeta, bodyEntry, bodyMeta, houseEntry, parseElementKey, signEntry, signMeta,
} from '../knowledge';
import type { SourceId } from '../knowledge';
import { natalHouse, planetName, signPosition, titleCase, wrapDegrees } from '../view/chart-data';
import { calculateAngleAspects } from './angles';

const houseName = (name: string) => (name === 'WholeSign' ? 'Whole Sign' : name);
import {
  composeAngleAspectSynthesis,
  composeAngleSynthesis,
  composeBoundaryDayPlacement,
  composeChartRulerSynthesis,
  composePlacementSynthesis,
  composePlanetAspectSynthesis,
  ELEMENT_LABELS,
  EPISTEMIC_DISCLAIMER,
  indefiniteArticle,
  lunarPhaseSynthesis,
  MODE_LABELS,
  tightnessTier,
} from './copy-natal';
import { calculateDateOnlyNatalFacts } from './date-only';
import {
  buildBalanceTheme,
  collectSources,
  computeBalance,
  detectAngularAndHemisphere,
  detectAspectPatterns,
  detectRetrogradeTheme,
  detectSensitivityNotes,
  detectStelliums,
} from './themes';
import type {
  AngleAspectFact,
  AngleId,
  AngleReading,
  ChartRulerReading,
  ChartTheme,
  DateOnlyNatalFacts,
  FactCitation,
  InspectorPersonalNote,
  NatalAspectReading,
  NatalInterpretationInput,
  NatalMoonPhaseReading,
  NatalReading,
  NatalReadingMode,
  PlacementReading,
  ReflectionPrompt,
} from './types';

const TIER_PRIORITY: Readonly<Record<string, number>> = {
  luminary: 1.0,
  personal: 0.85,
  social: 0.72,
  outer: 0.55,
};

const ASPECT_PRIORITY: Readonly<Record<AspectId, number>> = {
  conjunction: 1.0,
  opposition: 0.96,
  square: 0.92,
  trine: 0.84,
  sextile: 0.74,
};

function signOf(longitudeDeg: number): number {
  return Math.floor(wrapDegrees(longitudeDeg) / 30) % 12;
}

function aspectPriority(fromWeight: number, toWeight: number, aspect: AspectId, orbDeg: number, allowedOrbDeg: number): number {
  const tightness = allowedOrbDeg > 0 ? Math.max(0.05, 1 - orbDeg / allowedOrbDeg) : 1;
  return Number((((fromWeight + toWeight) / 2) * ASPECT_PRIORITY[aspect] * (0.45 + 0.55 * tightness)).toFixed(4));
}

function buildAngleReading(
  angle: AngleId,
  houses: HouseFacts,
  angleAspects: readonly AngleAspectFact[],
  houseSystemLabel: string,
): AngleReading {
  const lon = angle === 'asc' ? houses.ascendantDeg : houses.midheavenDeg;
  const oppLon = wrapDegrees(lon + 180);
  const signIndex = signOf(lon);
  const formatted = signPosition(lon);
  const oppositeFormatted = signPosition(oppLon);
  const entry = angleEntry(angle)!;
  const inHouse = natalHouse(lon, houses);
  const degInSign = wrapDegrees(lon) % 30;
  const sensitivityNote = degInSign < 2 || degInSign > 28
    ? `${entry.longName ?? entry.name} sits within 2° of a sign boundary and shifts noticeably with small changes in birth time.`
    : null;
  const copy = composeAngleSynthesis({
    angle,
    signIndex,
    formattedPosition: formatted,
    oppositeLabel: oppositeFormatted,
    inHouse,
    houseSystemLabel,
  });
  const related = angleAspects.filter(a => a.angle === angle);
  return {
    angle,
    selectKey: `angle/${angle}`,
    title: `${entry.longName ?? entry.name} in ${signMeta(signIndex).name}`,
    factLine: `${formatted} (${lon.toFixed(2)}°) · ${angle === 'asc' ? 'Descendant' : 'IC'} ${oppositeFormatted}${inHouse ? ` · House ${inHouse}` : ''}`,
    signIndex,
    oppositeLabel: oppositeFormatted,
    inHouse,
    sensitivityNote,
    symbolismBasis: copy.symbolismBasis,
    synthesis: copy.synthesis,
    reflection: copy.reflection,
    aspects: related,
    citations: [
      { label: `${entry.name} ${formatted}`, selectKey: `angle/${angle}` },
      { label: signMeta(signIndex).name, selectKey: `sign/${signIndex}` },
      ...(inHouse ? [{ label: `House ${inHouse}`, selectKey: `house/${inHouse}` }] : []),
    ],
    sources: copy.sources,
  };
}

function buildChartRuler(
  houses: HouseFacts,
  positions: NatalInterpretationInput['positions'],
): ChartRulerReading | null {
  const ascSignIndex = signOf(houses.ascendantDeg);
  const ascMeta = signMeta(ascSignIndex);
  const rulerId = ascMeta.traditionalRuler;
  const rulerPos = positions.get(rulerId);
  if (!rulerPos) return null;
  const rulerSignIndex = signOf(rulerPos.longitudeDeg);
  const rulerFormatted = signPosition(rulerPos.longitudeDeg);
  const rulerHouse = natalHouse(rulerPos.longitudeDeg, houses);
  const copy = composeChartRulerSynthesis({
    ascSignIndex,
    rulerId,
    modernCoRulerId: ascMeta.modernRuler,
    rulerSignIndex,
    rulerFormatted,
    rulerHouse,
  });
  const citations: FactCitation[] = [
    { label: `ASC in ${ascMeta.name}`, selectKey: 'angle/asc' },
    { label: `Natal ${planetName(rulerId)} (${rulerFormatted})`, selectKey: `natal/${rulerId}` },
    ...(rulerHouse ? [{ label: `House ${rulerHouse}`, selectKey: `house/${rulerHouse}` }] : []),
  ];
  return {
    ascSignIndex,
    rulerId,
    modernCoRulerId: ascMeta.modernRuler,
    rulerSignIndex,
    rulerHouse,
    factLine: `${ascMeta.name} Rising → ${planetName(rulerId)} at ${rulerFormatted}${rulerHouse ? ` in House ${rulerHouse}` : ''}`,
    symbolismBasis: copy.symbolismBasis,
    synthesis: copy.synthesis,
    reflection: copy.reflection,
    citations,
    sources: copy.sources,
  };
}

function buildNatalMoonPhase(
  input: NatalInterpretationInput,
  dateOnlyFacts?: DateOnlyNatalFacts | null,
): NatalMoonPhaseReading | null {
  if (input.natalMoonState) {
    const m = input.natalMoonState;
    const copy = lunarPhaseSynthesis(m.phase);
    const illum = `${m.illuminationPercent.toFixed(1)}% illuminated (${m.waxingLabel.toLowerCase()})`;
    return {
      factLine: `${m.phaseLabel} · ${illum} · ${m.elongationDeg.toFixed(1)}° Sun–Moon elongation`,
      phaseLabel: m.phaseLabel,
      illuminationText: illum,
      symbolismBasis: 'Traditional lunation phase symbolism (cultural convention, distinct from physical illumination percentage).',
      synthesis: `At your birth instant the Moon was in the ${m.phaseLabel} phase (${illum}). In traditional lunation symbolism, ${copy.theme}.`,
      reflection: copy.reflection,
      citations: [
        { label: `Natal Moon (${m.formattedPosition})`, selectKey: 'natal/moon' },
        { label: 'Moon phases', selectKey: 'concept/moon-phases' },
      ],
      sources: ['usno-phases', 'meeus-algorithms', 'wiki-planets-astrology'],
    };
  }
  const d = dateOnlyFacts?.moonSummary ?? input.dateOnlyMoonSummary;
  if (d?.status === 'ok') {
    const phaseChanged = dateOnlyFacts
      ? dateOnlyFacts.moonPhaseChanged
      : Boolean(d.startState && d.endState && d.startState.phase !== d.endState.phase);
    const singlePhase = !phaseChanged && d.startState ? d.startState.phase : null;
    const copy = singlePhase ? lunarPhaseSynthesis(singlePhase) : null;

    let synthesis: string;
    let reflection: string;
    if (d.signChanged && phaseChanged) {
      synthesis =
        `Across your birth date the Moon moved from ${d.startState?.signName} into ${d.endState?.signName} and shifted across lunar phases (${d.phaseSummary}, ${d.illuminationSummary}). `
        + 'Because birth time is unknown, neither a single lunar sign nor a single natal Moon phase can be confirmed.';
      reflection = 'Adding a birth time will confirm both your exact lunar sign and which lunar phase was active at birth.';
    } else if (d.signChanged) {
      synthesis =
        `Across your birth date the Moon moved from ${d.startState?.signName} into ${d.endState?.signName} while remaining in the ${d.phaseSummary} phase (${d.illuminationSummary}). `
        + `Exact lunar sign and aspects cannot be confirmed without a birth time.${copy ? ` For the confirmed ${d.phaseSummary} phase, ${copy.theme}.` : ''}`;
      reflection = copy?.reflection ?? 'What daily rhythm helps you feel most emotionally settled?';
    } else if (phaseChanged) {
      synthesis =
        `Across your birth date the Moon remained in ${d.startState?.signName}, while its phase shifted (${d.phaseSummary}, ${d.illuminationSummary}). `
        + 'Because the phase changed during the day and birth time is unknown, this reading does not assign a single definitive natal Moon phase.';
      reflection = `Because the Moon transitioned (${d.phaseSummary}) on your birth date, adding a birth time will confirm which phase applied at birth.`;
    } else {
      synthesis =
        `Across your birth date the Moon remained in ${d.startState?.signName} in the ${d.phaseSummary} phase (${d.illuminationSummary}).`
        + (copy ? ` In traditional lunation symbolism, ${copy.theme}.` : '');
      reflection = copy?.reflection ?? 'What daily rhythm helps you feel most emotionally settled?';
    }

    return {
      factLine: `${d.phaseSummary} · ${d.illuminationSummary} · ${d.signSummary}`,
      phaseLabel: d.phaseSummary,
      illuminationText: d.illuminationSummary,
      symbolismBasis: phaseChanged
        ? 'Date-only geocentric lunar range across the full birth date; phase shifted during the day so no single natal phase is assigned.'
        : 'Date-only geocentric lunar range across the full birth date; exact birth-Moon degree requires a birth time.',
      synthesis,
      reflection,
      citations: [{ label: 'Moon phases', selectKey: 'concept/moon-phases' }],
      sources: ['usno-phases', 'meeus-algorithms', 'wiki-planets-astrology'],
    };
  }
  return null;
}

function buildDateOnlyReading(input: NatalInterpretationInput): NatalReading {
  const dateOnly: DateOnlyNatalFacts | null = input.engine
    ? calculateDateOnlyNatalFacts(input.engine, input.chart.time.input)
    : null;

  const omittedNotes = [
    'Birth time is unknown, so natal houses, Ascendant, Midheaven, chart ruler, exact Moon degree and Moon aspects are omitted.',
    'Only planetary signs and non-Moon aspects confirmed across the entire birth date (including interior motion and stations) are interpreted below.',
  ];

  if (!dateOnly || dateOnly.status !== 'ok') {
    const skipped = dateOnly?.unavailableReason === 'skipped-civil-date';
    const reasonText = skipped
      ? `The calendar date ${input.chart.time.input.date} did not occur in ${dateOnly.zoneLabel} (skipped by a local time-zone transition), so no birth-date placements can be calculated for that date and zone.`
      : 'Natal planetary positions are unavailable for this date (invalid date/zone or outside ephemeris coverage).';
    return {
      mode: 'unavailable',
      isDemo: input.isDemo,
      profileLabel: input.chart.label,
      birthSummary: input.birthSummary,
      houseSystemLabel: null,
      sensitivityNotes: [],
      omittedNotes: [reasonText],
      overview: {
        headline: skipped ? 'Skipped local calendar date' : 'Natal interpretation unavailable',
        factsSummary: `Birth details: ${input.birthSummary}`,
        symbolismDisclaimer: EPISTEMIC_DISCLAIMER,
        synthesis: reasonText,
        citations: [],
      },
      coreTrio: { sun: null, moon: null, ascendant: null, midheaven: null, chartRuler: null, natalMoonPhase: null },
      balance: null,
      themes: [],
      placements: [],
      aspects: [],
      angleAspects: [],
      reflections: [],
      sources: ['wiki-horoscope'],
      dateOnlyFacts: dateOnly,
    };
  }

  const confirmedSignMap = new Map<PlanetId, number>();
  const placements: PlacementReading[] = [];

  for (const item of dateOnly.planets) {
    const bMeta = bodyMeta(item.planetId);
    const name = planetName(item.planetId);
    const spanFormatted = item.minFormatted && item.maxFormatted
      ? `${item.minFormatted} to ${item.maxFormatted}`
      : `${item.startFormatted} to ${item.endFormatted}`;
    if (item.status === 'confirmed' && item.startSignIndex !== null && item.minFormatted && item.maxFormatted) {
      // Include every planet—including the Moon—whose full-day track stayed inside one zodiac sign.
      confirmedSignMap.set(item.planetId, item.startSignIndex);
      const retro = Boolean(item.retrogradeStart && item.retrogradeEnd && !item.stationedDuringDay);
      const copy = composePlacementSynthesis({
        planetId: item.planetId,
        signIndex: item.startSignIndex,
        formattedPosition: `${item.minFormatted} – ${item.maxFormatted}`,
        houseNumber: null,
        retrograde: retro,
        isDateOnly: true,
      });
      const motionTag = item.stationedDuringDay
        ? ' · Stations during day'
        : retro
          ? ' · ℞ Retrograde'
          : '';
      const rangeText = `${spanFormatted} (${dateOnly.zoneLabel})${motionTag}`;
      const sensitivityNote = item.planetId === 'moon'
        ? 'The Moon stayed in this sign all day, but its exact degree and aspects require a birth time.'
        : item.stationedDuringDay
          ? `${name} stationed (reversed apparent direction) during this date; the degree range above reflects its full-day span including the station point.`
          : null;
      placements.push({
        planetId: item.planetId,
        selectKey: `sign/${item.startSignIndex}`,
        title: `${name} in ${signMeta(item.startSignIndex).name} (confirmed on birth date)`,
        status: 'confirmed-sign',
        factLine: rangeText,
        signIndex: item.startSignIndex,
        houseNumber: null,
        retrograde: retro,
        isGenerationalSign: bMeta.generationalSign,
        sensitivityNote,
        symbolismBasis: copy.symbolismBasis,
        synthesis: copy.synthesis,
        reflection: copy.reflection,
        aspectCount: dateOnly.confirmedAspects.filter(a => a.from === item.planetId || a.to === item.planetId).length,
        citations: [{ label: signMeta(item.startSignIndex).name, selectKey: `sign/${item.startSignIndex}` }],
        sources: copy.sources,
      });
    } else if (item.status === 'boundary-day' && item.startSignIndex !== null && item.startFormatted && item.endFormatted) {
      const copy = composeBoundaryDayPlacement({
        planetId: item.planetId,
        signSequence: item.visitedSignIndices,
        startFormatted: item.startFormatted,
        endFormatted: item.endFormatted,
      });
      const route = item.visitedSignIndices.map(index => signMeta(index).name).join(' → ');
      const motion = item.stationedDuringDay ? ` · Stations during day · Full span ${spanFormatted}` : '';
      placements.push({
        planetId: item.planetId,
        selectKey: `sign/${item.startSignIndex}`,
        title: `${name}: ${route} (boundary day)`,
        status: 'boundary-day',
        factLine: `${item.startFormatted} to ${item.endFormatted} (${dateOnly.zoneLabel})${motion}`,
        signIndex: null,
        houseNumber: null,
        retrograde: Boolean(item.retrogradeStart && item.retrogradeEnd && !item.stationedDuringDay),
        isGenerationalSign: bMeta.generationalSign,
        sensitivityNote: item.stationedDuringDay
          ? 'Crossed a zodiac sign boundary and stationed during this date; birth time is required to confirm the sign.'
          : 'Crossed a zodiac sign boundary on this date; birth time is required to confirm the sign.',
        symbolismBasis: copy.symbolismBasis,
        synthesis: copy.synthesis,
        reflection: copy.reflection,
        aspectCount: 0,
        citations: [...new Set(item.visitedSignIndices)].map(index => ({ label: signMeta(index).name, selectKey: `sign/${index}` })),
        sources: copy.sources,
      });
    }
  }

  const aspects: NatalAspectReading[] = dateOnly.confirmedAspects.map(fact => {
    const aMeta = aspectMeta(fact.aspect);
    const copy = composePlanetAspectSynthesis({
      from: fact.from,
      to: fact.to,
      aspect: fact.aspect,
      orbDeg: fact.maxOrbDeg,
      allowedOrbDeg: fact.allowedOrbDeg,
      fromHouse: null,
      toHouse: null,
      isDateOnly: true,
    });
    const priority = aspectPriority(
      TIER_PRIORITY[bodyMeta(fact.from).tier],
      TIER_PRIORITY[bodyMeta(fact.to).tier],
      fact.aspect,
      fact.maxOrbDeg,
      fact.allowedOrbDeg,
    );
    return {
      id: fact.id,
      selectKey: `aspect/${fact.aspect}`,
      title: `${planetName(fact.from)} ${titleCase(fact.aspect)} ${planetName(fact.to)}`,
      fromLabel: `Natal ${planetName(fact.from)}`,
      toLabel: `Natal ${planetName(fact.to)}`,
      aspect: fact.aspect,
      tone: aMeta.tone,
      tightness: tightnessTier(fact.maxOrbDeg, fact.allowedOrbDeg),
      orbDeg: fact.maxOrbDeg,
      allowedOrbDeg: fact.allowedOrbDeg,
      orbText: `${fact.minOrbDeg.toFixed(1)}°–${fact.maxOrbDeg.toFixed(1)}° orb across day`,
      factLine: `${planetName(fact.from)} ${aspectEntry(fact.aspect)!.name.toLowerCase()} ${planetName(fact.to)} · ${fact.minOrbDeg.toFixed(1)}°–${fact.maxOrbDeg.toFixed(1)}° orb (held all day)`,
      symbolismBasis: copy.symbolismBasis,
      synthesis: copy.synthesis,
      reflection: copy.reflection,
      priority,
      isAngleAspect: false,
      citations: [{ label: `${aspectEntry(fact.aspect)!.name} aspects`, selectKey: `aspect/${fact.aspect}` }],
      sources: copy.sources,
    };
  }).sort((a, b) => b.priority - a.priority || a.orbDeg - b.orbDeg);

  const balance = computeBalance(new Map(), null, confirmedSignMap);
  const themes: ChartTheme[] = [];
  const balanceTheme = balance ? buildBalanceTheme(balance) : null;
  if (balanceTheme) themes.push(balanceTheme);

  const boundaryBodies = placements.filter(p => p.status === 'boundary-day').map(p => planetName(p.planetId));
  themes.unshift({
    id: 'theme/date-only-scope',
    kind: 'date-only',
    title: 'Date-only birth reading (no birth time)',
    factsSummary: `${placements.filter(p => p.status === 'confirmed-sign').length} confirmed signs${boundaryBodies.length ? ` · ${boundaryBodies.length} sign-boundary ${boundaryBodies.length === 1 ? 'body' : 'bodies'} (${boundaryBodies.join(', ')})` : ''} · ${aspects.length} confirmed non-Moon aspects`,
    symbolismBasis: 'Planetary signs that stayed fixed across 00:00–23:59 on your birth date can still be read honestly without guessing an Ascendant or house cusp.',
    synthesis:
      `Because your birth time is marked unknown, this reading focuses strictly on what can be verified from the calendar date ${dateOnly.birthDate} (${dateOnly.zoneLabel}). `
      + `Houses, the Ascendant, Midheaven and exact Moon aspects are left out rather than invented.`,
    reflection: 'If you later find a birth time (even an approximate window), adding it unlocks your Ascendant, houses and exact lunar placement.',
    citations: [{ label: 'Natal chart basics', selectKey: 'concept/natal-chart' }],
    sources: ['wiki-horoscope', 'wiki-sign'],
  });

  const sun = placements.find(p => p.planetId === 'sun') ?? null;
  const moon = placements.find(p => p.planetId === 'moon') ?? null;
  const natalMoonPhase = buildNatalMoonPhase({ ...input, dateOnlyMoonSummary: dateOnly.moonSummary }, dateOnly);

  const sunText = sun?.signIndex !== null && sun
    ? `Sun in ${signMeta(sun.signIndex).name}`
    : sun?.status === 'boundary-day'
      ? `Sun crossing a sign boundary on ${dateOnly.birthDate}`
      : 'date-only birth profile';
  const overviewSynthesis =
    `This date-only reading for ${dateOnly.birthDate} centres on your ${sunText}`
    + (balance?.dominantElement ? ` and a ${ELEMENT_LABELS[balance.dominantElement]} elemental emphasis among confirmed signs` : '')
    + (aspects.length ? `, with ${aspects.length} confirmed non-Moon planetary ${aspects.length === 1 ? 'aspect' : 'aspects'} holding across the entire day.` : '.')
    + ' Houses, angles and exact Moon degree are intentionally omitted because birth time is unknown.';

  const reflections: ReflectionPrompt[] = [
    ...(sun ? [{ id: 'ref/sun', topic: 'Core identity', question: sun.reflection }] : []),
    ...(natalMoonPhase ? [{ id: 'ref/lunar', topic: 'Lunar rhythm', question: natalMoonPhase.reflection }] : []),
    ...(balanceTheme ? [{ id: 'ref/balance', topic: 'Chart balance', question: balanceTheme.reflection }] : []),
  ];

  return {
    mode: 'date-only',
    isDemo: input.isDemo,
    profileLabel: input.chart.label,
    birthSummary: input.birthSummary,
    houseSystemLabel: null,
    sensitivityNotes: boundaryBodies.length
      ? [`Sign-boundary day for ${boundaryBodies.join(', ')}: enter a birth time to determine which side of the boundary applies.`]
      : [],
    omittedNotes,
    overview: {
      headline: `Date-only birth reading · ${sunText}`,
      factsSummary: `Birth date ${dateOnly.birthDate} (${dateOnly.zoneLabel}) · ${placements.filter(p => p.status === 'confirmed-sign').length} confirmed signs · ${aspects.length} confirmed aspects`,
      symbolismDisclaimer: EPISTEMIC_DISCLAIMER,
      synthesis: overviewSynthesis,
      citations: sun?.citations ?? [],
    },
    coreTrio: { sun, moon, ascendant: null, midheaven: null, chartRuler: null, natalMoonPhase },
    balance,
    themes,
    placements,
    aspects,
    angleAspects: [],
    reflections,
    sources: collectSources(
      ...placements.map(p => p.sources),
      ...aspects.map(a => a.sources),
      ...themes.map(t => t.sources),
    ),
    dateOnlyFacts: dateOnly,
  };
}

/**
 * Pure, deterministic natal chart interpreter.
 * Uses only calculated astronomical facts plus the original 49-entry knowledge library.
 */
export function interpretNatalChart(input: NatalInterpretationInput): NatalReading {
  if (input.chart.time.kind === 'unknown-time') {
    return buildDateOnlyReading(input);
  }

  if (!input.positions.size) {
    return {
      mode: 'unavailable',
      isDemo: input.isDemo,
      profileLabel: input.chart.label,
      birthSummary: input.birthSummary,
      houseSystemLabel: null,
      sensitivityNotes: [],
      omittedNotes: ['Natal planetary positions are unavailable for this birth date (outside the 1550–2650 ephemeris range).'],
      overview: {
        headline: 'Natal interpretation unavailable',
        factsSummary: `Birth details: ${input.birthSummary}`,
        symbolismDisclaimer: EPISTEMIC_DISCLAIMER,
        synthesis: 'Planetary positions could not be calculated for this birth date, so no chart reading is available.',
        citations: [],
      },
      coreTrio: { sun: null, moon: null, ascendant: null, midheaven: null, chartRuler: null, natalMoonPhase: null },
      balance: null,
      themes: [],
      placements: [],
      aspects: [],
      angleAspects: [],
      reflections: [],
      sources: ['wiki-horoscope'],
      dateOnlyFacts: null,
    };
  }

  const { positions, houses } = input;
  const mode: NatalReadingMode = houses ? 'complete' : 'no-houses';
  const houseSystemLabel = houses ? houseName(houses.effectiveSystem) : null;
  const natalAspects = input.aspects.filter(a => a.from.chartId === 'natal' && a.to.chartId === 'natal');
  const angleAspects = calculateAngleAspects(positions, houses);

  const omittedNotes: string[] = [];
  if (!houses) {
    const reason = input.chart.houses.status === 'unavailable' ? input.chart.houses.reason : 'missing-location';
    omittedNotes.push(
      reason === 'missing-location'
        ? 'Birthplace coordinates are not set, so natal houses, Ascendant, Midheaven, chart ruler and hemisphere themes are omitted. Add latitude and longitude in Edit birth details to unlock them.'
        : 'Natal houses and angles are unavailable for this chart, so house placements and angle relationships are omitted.',
    );
  }

  const sensitivityNotes = detectSensitivityNotes(input.chart, positions, houses);

  // 1. Individual planet placements
  const placements: PlacementReading[] = [];
  for (const planetId of PLANET_IDS) {
    const pos = positions.get(planetId);
    if (!pos) continue;
    const signIndex = signOf(pos.longitudeDeg);
    const formatted = signPosition(pos.longitudeDeg);
    const houseNumber = natalHouse(pos.longitudeDeg, houses);
    const bMeta = bodyMeta(planetId);
    const sMeta = signMeta(signIndex);
    const copy = composePlacementSynthesis({
      planetId,
      signIndex,
      formattedPosition: formatted,
      houseNumber,
      retrograde: pos.retrograde,
    });
    const degInSign = wrapDegrees(pos.longitudeDeg) % 30;
    let sensitivityNote: string | null = null;
    if (planetId === 'moon' && (degInSign < 1 || degInSign > 29)) {
      sensitivityNote = 'Within 1° of a sign boundary; birth-time accuracy affects this sign.';
    }
    const aspectCount = natalAspects.filter(a => a.from.planetId === planetId || a.to.planetId === planetId).length
      + angleAspects.filter(a => a.planetId === planetId).length;
    const citations: FactCitation[] = [
      { label: `Natal ${planetName(planetId)}`, selectKey: `natal/${planetId}` },
      { label: sMeta.name, selectKey: `sign/${signIndex}` },
      ...(houseNumber ? [{ label: `House ${houseNumber}`, selectKey: `house/${houseNumber}` }] : []),
    ];
    placements.push({
      planetId,
      selectKey: `natal/${planetId}`,
      title: `${planetName(planetId)} in ${sMeta.name}${houseNumber ? ` · House ${houseNumber}` : ''}`,
      status: 'exact',
      factLine: `${formatted}${houseNumber ? ` · House ${houseNumber}` : ''}${pos.retrograde ? ' · ℞ Retrograde' : ''}`,
      signIndex,
      houseNumber,
      retrograde: pos.retrograde,
      isGenerationalSign: bMeta.generationalSign,
      sensitivityNote,
      symbolismBasis: copy.symbolismBasis,
      synthesis: copy.synthesis,
      reflection: copy.reflection,
      aspectCount,
      citations,
      sources: copy.sources,
    });
  }

  // 2. Angles & Chart Ruler
  const ascendant = houses && houseSystemLabel ? buildAngleReading('asc', houses, angleAspects, houseSystemLabel) : null;
  const midheaven = houses && houseSystemLabel ? buildAngleReading('mc', houses, angleAspects, houseSystemLabel) : null;
  const chartRuler = houses ? buildChartRuler(houses, positions) : null;
  const natalMoonPhase = buildNatalMoonPhase(input);

  // 3. Natal aspects (planet-to-planet + planet-to-angle)
  const planetAspectReadings: NatalAspectReading[] = natalAspects.map((fact: AspectFact) => {
    const fromId = fact.from.planetId;
    const toId = fact.to.planetId;
    const aMeta = aspectMeta(fact.aspect);
    const fromHouse = natalHouse(positions.get(fromId)!.longitudeDeg, houses);
    const toHouse = natalHouse(positions.get(toId)!.longitudeDeg, houses);
    const copy = composePlanetAspectSynthesis({
      from: fromId,
      to: toId,
      aspect: fact.aspect,
      orbDeg: fact.orbDeg,
      allowedOrbDeg: fact.allowedOrbDeg,
      fromHouse,
      toHouse,
    });
    const priority = aspectPriority(
      TIER_PRIORITY[bodyMeta(fromId).tier],
      TIER_PRIORITY[bodyMeta(toId).tier],
      fact.aspect,
      fact.orbDeg,
      fact.allowedOrbDeg,
    );
    return {
      id: fact.id,
      selectKey: fact.id,
      title: `${planetName(fromId)} ${titleCase(fact.aspect)} ${planetName(toId)}`,
      fromLabel: `Natal ${planetName(fromId)}`,
      toLabel: `Natal ${planetName(toId)}`,
      aspect: fact.aspect,
      tone: aMeta.tone,
      tightness: tightnessTier(fact.orbDeg, fact.allowedOrbDeg),
      orbDeg: fact.orbDeg,
      allowedOrbDeg: fact.allowedOrbDeg,
      orbText: `${fact.orbDeg.toFixed(2)}° orb`,
      factLine: `${planetName(fromId)} ${aspectEntry(fact.aspect)!.name.toLowerCase()} ${planetName(toId)} · ${fact.separationDeg.toFixed(2)}° (${fact.orbDeg.toFixed(2)}° from ${fact.exactAngleDeg}°)`,
      symbolismBasis: copy.symbolismBasis,
      synthesis: copy.synthesis,
      reflection: copy.reflection,
      priority,
      isAngleAspect: false,
      citations: [
        { label: `Inspect aspect`, selectKey: fact.id },
        { label: `Natal ${planetName(fromId)}`, selectKey: `natal/${fromId}` },
        { label: `Natal ${planetName(toId)}`, selectKey: `natal/${toId}` },
      ],
      sources: copy.sources,
    };
  });

  const angleAspectReadings: NatalAspectReading[] = angleAspects.map(fact => {
    const aMeta = aspectMeta(fact.aspect);
    const angLabel = angleEntry(fact.angle)!.longName ?? angleEntry(fact.angle)!.name;
    const copy = composeAngleAspectSynthesis({
      planetId: fact.planetId,
      angle: fact.angle,
      aspect: fact.aspect,
      orbDeg: fact.orbDeg,
      allowedOrbDeg: fact.allowedOrbDeg,
    });
    const priority = aspectPriority(
      TIER_PRIORITY[bodyMeta(fact.planetId).tier],
      1.0,
      fact.aspect,
      fact.orbDeg,
      fact.allowedOrbDeg,
    );
    return {
      id: fact.id,
      selectKey: `angle/${fact.angle}`,
      title: `${planetName(fact.planetId)} ${titleCase(fact.aspect)} ${angLabel}`,
      fromLabel: `Natal ${planetName(fact.planetId)}`,
      toLabel: angLabel,
      aspect: fact.aspect,
      tone: aMeta.tone,
      tightness: tightnessTier(fact.orbDeg, fact.allowedOrbDeg),
      orbDeg: fact.orbDeg,
      allowedOrbDeg: fact.allowedOrbDeg,
      orbText: `${fact.orbDeg.toFixed(2)}° orb`,
      factLine: `${planetName(fact.planetId)} ${aspectEntry(fact.aspect)!.name.toLowerCase()} ${angLabel} · ${fact.separationDeg.toFixed(2)}° (${fact.orbDeg.toFixed(2)}° from ${fact.exactAngleDeg}°)`,
      symbolismBasis: copy.symbolismBasis,
      synthesis: copy.synthesis,
      reflection: copy.reflection,
      priority,
      isAngleAspect: true,
      citations: [
        { label: `Natal ${planetName(fact.planetId)}`, selectKey: `natal/${fact.planetId}` },
        { label: angLabel, selectKey: `angle/${fact.angle}` },
      ],
      sources: copy.sources,
    };
  });

  const allAspectReadings = [...planetAspectReadings, ...angleAspectReadings]
    .sort((a, b) => b.priority - a.priority || a.orbDeg - b.orbDeg || a.id.localeCompare(b.id));

  // 4. Chart-wide themes
  const balance = computeBalance(positions, houses);
  const themes: ChartTheme[] = [];

  if (chartRuler) {
    themes.push({
      id: 'theme/chart-ruler',
      kind: 'chart-ruler',
      title: `Chart ruler: ${planetName(chartRuler.rulerId)}${chartRuler.rulerHouse ? ` in House ${chartRuler.rulerHouse}` : ''}`,
      factsSummary: chartRuler.factLine,
      symbolismBasis: chartRuler.symbolismBasis,
      synthesis: chartRuler.synthesis,
      reflection: chartRuler.reflection,
      citations: chartRuler.citations,
      sources: chartRuler.sources,
    });
  }

  const balanceTheme = balance ? buildBalanceTheme(balance) : null;
  if (balanceTheme) themes.push(balanceTheme);

  themes.push(...detectStelliums(positions, houses));
  themes.push(...detectAngularAndHemisphere(positions, houses, angleAspects));
  themes.push(...detectAspectPatterns(natalAspects, positions));

  const retroTheme = detectRetrogradeTheme(positions);
  if (retroTheme) themes.push(retroTheme);

  // 5. Coherent Chart Overview
  const sun = placements.find(p => p.planetId === 'sun') ?? null;
  const moon = placements.find(p => p.planetId === 'moon') ?? null;
  const sunSign = sun?.signIndex !== null && sun ? signMeta(sun.signIndex) : null;
  const moonSign = moon?.signIndex !== null && moon ? signMeta(moon.signIndex) : null;
  const ascSign = ascendant ? signMeta(ascendant.signIndex) : null;

  const headlineParts = [
    sunSign ? `${sunSign.name} Sun` : null,
    moonSign ? `${moonSign.name} Moon` : null,
    ascSign ? `${ascSign.name} Rising` : null,
  ].filter(Boolean);

  const overviewSentences: string[] = [];
  if (sunSign && moonSign && ascSign) {
    overviewSentences.push(
      `This birth chart weaves together ${indefiniteArticle(`${sunSign.stylePhrase} ${sunSign.name} Sun`)}${sun?.houseNumber ? ` (House ${sun.houseNumber})` : ''}, `
      + `${indefiniteArticle(`${moonSign.stylePhrase} ${moonSign.name} Moon`)}${moon?.houseNumber ? ` (House ${moon.houseNumber})` : ''}, `
      + `and ${indefiniteArticle(`${ascSign.name} Ascendant`)}${chartRuler ? ` guided by ${planetName(chartRuler.rulerId)} in ${signMeta(chartRuler.rulerSignIndex!).name}${chartRuler.rulerHouse ? ` (House ${chartRuler.rulerHouse})` : ''}` : ''}.`,
    );
  } else if (sunSign && moonSign) {
    overviewSentences.push(
      `With ${sunSign.name} Sun and ${moonSign.name} Moon, this chart pairs ${sunSign.stylePhrase} core expression with ${moonSign.stylePhrase} emotional instincts. `
      + 'Because birthplace coordinates are not entered, house arenas and the rising sign are not included.',
    );
  }

  if (balance?.dominantElement || balance?.dominantMode) {
    const bits = [
      balance.dominantElement ? `${ELEMENT_LABELS[balance.dominantElement]} element` : null,
      balance.dominantMode ? `${MODE_LABELS[balance.dominantMode]} modality` : null,
    ].filter(Boolean);
    overviewSentences.push(`Across the whole wheel, the strongest weight falls in the ${bits.join(' and ')}.`);
  }

  const standoutTheme = themes.find(t => t.kind === 'stellium' || t.kind === 'pattern' || t.kind === 'angular');
  if (standoutTheme) {
    overviewSentences.push(`A standout structural feature is your ${standoutTheme.title.toLowerCase()}.`);
  }

  const topAspect = allAspectReadings[0];
  if (topAspect) {
    overviewSentences.push(
      `Among planetary relationships, ${topAspect.title} (${topAspect.orbText}) stands out as one of the closest contacts in the chart.`,
    );
  }

  const overviewCitations: FactCitation[] = [
    ...(sun ? [{ label: `Sun ${signPosition(positions.get('sun')!.longitudeDeg)}`, selectKey: 'natal/sun' }] : []),
    ...(moon ? [{ label: `Moon ${signPosition(positions.get('moon')!.longitudeDeg)}`, selectKey: 'natal/moon' }] : []),
    ...(ascendant ? [{ label: `ASC ${signPosition(houses!.ascendantDeg)}`, selectKey: 'angle/asc' }] : []),
    ...(topAspect && topAspect.selectKey ? [{ label: `${topAspect.title} (${topAspect.orbText})`, selectKey: topAspect.selectKey }] : []),
  ];

  const reflections: ReflectionPrompt[] = [];
  const pushRef = (id: string, topic: string, question: string) => {
    if (reflections.some(r => r.question === question)) return;
    reflections.push({ id, topic, question });
  };
  if (sun) pushRef('ref/sun', 'Identity & vitality', sun.reflection);
  if (moon) pushRef('ref/moon', 'Emotional needs', moon.reflection);
  if (chartRuler) pushRef('ref/ruler', 'Chart ruler & direction', chartRuler.reflection);
  if (topAspect) pushRef('ref/aspect', topAspect.title, topAspect.reflection);
  if (balanceTheme) pushRef('ref/balance', 'Elemental balance', balanceTheme.reflection);
  if (natalMoonPhase) pushRef('ref/phase', 'Birth Moon phase', natalMoonPhase.reflection);

  const sources = collectSources(
    ...placements.map(p => p.sources),
    ...allAspectReadings.map(a => a.sources),
    ...themes.map(t => t.sources),
    ...(ascendant ? [ascendant.sources] : []),
    ...(midheaven ? [midheaven.sources] : []),
    ...(natalMoonPhase ? [natalMoonPhase.sources] : []),
  );

  return {
    mode,
    isDemo: input.isDemo,
    profileLabel: input.chart.label,
    birthSummary: input.birthSummary,
    houseSystemLabel,
    sensitivityNotes,
    omittedNotes,
    overview: {
      headline: headlineParts.length ? headlineParts.join(' · ') : 'Personalized natal reading',
      factsSummary: `${placements.length} natal planets · ${natalAspects.length} planetary aspects${angleAspects.length ? ` · ${angleAspects.length} angle contacts` : ''}${houseSystemLabel ? ` · ${houseSystemLabel} houses` : ' · no houses'}`,
      symbolismDisclaimer: EPISTEMIC_DISCLAIMER,
      synthesis: overviewSentences.join(' '),
      citations: overviewCitations,
    },
    coreTrio: { sun, moon, ascendant, midheaven, chartRuler, natalMoonPhase },
    balance,
    themes,
    placements,
    aspects: allAspectReadings,
    angleAspects,
    reflections: reflections.slice(0, 6),
    sources,
    dateOnlyFacts: null,
  };
}

/**
 * Concise "In this chart" personalized note for the Inspector when viewing a natal planet,
 * natal aspect, Ascendant, or Midheaven. Returns null for transit elements or glossary concepts.
 */
export function inspectorPersonalNatal(reading: NatalReading | undefined, key: string): InspectorPersonalNote | null {
  if (!reading || !key || reading.mode === 'unavailable') return null;

  // 1. Natal planet (`natal/sun`, etc.)
  if (key.startsWith('natal/')) {
    const planetId = key.slice('natal/'.length) as PlanetId;
    const placement = reading.placements.find(p => p.planetId === planetId);
    if (!placement) return null;
    const extras: string[] = [];
    if (reading.coreTrio.chartRuler?.rulerId === planetId) {
      extras.push(`Also acts as your traditional chart ruler for ${signMeta(reading.coreTrio.chartRuler.ascSignIndex).name} Rising.`);
    }
    return {
      heading: 'In this chart',
      factBadge: placement.factLine,
      symbolismNote: placement.symbolismBasis,
      synthesis: [placement.synthesis, ...extras].join(' '),
      sensitivityNote: placement.sensitivityNote,
      reflection: placement.reflection,
      citations: reading.coreTrio.chartRuler?.rulerId === planetId
        ? [{ label: 'Ascendant (ASC)', selectKey: 'angle/asc' }]
        : [],
    };
  }

  // 2. Chart angles (`angle/asc`, `angle/mc`)
  const parsed = parseElementKey(key);
  if (parsed?.type === 'angle') {
    const angle = parsed.which === 'asc' ? reading.coreTrio.ascendant : reading.coreTrio.midheaven;
    if (!angle) return null;
    const extra = parsed.which === 'asc' && reading.coreTrio.chartRuler
      ? ` ${reading.coreTrio.chartRuler.synthesis}`
      : '';
    return {
      heading: 'In this chart',
      factBadge: angle.factLine,
      symbolismNote: angle.symbolismBasis,
      synthesis: `${angle.synthesis}${extra}`,
      sensitivityNote: angle.sensitivityNote,
      reflection: angle.reflection,
      citations: parsed.which === 'asc' && reading.coreTrio.chartRuler
        ? [{ label: `Chart ruler: Natal ${planetName(reading.coreTrio.chartRuler.rulerId)}`, selectKey: `natal/${reading.coreTrio.chartRuler.rulerId}` }]
        : [],
    };
  }

  // 3. Natal aspect fact (JSON-stringified id)
  const aspect = reading.aspects.find(a => !a.isAngleAspect && a.id === key);
  if (aspect) {
    return {
      heading: 'In this chart',
      factBadge: `${aspect.orbText} · ${aspectMeta(aspect.aspect).toneLabel}`,
      symbolismNote: aspect.symbolismBasis,
      synthesis: aspect.synthesis,
      sensitivityNote: null,
      reflection: aspect.reflection,
      citations: [],
    };
  }

  return null;
}

const RULE_SET_VERSION = 'u5a-v1';
const TRADITION = 'Western tropical astrology (traditional & modern synthesis; symbolic reflection, not prediction)';

/**
 * Formats local synthesis for SnapshotV0. Redacted exports call this with a reading
 * derived inside the serializer from the captured facts.
 */
export function natalSymbolicMeanings(
  reading: NatalReading,
  natalChartId = 'natal',
): readonly SymbolicMeaning[] {
  if (reading.mode === 'unavailable') return [];
  const entries: SymbolicMeaning[] = [];
  const emit = (factId: string, description: string, sources: readonly SourceId[]) => {
    entries.push({
      factId,
      tradition: TRADITION,
      ruleSetVersion: RULE_SET_VERSION,
      description,
      sources: [...sources].sort(),
    });
  };

  // Overview synthesis (redaction-safe: uses signs/themes only, never dates/names/coords)
  const safeOverview = reading.mode === 'date-only'
    ? `Date-only natal reading (birth time unknown; houses, Ascendant, Midheaven and exact Moon degree omitted). ${reading.placements.filter(p => p.status === 'confirmed-sign').length} confirmed signs and ${reading.aspects.length} confirmed non-Moon aspects.`
    : reading.overview.synthesis;
  emit(`${natalChartId}/overview`, safeOverview, reading.sources);

  if (reading.coreTrio.ascendant) {
    emit(`${natalChartId}/angle/asc`, reading.coreTrio.ascendant.synthesis, reading.coreTrio.ascendant.sources);
  }

  if (reading.coreTrio.midheaven) {
    emit(`${natalChartId}/angle/mc`, reading.coreTrio.midheaven.synthesis, reading.coreTrio.midheaven.sources);
  }

  if (reading.coreTrio.chartRuler) {
    emit(`${natalChartId}/chart-ruler`, reading.coreTrio.chartRuler.synthesis, reading.coreTrio.chartRuler.sources);
  }

  for (const theme of reading.themes) {
    if (theme.kind === 'chart-ruler') continue;
    // Strip birth date if present in date-only theme prose so redacted exports never leak dates.
    const description = theme.kind === 'date-only'
      ? 'Date-only reading: houses, Ascendant, Midheaven and exact Moon degree are omitted because birth time is unknown.'
      : `${theme.title}: ${theme.synthesis}`;
    emit(`${natalChartId}/${theme.id}`, description, theme.sources);
  }

  for (const placement of reading.placements) {
    if (placement.status === 'unavailable') continue;
    emit(`${natalChartId}/${placement.planetId}`, placement.synthesis, placement.sources);
  }

  const angleLookup = new Map(reading.angleAspects.map(a => [a.id, a]));
  for (const aspect of reading.aspects.slice(0, 12)) {
    if (aspect.isAngleAspect) {
      const ang = angleLookup.get(aspect.id);
      if (ang) emit(`${natalChartId}/angle/${ang.angle}/${ang.planetId}/${ang.aspect}`, aspect.synthesis, aspect.sources);
      continue;
    }
    if (reading.mode === 'date-only') {
      // Date-only aspects use synthetic IDs rather than SnapshotV0 chart aspect IDs; omit from raw aspect factId slot.
      continue;
    }
    let aspectFactId = aspect.id;
    try {
      const parsed = JSON.parse(aspect.id);
      if (Array.isArray(parsed) && parsed.length === 5) {
        aspectFactId = JSON.stringify([natalChartId, parsed[1], natalChartId, parsed[3], parsed[4]]);
      }
    } catch { /* keep as-is */ }
    emit(aspectFactId, aspect.synthesis, aspect.sources);
  }

  return entries;
}
