import { angularSeparation, MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import type { AspectFact, AspectId } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { HouseFacts, HouseId, PlanetId } from '../domain/chart';
import type { SymbolicMeaning } from '../domain/event';
import { angleEntry, aspectEntry, aspectMeta, bodyEntry, houseEntry, signMeta } from '../knowledge';
import type { SourceId } from '../knowledge';
import { formatLunarTimestamp } from '../lunar';
import { natalHouse, planetName, signPosition, titleCase, wrapDegrees } from '../view/chart-data';
import type { PositionMap } from '../view/chart-data';
import { EPISTEMIC_DISCLAIMER, lunarPhaseSynthesis } from './copy-natal';
import { composeTransitAspectSynthesis, composeTransitHouseSynthesis } from './copy-transits';
import { collectSources } from './themes';
import {
  aspectMotionState,
  calculateTransitAngleAspects,
  motionStateLabel,
  scoreTransitAspect,
  signedArc,
  transitBucket,
  transitMaxOrb,
  transitTightness,
  transitWindowKey,
} from './transit-math';
import type {
  TransitAspectReading,
  TransitEnrichmentHouseTarget,
  TransitEnrichmentPair,
  TransitEnrichmentRequest,
  TransitHouseReading,
  TransitInterpretationInput,
  TransitLunarTieIn,
  TransitReading,
  TransitReadingMode,
  TransitTargetRef,
  TransitTheme,
} from './transit-types';
import type { FactCitation, InspectorPersonalNote, ReflectionPrompt } from './types';

const houseName = (name: string) => (name === 'WholeSign' ? 'Whole Sign' : name);
const ASPECT_IDS = Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[];

const HOUSE_TRANSIT_PLANETS: readonly PlanetId[] = ['pluto', 'neptune', 'uranus', 'saturn', 'jupiter', 'mars', 'sun', 'venus', 'mercury'];
const ENRICHED_HOUSE_PLANETS: readonly PlanetId[] = ['pluto', 'neptune', 'uranus', 'saturn', 'jupiter', 'mars'];

function signOf(longitudeDeg: number): number {
  return Math.floor(wrapDegrees(longitudeDeg) / 30) % 12;
}

function buildLunarTieIn(input: TransitInterpretationInput): TransitLunarTieIn | null {
  const m = input.transitMoonState;
  if (!m) return null;
  const copy = lunarPhaseSynthesis(m.phase);
  const transitMoonHouse = natalHouse(m.moonLongitudeDeg, input.houses);
  const illum = `${m.illuminationPercent.toFixed(1)}% illuminated (${m.waxingLabel.toLowerCase()})`;
  const houseClause = transitMoonHouse
    ? ` Moving through your natal House ${transitMoonHouse} (${houseEntry(transitMoonHouse)!.tagline.toLowerCase()}),`
    : '';
  const synthesis =
    `The transiting Moon is ${m.phaseLabel} (${illum}) at ${m.formattedPosition}.${houseClause} `
    + `In traditional lunation symbolism, ${copy.theme}.`;
  return {
    factLine: `${m.phaseLabel} · ${illum} · ${m.formattedPosition}${transitMoonHouse ? ` · Natal House ${transitMoonHouse}` : ''}`,
    phaseLabel: m.phaseLabel,
    illuminationText: illum,
    transitMoonHouse,
    symbolismBasis: 'Geocentric lunar phase astronomy separated from traditional waxing/waning lunation symbolism.',
    synthesis,
    reflection: copy.reflection,
    citations: [
      { label: `Transit Moon (${m.formattedPosition})`, selectKey: 'transit/moon' },
      ...(transitMoonHouse ? [{ label: `House ${transitMoonHouse}`, selectKey: `house/${transitMoonHouse}` }] : []),
      { label: 'Moon phases', selectKey: 'concept/moon-phases' },
    ],
    sources: ['usno-phases', 'meeus-algorithms', 'wiki-planets-astrology'],
  };
}

function buildDateOnlyTransitReading(input: TransitInterpretationInput): TransitReading {
  const dateOnly = input.dateOnlyNatalFacts;
  const lunarTieIn = buildLunarTieIn(input);
  const omittedNotes = [
    'Birth time is unknown, so natal houses, Ascendant/Midheaven transits, natal Moon transits and exact pass dates are omitted.',
  ];

  if (!input.transitPositions.size || !dateOnly || dateOnly.status !== 'ok') {
    const reason = !input.transitPositions.size
      ? 'Transit planetary positions are unavailable for the selected Time Machine date.'
      : 'Date-only natal positions are unavailable for this birth date, so no transit comparison can be calculated.';
    return {
      mode: 'unavailable',
      isDemo: input.isDemo,
      profileLabel: input.natalChart.label,
      birthSummary: input.birthSummary,
      momentLabel: input.momentLabel,
      displayZone: input.displayZone,
      selectedTt: input.selectedTt,
      houseSystemLabel: null,
      omittedNotes: [...omittedNotes, reason],
      overview: {
        headline: 'Transit interpretation unavailable',
        factsSummary: `Moment: ${input.momentLabel}`,
        symbolismDisclaimer: EPISTEMIC_DISCLAIMER,
        synthesis: reason,
        citations: [],
      },
      themes: [],
      buckets: { longTerm: [], mediumTerm: [], lunarBrief: [] },
      allAspects: [],
      wideChartAspectsCount: 0,
      houseTransits: [],
      lunarTieIn,
      enrichmentState: 'idle',
      nearbyStations: [],
      reflections: lunarTieIn ? [{ id: 'tref/lunar', topic: 'Lunar timing', question: lunarTieIn.reflection }] : [],
      sources: ['wiki-horoscope'],
    };
  }

  // Conservatively check transits ONLY against non-Moon natal planets whose full birth-date
  // longitude span is under 1.5° and stays within the active transit orb across the entire birth date.
  const readings: TransitAspectReading[] = [];
  for (const transitId of PLANET_IDS) {
    if (transitId === 'moon') continue; // Fast lunar transits require exact natal degrees.
    const tPos = input.transitPositions.get(transitId);
    if (!tPos) continue;
    const bucket = transitBucket(transitId);

    for (const natalItem of dateOnly.planets) {
      if (natalItem.planetId === 'moon' || natalItem.status !== 'confirmed') continue;
      if (natalItem.minLongitudeDeg === null || natalItem.maxLongitudeDeg === null) continue;
      const dailySpan = Math.abs(signedArc(natalItem.maxLongitudeDeg, natalItem.minLongitudeDeg));
      if (dailySpan > 1.5) continue;

      const midLon = wrapDegrees(natalItem.minLongitudeDeg + signedArc(natalItem.maxLongitudeDeg, natalItem.minLongitudeDeg) / 2);
      let best: { aspect: AspectId; minOrb: number; maxOrb: number; midOrb: number; allowedOrb: number } | undefined;
      for (const aspect of ASPECT_IDS) {
        const allowedOrb = transitMaxOrb(transitId, aspect);
        const angle = MAJOR_ASPECT_ANGLES[aspect];
        const orbA = Math.abs(angularSeparation(tPos.longitudeDeg, natalItem.minLongitudeDeg) - angle);
        const orbB = Math.abs(angularSeparation(tPos.longitudeDeg, natalItem.maxLongitudeDeg) - angle);
        const orbMid = Math.abs(angularSeparation(tPos.longitudeDeg, midLon) - angle);
        const worst = Math.max(orbA, orbB, orbMid);
        const tightest = Math.min(orbA, orbB, orbMid);
        if (worst <= allowedOrb && (!best || worst < best.maxOrb)) {
          best = { aspect, minOrb: tightest, maxOrb: worst, midOrb: orbMid, allowedOrb };
        }
      }
      if (!best) continue;

      const target: TransitTargetRef = { kind: 'planet', planetId: natalItem.planetId };
      const motion = aspectMotionState(tPos.longitudeDeg, tPos.longitudeSpeedDegPerDay, midLon, best.aspect);
      const salience = scoreTransitAspect({
        transitId,
        target,
        aspect: best.aspect,
        orbDeg: best.midOrb,
        motion,
      });
      const copy = composeTransitAspectSynthesis({
        transitId,
        target,
        aspect: best.aspect,
        motion,
        bucket,
        retrograde: tPos.retrograde,
        orbDeg: best.midOrb,
        transitHouse: null,
        targetHouse: null,
        enrichment: null,
        displayZone: input.displayZone,
        approximateDateOnly: true,
      });
      const wKey = transitWindowKey(transitId, target, best.aspect);
      readings.push({
        id: `date-only-transit:${wKey}`,
        windowKey: wKey,
        selectKey: `transit/${transitId}`,
        transitId,
        target,
        title: `Transit ${planetName(transitId)} ${titleCase(best.aspect)} Natal ${planetName(natalItem.planetId)}`,
        aspect: best.aspect,
        tone: aspectMeta(best.aspect).tone,
        motion,
        motionLabel: 'Approximate (birth time unknown)',
        bucket,
        orbDeg: best.midOrb,
        maxOrbDeg: best.allowedOrb,
        tightness: transitTightness(transitId, best.maxOrb, best.aspect),
        salience,
        retrograde: tPos.retrograde,
        isAngleContact: false,
        approximateDateOnly: true,
        transitHouse: null,
        targetHouse: null,
        factLine: `${best.minOrb.toFixed(1)}°–${best.maxOrb.toFixed(1)}° orb across birth-date range · ${signPosition(tPos.longitudeDeg)}${tPos.retrograde ? ' ℞' : ''}`,
        symbolismBasis: copy.symbolismBasis,
        synthesis: copy.synthesis,
        reflection: copy.reflection,
        enrichment: null,
        citations: [
          { label: `Transit ${planetName(transitId)}`, selectKey: `transit/${transitId}` },
          { label: `${aspectEntry(best.aspect)!.name} aspects`, selectKey: `aspect/${best.aspect}` },
        ],
        sources: copy.sources,
      });
    }
  }

  readings.sort((a, b) => b.salience - a.salience || a.orbDeg - b.orbDeg || a.id.localeCompare(b.id));
  const longTerm = readings.filter(r => r.bucket === 'long-term');
  const mediumTerm = readings.filter(r => r.bucket === 'medium-term');

  const themes: TransitTheme[] = [{
    id: 'ttheme/date-only-scope',
    kind: 'date-only',
    title: 'Date-only transit scope (birth time unknown)',
    factsSummary: `${readings.length} confirmed full-day-range slow/medium transit ${readings.length === 1 ? 'contact' : 'contacts'} · houses, angles and Moon targets omitted`,
    symbolismBasis: 'Only transits that stay within active orb across the entire birth-date longitude range of slower natal planets are listed.',
    synthesis:
      'Because birth time is unknown, exact transit contact times, natal houses, Ascendant/Midheaven transits and Moon-to-natal contacts are omitted. '
      + 'Enter a recorded birth time to unlock full timing and exact-pass dates.',
    reflection: 'Which broader seasonal themes feel active in your life right now?',
    citations: [{ label: 'About transits', selectKey: 'concept/transits' }],
    sources: ['wiki-horoscope', 'britannica-astrology'],
  }];

  const lead = readings[0];
  const overviewSynthesis = lead
    ? `At ${input.momentLabel}, ${readings.length} approximate transit ${readings.length === 1 ? 'contact stays' : 'contacts stay'} within active orb across your birth date’s planetary range, led by ${lead.title}. Exact timing, houses and lunar contacts require a birth time.`
    : `At ${input.momentLabel}, no slower transits remain inside active orb across your entire birth-date planetary range. Enter a birth time to see full transit timing, houses and exact passes.`;

  return {
    mode: 'date-only',
    isDemo: input.isDemo,
    profileLabel: input.natalChart.label,
    birthSummary: input.birthSummary,
    momentLabel: input.momentLabel,
    displayZone: input.displayZone,
    selectedTt: input.selectedTt,
    houseSystemLabel: null,
    omittedNotes,
    overview: {
      headline: lead ? `Date-only transit focus · ${lead.title}` : 'Date-only sky overview',
      factsSummary: `${input.momentLabel} · ${readings.length} approximate slow-planet contacts · birth time unknown`,
      symbolismDisclaimer: EPISTEMIC_DISCLAIMER,
      synthesis: overviewSynthesis,
      citations: lead ? lead.citations : [{ label: 'Transits', selectKey: 'concept/transits' }],
    },
    themes,
    buckets: { longTerm, mediumTerm, lunarBrief: [] },
    allAspects: readings,
    wideChartAspectsCount: 0,
    houseTransits: [],
    lunarTieIn,
    enrichmentState: 'idle',
    nearbyStations: [],
    reflections: [
      ...(lead ? [{ id: 'tref/lead', topic: lead.title, question: lead.reflection }] : []),
      ...(lunarTieIn ? [{ id: 'tref/lunar', topic: 'Lunar timing', question: lunarTieIn.reflection }] : []),
    ],
    sources: collectSources(
      ...readings.map(r => r.sources),
      ...themes.map(t => t.sources),
      ...(lunarTieIn ? [lunarTieIn.sources] : []),
    ),
  };
}

/**
 * Builds the targeted Tier-2 enrichment request for the active transits and slow-planet
 * natal house stays at the current Time Machine instant.
 */
export function buildTransitEnrichmentRequest(
  reading: TransitReading,
  natalPositions: PositionMap,
  houses: HouseFacts | null,
  signature: string,
): TransitEnrichmentRequest | null {
  if (reading.selectedTt === null || (reading.mode !== 'complete' && reading.mode !== 'no-houses')) {
    return null;
  }

  const pairs: TransitEnrichmentPair[] = [];
  for (const item of reading.allAspects) {
    if (item.approximateDateOnly) continue;
    let targetLon: number | undefined;
    if (item.target.kind === 'angle') {
      targetLon = houses ? (item.target.angle === 'asc' ? houses.ascendantDeg : houses.midheavenDeg) : undefined;
    } else {
      targetLon = natalPositions.get(item.target.planetId)?.longitudeDeg;
    }
    if (targetLon === undefined) continue;
    pairs.push({
      key: item.windowKey,
      transitId: item.transitId,
      target: item.target,
      targetLongitudeDeg: targetLon,
      aspect: item.aspect,
      allowedOrbDeg: item.maxOrbDeg,
    });
  }

  const houseTargets: TransitEnrichmentHouseTarget[] = [];
  if (houses) {
    for (const ht of reading.houseTransits) {
      if (!ENRICHED_HOUSE_PLANETS.includes(ht.planetId)) continue;
      const cuspStart = houses.cusps[ht.houseNumber - 1]?.longitudeDeg;
      const cuspEnd = houses.cusps[ht.houseNumber % 12]?.longitudeDeg;
      if (cuspStart === undefined || cuspEnd === undefined) continue;
      houseTargets.push({
        planetId: ht.planetId,
        houseNumber: ht.houseNumber,
        cuspStartDeg: cuspStart,
        cuspEndDeg: cuspEnd,
      });
    }
  }

  if (!pairs.length && !houseTargets.length) return null;
  return {
    signature,
    selectedTt: reading.selectedTt,
    pairs,
    houseTargets,
  };
}

/**
 * Pure, synchronous Tier-1 personalized transit interpreter (with optional Tier-2
 * exact-pass, retrograde-repetition and house-ingress/egress enrichment overlay).
 */
export function interpretTransits(input: TransitInterpretationInput): TransitReading {
  if (input.natalChart.time.kind === 'unknown-time') {
    return buildDateOnlyTransitReading(input);
  }

  const lunarTieIn = buildLunarTieIn(input);

  if (!input.natalPositions.size || !input.transitPositions.size) {
    const reason = !input.transitPositions.size
      ? 'Transit positions are unavailable for the selected Time Machine date (outside ephemeris coverage).'
      : 'Natal planetary positions are unavailable for this birth chart.';
    return {
      mode: 'unavailable',
      isDemo: input.isDemo,
      profileLabel: input.natalChart.label,
      birthSummary: input.birthSummary,
      momentLabel: input.momentLabel,
      displayZone: input.displayZone,
      selectedTt: input.selectedTt,
      houseSystemLabel: null,
      omittedNotes: [reason],
      overview: {
        headline: 'Transit interpretation unavailable',
        factsSummary: `Moment: ${input.momentLabel}`,
        symbolismDisclaimer: EPISTEMIC_DISCLAIMER,
        synthesis: reason,
        citations: [],
      },
      themes: [],
      buckets: { longTerm: [], mediumTerm: [], lunarBrief: [] },
      allAspects: [],
      wideChartAspectsCount: 0,
      houseTransits: [],
      lunarTieIn,
      enrichmentState: 'idle',
      nearbyStations: [],
      reflections: [],
      sources: ['wiki-horoscope'],
    };
  }

  const { natalPositions, transitPositions, houses } = input;
  const mode: TransitReadingMode = houses ? 'complete' : 'no-houses';
  const houseSystemLabel = houses ? houseName(houses.effectiveSystem) : null;
  const enrichment = input.enrichment ?? null;
  const enrichmentState = input.enrichmentState ?? (enrichment ? enrichment.status : 'idle');

  const omittedNotes: string[] = [];
  if (!houses) {
    omittedNotes.push(
      'Birthplace coordinates are not set, so transiting planets through natal houses and transits to your Ascendant and Midheaven are omitted. Add coordinates in Edit birth details to unlock them.',
    );
  }

  // 1. Transit-to-natal planetary aspects (filtered to speed-aware interpretive orbs)
  const crossingAspects = input.transitAspects.filter(fact => fact.from.chartId !== fact.to.chartId);
  let wideChartAspectsCount = 0;
  const aspectReadings: TransitAspectReading[] = [];

  for (const fact of crossingAspects) {
    const transitRef = fact.from.chartId === 'transit' ? fact.from : fact.to;
    const natalRef = fact.from.chartId === 'natal' ? fact.from : fact.to;
    const transitId = transitRef.planetId;
    const natalId = natalRef.planetId;
    const tPos = transitPositions.get(transitId);
    const nPos = natalPositions.get(natalId);
    if (!tPos || !nPos) continue;

    const maxOrb = transitMaxOrb(transitId, fact.aspect);
    if (fact.orbDeg > maxOrb) {
      wideChartAspectsCount += 1;
      continue;
    }

    const target: TransitTargetRef = { kind: 'planet', planetId: natalId };
    const motion = aspectMotionState(tPos.longitudeDeg, tPos.longitudeSpeedDegPerDay, nPos.longitudeDeg, fact.aspect);
    const bucket = transitBucket(transitId);
    const tightness = transitTightness(transitId, fact.orbDeg, fact.aspect);
    const salience = scoreTransitAspect({
      transitId,
      target,
      aspect: fact.aspect,
      orbDeg: fact.orbDeg,
      motion,
      chartRulerId: input.chartRulerId,
    });
    const transitHouse = natalHouse(tPos.longitudeDeg, houses);
    const targetHouse = natalHouse(nPos.longitudeDeg, houses);
    const wKey = transitWindowKey(transitId, target, fact.aspect);
    const winEnrich = enrichment?.windows[wKey] ?? null;

    const copy = composeTransitAspectSynthesis({
      transitId,
      target,
      aspect: fact.aspect,
      motion,
      bucket,
      retrograde: tPos.retrograde,
      orbDeg: fact.orbDeg,
      transitHouse,
      targetHouse,
      enrichment: winEnrich,
      displayZone: input.displayZone,
    });

    aspectReadings.push({
      id: fact.id,
      windowKey: wKey,
      selectKey: fact.id,
      transitId,
      target,
      title: `Transit ${planetName(transitId)} ${titleCase(fact.aspect)} Natal ${planetName(natalId)}`,
      aspect: fact.aspect,
      tone: aspectMeta(fact.aspect).tone,
      motion,
      motionLabel: motionStateLabel(motion),
      bucket,
      orbDeg: fact.orbDeg,
      maxOrbDeg: maxOrb,
      tightness,
      salience,
      retrograde: tPos.retrograde,
      isAngleContact: false,
      approximateDateOnly: false,
      transitHouse,
      targetHouse,
      factLine: `${fact.orbDeg.toFixed(2)}° orb (${motionStateLabel(motion).toLowerCase()}) · Transit ${signPosition(tPos.longitudeDeg)}${tPos.retrograde ? ' ℞' : ''}${transitHouse ? ` (H${transitHouse})` : ''} → Natal ${signPosition(nPos.longitudeDeg)}${targetHouse ? ` (H${targetHouse})` : ''}`,
      symbolismBasis: copy.symbolismBasis,
      synthesis: copy.synthesis,
      reflection: copy.reflection,
      enrichment: winEnrich,
      citations: [
        { label: 'Inspect aspect', selectKey: fact.id },
        { label: `Transit ${planetName(transitId)}`, selectKey: `transit/${transitId}` },
        { label: `Natal ${planetName(natalId)}`, selectKey: `natal/${natalId}` },
      ],
      sources: copy.sources,
    });
  }

  // 2. Transit-to-natal angle aspects (ASC / MC when houses exist)
  const angleContacts = calculateTransitAngleAspects(transitPositions, houses);
  for (const contact of angleContacts) {
    const tPos = transitPositions.get(contact.transitId);
    if (!tPos || !houses) continue;
    const angleLon = contact.angle === 'asc' ? houses.ascendantDeg : houses.midheavenDeg;
    const target: TransitTargetRef = { kind: 'angle', angle: contact.angle };
    const motion = aspectMotionState(tPos.longitudeDeg, tPos.longitudeSpeedDegPerDay, angleLon, contact.aspect);
    const bucket = transitBucket(contact.transitId);
    const tightness = transitTightness(contact.transitId, contact.orbDeg);
    const salience = scoreTransitAspect({
      transitId: contact.transitId,
      target,
      aspect: contact.aspect,
      orbDeg: contact.orbDeg,
      motion,
      chartRulerId: input.chartRulerId,
    });
    const transitHouse = natalHouse(tPos.longitudeDeg, houses);
    const targetHouse = contact.angle === 'asc' ? 1 : natalHouse(houses.midheavenDeg, houses);
    const wKey = transitWindowKey(contact.transitId, target, contact.aspect);
    const winEnrich = enrichment?.windows[wKey] ?? null;
    const angLabel = angleEntry(contact.angle)!.longName ?? angleEntry(contact.angle)!.name;

    const copy = composeTransitAspectSynthesis({
      transitId: contact.transitId,
      target,
      aspect: contact.aspect,
      motion,
      bucket,
      retrograde: tPos.retrograde,
      orbDeg: contact.orbDeg,
      transitHouse,
      targetHouse,
      enrichment: winEnrich,
      displayZone: input.displayZone,
    });

    aspectReadings.push({
      id: contact.id,
      windowKey: wKey,
      selectKey: `transit/${contact.transitId}`,
      transitId: contact.transitId,
      target,
      title: `Transit ${planetName(contact.transitId)} ${titleCase(contact.aspect)} Natal ${angLabel}`,
      aspect: contact.aspect,
      tone: aspectMeta(contact.aspect).tone,
      motion,
      motionLabel: motionStateLabel(motion),
      bucket,
      orbDeg: contact.orbDeg,
      maxOrbDeg: contact.allowedOrbDeg,
      tightness,
      salience,
      retrograde: tPos.retrograde,
      isAngleContact: true,
      approximateDateOnly: false,
      transitHouse,
      targetHouse,
      factLine: `${contact.orbDeg.toFixed(2)}° orb (${motionStateLabel(motion).toLowerCase()}) · Transit ${signPosition(tPos.longitudeDeg)}${tPos.retrograde ? ' ℞' : ''} → Natal ${angLabel} ${signPosition(angleLon)}`,
      symbolismBasis: copy.symbolismBasis,
      synthesis: copy.synthesis,
      reflection: copy.reflection,
      enrichment: winEnrich,
      citations: [
        { label: `Transit ${planetName(contact.transitId)}`, selectKey: `transit/${contact.transitId}` },
        { label: angLabel, selectKey: `angle/${contact.angle}` },
      ],
      sources: copy.sources,
    });
  }

  aspectReadings.sort((a, b) => b.salience - a.salience || a.orbDeg - b.orbDeg || a.id.localeCompare(b.id));

  const longTerm = aspectReadings.filter(r => r.bucket === 'long-term');
  const mediumTerm = aspectReadings.filter(r => r.bucket === 'medium-term');
  const lunarBrief = aspectReadings.filter(r => r.bucket === 'lunar-brief');

  // 3. Transiting planets moving through natal houses
  const houseTransits: TransitHouseReading[] = [];
  if (houses) {
    for (const planetId of HOUSE_TRANSIT_PLANETS) {
      const tPos = transitPositions.get(planetId);
      if (!tPos) continue;
      const houseNumber = natalHouse(tPos.longitudeDeg, houses);
      if (!houseNumber) continue;
      const signIndex = signOf(tPos.longitudeDeg);
      const formattedPosition = signPosition(tPos.longitudeDeg);
      const span = enrichment?.houseSpans[planetId] ?? null;
      const copy = composeTransitHouseSynthesis({
        planetId,
        houseNumber,
        signIndex,
        retrograde: tPos.retrograde,
        span,
        displayZone: input.displayZone,
      });
      houseTransits.push({
        planetId,
        selectKey: `transit/${planetId}`,
        houseNumber,
        signIndex,
        formattedPosition,
        retrograde: tPos.retrograde,
        bucket: transitBucket(planetId),
        factLine: `Natal House ${houseNumber} · ${formattedPosition}${tPos.retrograde ? ' · ℞ Retrograde' : ''}`,
        symbolismBasis: copy.symbolismBasis,
        synthesis: copy.synthesis,
        span,
        citations: [
          { label: `Transit ${planetName(planetId)}`, selectKey: `transit/${planetId}` },
          { label: `House ${houseNumber}`, selectKey: `house/${houseNumber}` },
        ],
        sources: copy.sources,
      });
    }
  }

  // 4. Convergence & Thematic Synthesis
  const themes: TransitTheme[] = [];

  // 4a. Same natal target hit by >= 2 active transits (including at least one non-Moon planet)
  const byTarget = new Map<string, TransitAspectReading[]>();
  for (const r of aspectReadings) {
    const key = r.target.kind === 'angle' ? `angle/${r.target.angle}` : `natal/${r.target.planetId}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), r]);
  }
  const targetClusters = [...byTarget.entries()]
    .filter(([, list]) => list.length >= 2 && list.some(r => r.transitId !== 'moon'))
    .sort((a, b) => b[1].reduce((s, x) => s + x.salience, 0) - a[1].reduce((s, x) => s + x.salience, 0));

  for (const [targetKey, list] of targetClusters.slice(0, 2)) {
    const sample = list[0];
    const targetName = sample.target.kind === 'angle'
      ? `Natal ${angleEntry(sample.target.angle)!.longName}`
      : `Natal ${planetName(sample.target.planetId)}`;
    const summaryParts = list.map(r => `${planetName(r.transitId)} ${r.aspect} (${r.orbDeg.toFixed(1)}°, ${r.motionLabel.toLowerCase()})`);
    const tones = new Set(list.map(r => r.tone));
    const blendMood = tones.size > 1
      ? 'a mix of supportive openings and productive tension'
      : tones.has('tense')
        ? 'concentrated pressure asking for deliberate adjustment'
        : tones.has('support')
          ? 'reinforcing momentum and ease'
          : 'intense, unified focus';
    themes.push({
      id: `ttheme/target-${targetKey.replace('/', '-')}`,
      kind: 'convergence-target',
      title: `Converging focus on ${targetName} (${list.length} transits)`,
      factsSummary: summaryParts.join(' · '),
      symbolismBasis: `Multiple transits aspecting ${targetName} simultaneously amplify its natal themes.`,
      synthesis:
        `${list.length} active transits are converging on your ${targetName} at once—bringing ${blendMood}. `
        + `Working with ${targetName}’s themes intentionally helps tie these overlapping influences together.`,
      reflection: sample.reflection,
      citations: [
        { label: targetName, selectKey: targetKey },
        ...list.slice(0, 3).map(r => ({ label: `Transit ${planetName(r.transitId)}`, selectKey: `transit/${r.transitId}` })),
      ],
      sources: collectSources(...list.map(r => r.sources)),
    });
  }

  // 4b. Same natal house occupied by >= 2 slower/personal transiting planets
  if (houses) {
    const byHouse = new Map<HouseId, TransitHouseReading[]>();
    for (const ht of houseTransits) {
      byHouse.set(ht.houseNumber, [...(byHouse.get(ht.houseNumber) ?? []), ht]);
    }
    const houseClusters = [...byHouse.entries()]
      .filter(([, list]) => list.length >= 2)
      .sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
    if (houseClusters.length) {
      const [houseId, list] = houseClusters[0];
      const hEntry = houseEntry(houseId)!;
      const names = list.map(h => planetName(h.planetId));
      themes.push({
        id: `ttheme/house-${houseId}`,
        kind: 'convergence-house',
        title: `Active natal House ${houseId}: ${hEntry.tagline} (${list.length} planets)`,
        factsSummary: `Transiting ${names.join(', ')} currently occupy natal House ${houseId}`,
        symbolismBasis: `House ${houseId} traditionally governs ${hEntry.tagline.toLowerCase()}.`,
        synthesis:
          `With ${names.join(', ')} travelling through natal House ${houseId} simultaneously, attention gathers naturally around ${hEntry.tagline.toLowerCase()}. `
          + 'Steady effort in this single life arena carries outsized leverage right now.',
        reflection: hEntry.reflection ?? `What deserves my clearest attention in House ${houseId} right now?`,
        citations: [
          { label: `House ${houseId}`, selectKey: `house/${houseId}` },
          ...list.slice(0, 3).map(h => ({ label: `Transit ${planetName(h.planetId)}`, selectKey: h.selectKey })),
        ],
        sources: collectSources(...list.map(h => h.sources)),
      });
    }
  }

  // 4c. Retrograde & nearby station context
  const nearbyStations = enrichment?.nearbyStations ?? [];
  const activeRetroTransits = [...new Set(aspectReadings.filter(r => r.retrograde).map(r => r.transitId))];
  if (nearbyStations.length || activeRetroTransits.length) {
    const stationBits = nearbyStations.slice(0, 2).map(st =>
      `${planetName(st.planetId)} stations ${st.turns} on ${formatLunarTimestamp(st.epochMs, input.displayZone)}`,
    );
    const retroBits = activeRetroTransits.map(id => `${planetName(id)} ℞`);
    const facts = [...stationBits, ...(retroBits.length ? [`Active retrograde transits: ${retroBits.join(', ')}`] : [])].join(' · ');
    themes.push({
      id: 'ttheme/retrograde-station',
      kind: 'retrograde-station',
      title: nearbyStations.length ? 'Station & retrograde turning point' : 'Retrograde review emphasis',
      factsSummary: facts,
      symbolismBasis: 'Apparent retrograde motion and stations are perspective effects; traditionally they emphasize revisiting, consolidating and multi-pass timing rather than rushing.',
      synthesis: nearbyStations.length
        ? `A nearby planetary station (${stationBits.join('; ')}) slows apparent motion and concentrates focus on the themes being aspected. Traditional timing favours reviewing and refining work over forcing quick closure.`
        : `Active retrograde transits (${retroBits.join(', ')}) traditionally invite revisiting unfinished conversations, habits or commitments connected to the natal points they touch.`,
      reflection: 'What existing commitment or idea would benefit from thoughtful revision instead of pushing forward?',
      citations: [
        { label: 'About retrograde', selectKey: 'concept/retrograde' },
        ...activeRetroTransits.slice(0, 2).map(id => ({ label: `Transit ${planetName(id)}`, selectKey: `transit/${id}` })),
      ],
      sources: ['wiki-retrograde', 'wiki-planets-astrology'],
    });
  }

  // 5. Sky Weather Overview
  const anchors = [...longTerm, ...mediumTerm].slice(0, 2);
  const topTones = new Set(anchors.map(a => a.tone));
  const toneSummary = !anchors.length
    ? 'relatively quiet between major exact contacts'
    : topTones.size > 1
      ? 'mixed—balancing constructive openings alongside active tension'
      : topTones.has('tense')
        ? 'focused and activating—inviting adjustment and clear boundaries'
        : topTones.has('support')
          ? 'flowing and cooperative—rewarding steady, intentional follow-through'
          : 'concentrated and blending—bringing standout emphasis to one core theme';

  const applyingCount = aspectReadings.filter(a => a.motion === 'applying' || a.motion === 'exact').length;
  const separatingCount = aspectReadings.filter(a => a.motion === 'separating').length;
  const tempoLine = aspectReadings.length
    ? applyingCount > separatingCount
      ? 'Most active contacts are applying or peaking, so themes are building toward clarity.'
      : separatingCount > applyingCount
        ? 'Most active contacts are separating, favouring reflection and integrating recent shifts.'
        : 'Building (applying) and easing (separating) contacts are evenly balanced.'
    : 'With no tight planetary transits within active orb right now, everyday routines and the current lunar cycle carry the foreground.';

  const headline = anchors.length
    ? anchors.map(a => a.title).join(' · ')
    : lunarBrief.length
      ? `Quiet sky · ${lunarBrief[0].title}`
      : 'Quiet transit window';

  const overviewSynthesis =
    `At ${input.momentLabel}, your transits look ${toneSummary}. `
    + (anchors.length ? `Leading the sky: ${anchors.map(a => `${a.title} (${a.orbDeg.toFixed(2)}° orb, ${a.motionLabel.toLowerCase()})`).join(' and ')}. ` : '')
    + tempoLine;

  const overviewCitations: FactCitation[] = [
    ...anchors.map(a => ({ label: `${a.title} (${a.orbDeg.toFixed(1)}°)`, selectKey: a.selectKey })),
    { label: 'About transits', selectKey: 'concept/transits' },
  ];

  // 6. Reflections
  const reflections: ReflectionPrompt[] = [];
  const pushRef = (id: string, topic: string, question: string) => {
    if (reflections.some(r => r.question === question)) return;
    reflections.push({ id, topic, question });
  };
  for (const a of anchors) pushRef(`tref/${a.windowKey}`, a.title, a.reflection);
  for (const t of themes.slice(0, 2)) pushRef(`tref/${t.id}`, t.title, t.reflection);
  if (lunarTieIn) pushRef('tref/lunar', 'Lunar rhythm', lunarTieIn.reflection);

  const sources = collectSources(
    ...aspectReadings.map(r => r.sources),
    ...houseTransits.map(h => h.sources),
    ...themes.map(t => t.sources),
    ...(lunarTieIn ? [lunarTieIn.sources] : []),
  );

  return {
    mode,
    isDemo: input.isDemo,
    profileLabel: input.natalChart.label,
    birthSummary: input.birthSummary,
    momentLabel: input.momentLabel,
    displayZone: input.displayZone,
    selectedTt: input.selectedTt,
    houseSystemLabel,
    omittedNotes,
    overview: {
      headline,
      factsSummary: `${input.momentLabel} · ${longTerm.length} long-term · ${mediumTerm.length} medium-term · ${lunarBrief.length} lunar brief${houseSystemLabel ? ` · ${houseSystemLabel} houses` : ''}`,
      symbolismDisclaimer: EPISTEMIC_DISCLAIMER,
      synthesis: overviewSynthesis,
      citations: overviewCitations,
    },
    themes,
    buckets: { longTerm, mediumTerm, lunarBrief },
    allAspects: aspectReadings,
    wideChartAspectsCount,
    houseTransits,
    lunarTieIn,
    enrichmentState,
    nearbyStations,
    reflections: reflections.slice(0, 5),
    sources,
  };
}

/**
 * Concise "In these transits" personalized note for the Inspector when viewing
 * a transiting planet (`transit/<planet>`) or a transit-to-natal aspect.
 */
export function inspectorPersonalTransit(reading: TransitReading | undefined, key: string): InspectorPersonalNote | null {
  if (!reading || !key || reading.mode === 'unavailable') return null;

  // 1. Transit planet (`transit/saturn`, etc.)
  if (key.startsWith('transit/')) {
    const planetId = key.slice('transit/'.length) as PlanetId;
    const houseItem = reading.houseTransits.find(h => h.planetId === planetId);
    const activeContacts = reading.allAspects.filter(a => a.transitId === planetId);
    if (!houseItem && !activeContacts.length) {
      if (planetId === 'moon' && reading.lunarTieIn) {
        return {
          heading: 'In these transits',
          factBadge: reading.lunarTieIn.factLine,
          symbolismNote: reading.lunarTieIn.symbolismBasis,
          synthesis: reading.lunarTieIn.synthesis,
          sensitivityNote: null,
          reflection: reading.lunarTieIn.reflection,
          citations: [],
        };
      }
      return null;
    }

    const parts: string[] = [];
    if (houseItem) parts.push(houseItem.synthesis);
    if (activeContacts.length) {
      const lead = activeContacts[0];
      parts.push(
        `Top active contact: ${lead.title} (${lead.orbDeg.toFixed(2)}° orb, ${lead.motionLabel.toLowerCase()}). ${lead.synthesis}`,
      );
    }
    const badge = houseItem
      ? houseItem.factLine
      : `${activeContacts[0].orbDeg.toFixed(2)}° orb · ${activeContacts[0].motionLabel}`;
    const basis = houseItem ? houseItem.symbolismBasis : activeContacts[0].symbolismBasis;
    return {
      heading: 'In these transits',
      factBadge: badge,
      symbolismNote: basis,
      synthesis: parts.join(' '),
      sensitivityNote: reading.mode === 'date-only'
        ? 'Birth time is unknown; natal houses and exact transit timing are omitted.'
        : null,
      reflection: activeContacts[0]?.reflection ?? null,
      citations: [],
    };
  }

  // 2. Transit-to-natal aspect (`AspectFact.id`)
  const aspect = reading.allAspects.find(a => !a.isAngleContact && a.id === key);
  if (aspect) {
    return {
      heading: 'In these transits',
      factBadge: `${aspect.orbDeg.toFixed(2)}° orb · ${aspect.motionLabel} · ${aspectMeta(aspect.aspect).toneLabel}`,
      symbolismNote: aspect.symbolismBasis,
      synthesis: aspect.synthesis,
      sensitivityNote: aspect.approximateDateOnly ? 'Approximate contact (birth time unknown).' : null,
      reflection: aspect.reflection,
      citations: [],
    };
  }

  return null;
}

const TRANSIT_RULE_SET_VERSION = 'u5b-v1';
const TRANSIT_TRADITION = 'Western tropical transit astrology (traditional & modern synthesis; symbolic reflection, not prediction)';

/**
 * Formats local transit synthesis for SnapshotV0.
 * When `redactedSafe: true`, omits timestamps, zones and exact pass dates so redacted exports
 * never leak clock times or calendar epochs.
 */
export function transitSymbolicMeanings(
  reading: TransitReading,
  transitChartId = 'transit',
  natalChartId = 'natal',
  options?: { readonly redactedSafe?: boolean },
): readonly SymbolicMeaning[] {
  if (reading.mode === 'unavailable') return [];
  const redactedSafe = options?.redactedSafe ?? false;
  const entries: SymbolicMeaning[] = [];
  const emit = (factId: string, description: string, sources: readonly SourceId[]) => {
    entries.push({
      factId,
      tradition: TRANSIT_TRADITION,
      ruleSetVersion: TRANSIT_RULE_SET_VERSION,
      description,
      sources: [...sources].sort(),
    });
  };

  const overviewDesc = redactedSafe
    ? (reading.allAspects.length
      ? `Active transit snapshot with ${reading.buckets.longTerm.length} long-term, ${reading.buckets.mediumTerm.length} medium-term and ${reading.buckets.lunarBrief.length} brief lunar contacts. Leading focus: ${reading.allAspects.slice(0, 2).map(a => `${a.title} (${a.orbDeg.toFixed(2)}° orb, ${a.motionLabel.toLowerCase()})`).join(' and ')}.`
      : 'Quiet transit snapshot with no active planetary contacts inside transit orb.')
    : reading.overview.synthesis;

  emit(`${transitChartId}/transit-overview`, overviewDesc, reading.sources);

  for (const aspect of reading.allAspects.slice(0, 12)) {
    if (aspect.approximateDateOnly) continue;
    let factId: string;
    if (aspect.isAngleContact && aspect.target.kind === 'angle') {
      factId = `${transitChartId}/transit-angle/${aspect.target.angle}/${aspect.transitId}/${aspect.aspect}`;
    } else if (aspect.target.kind === 'planet') {
      // Preserve canonical sorted PlanetRef aspectFactId order matching SnapshotV0.aspects
      const aKey = JSON.stringify([transitChartId, aspect.transitId]);
      const bKey = JSON.stringify([natalChartId, aspect.target.planetId]);
      factId = aKey <= bKey
        ? JSON.stringify([transitChartId, aspect.transitId, natalChartId, aspect.target.planetId, aspect.aspect])
        : JSON.stringify([natalChartId, aspect.target.planetId, transitChartId, aspect.transitId, aspect.aspect]);
    } else {
      continue;
    }
    emit(factId, aspect.synthesis, aspect.sources);
  }

  for (const house of reading.houseTransits.slice(0, 6)) {
    emit(`${transitChartId}/transit-house/${house.planetId}`, house.synthesis, house.sources);
  }

  return entries;
}
