import type { AspectId } from '../domain/aspects';
import { MAJOR_ASPECT_ANGLES } from '../domain/aspects';
import { PLANET_IDS } from '../domain/chart';
import type { HouseId, PlanetId } from '../domain/chart';
import { HOUSE_META } from './houses';
import type { HouseMeta } from './houses';
import type { SourceId } from './types';

export const RESEARCH_THEME_RULE_SET_VERSION = 'u6-themes-v1' as const;

export const ALL_HOUSE_IDS: readonly HouseId[] = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
]);

export type ResearchAngleId = 'asc' | 'mc' | 'dsc' | 'ic';

export const ALL_RESEARCH_ANGLES: readonly ResearchAngleId[] = Object.freeze([
  'asc', 'mc', 'dsc', 'ic',
]);

export const ALL_ASPECT_IDS: readonly AspectId[] = Object.freeze(
  Object.keys(MAJOR_ASPECT_ANGLES) as AspectId[],
);

export const THEME_CONVENTION_DISCLAIMER =
  'Theme-to-house and planetary groupings are editable astrological conventions, not astronomical calculations.';

export interface ResearchThemePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly conventionNote: string;
  readonly builtIn: boolean;
  readonly houses: readonly HouseId[];
  readonly naturalSignificators: readonly PlanetId[];
  readonly angles: readonly ResearchAngleId[];
  readonly preferredAspects?: readonly AspectId[];
  readonly sources: readonly SourceId[];
}

export interface HouseAreaDescriptor {
  readonly id: `house/${HouseId}`;
  readonly houseId: HouseId;
  readonly label: string;
  readonly tagline: string;
  readonly group: HouseMeta['group'];
  readonly topics: string;
  readonly arenaPhrase: string;
  readonly oppositeHouse: HouseId;
  readonly axisAngle: ResearchAngleId | null;
  readonly sources: readonly SourceId[];
}

const HOUSE_AXIS_ANGLES: Readonly<Partial<Record<HouseId, ResearchAngleId>>> = Object.freeze({
  1: 'asc',
  4: 'ic',
  7: 'dsc',
  10: 'mc',
});

const HOUSE_SOURCES: readonly SourceId[] = Object.freeze([
  'wiki-house', 'lilly', 'ptolemy', 'britannica-astrology',
]);

/** Every one of the 12 houses as an individually selectable research area. */
export const HOUSE_AREA_DESCRIPTORS: readonly HouseAreaDescriptor[] = Object.freeze(
  HOUSE_META.map(meta => Object.freeze({
    id: `house/${meta.number}` as const,
    houseId: meta.number,
    label: `House ${meta.number} · ${meta.tagline}`,
    tagline: meta.tagline,
    group: meta.group,
    topics: meta.topics,
    arenaPhrase: meta.arenaPhrase,
    oppositeHouse: meta.oppositeHouse,
    axisAngle: HOUSE_AXIS_ANGLES[meta.number] ?? null,
    sources: HOUSE_SOURCES,
  })),
);

export function houseAreaDescriptor(houseId: HouseId): HouseAreaDescriptor {
  return HOUSE_AREA_DESCRIPTORS[houseId - 1];
}

interface BuiltInThemeSeed {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly houses: readonly HouseId[];
  readonly naturalSignificators: readonly PlanetId[];
  readonly angles: readonly ResearchAngleId[];
  readonly sources: readonly SourceId[];
}

const BUILT_IN_THEME_SEEDS: readonly BuiltInThemeSeed[] = [
  {
    id: 'project-development',
    label: 'Project Development',
    description: 'Planning, creative building, daily craft and visible deliverables.',
    houses: [3, 5, 6, 10],
    naturalSignificators: ['mercury', 'mars', 'saturn'],
    angles: ['mc'],
    sources: ['wiki-house', 'lilly', 'wiki-planets-astrology'],
  },
  {
    id: 'entrepreneurship',
    label: 'Entrepreneurship & Vocation',
    description: 'Self-initiated ventures, livelihood, operations, public standing and networks.',
    houses: [1, 2, 6, 10, 11],
    naturalSignificators: ['sun', 'mars', 'jupiter', 'saturn'],
    angles: ['asc', 'mc'],
    sources: ['wiki-house', 'lilly', 'wiki-midheaven', 'wiki-ascendant'],
  },
  {
    id: 'finances',
    label: 'Finances & Resources',
    description: 'Personal income, material stability, shared obligations, debts and capital.',
    houses: [2, 8],
    naturalSignificators: ['venus', 'jupiter', 'saturn', 'pluto'],
    angles: [],
    sources: ['wiki-house', 'lilly', 'ptolemy'],
  },
  {
    id: 'identity-growth',
    label: 'Identity & Personal Growth',
    description: 'Self-direction, worldview expansion, reinvention and life trajectory.',
    houses: [1, 9, 10],
    naturalSignificators: ['sun', 'jupiter', 'uranus', 'pluto'],
    angles: ['asc', 'mc'],
    sources: ['wiki-house', 'wiki-ascendant', 'ptolemy'],
  },
  {
    id: 'emotional-growth',
    label: 'Emotional Growth & Inner Foundations',
    description: 'Private roots, vulnerability, deep inner transitions, rest and integration.',
    houses: [4, 8, 12],
    naturalSignificators: ['moon', 'venus', 'neptune', 'pluto'],
    angles: ['ic'],
    sources: ['wiki-house', 'lilly', 'wiki-planets-astrology'],
  },
  {
    id: 'relationships',
    label: 'Relationships & Partnerships',
    description: 'Romance, committed one-to-one partnerships, collaboration and friendships.',
    houses: [5, 7, 11],
    naturalSignificators: ['venus', 'mars', 'moon'],
    angles: ['dsc'],
    sources: ['wiki-house', 'lilly', 'ptolemy'],
  },
  {
    id: 'health-routines',
    label: 'Daily Routines & Wellbeing',
    description: 'Vitality, daily habits, practical service, recovery and restorative pacing.',
    houses: [1, 6, 12],
    naturalSignificators: ['sun', 'moon', 'mercury', 'mars', 'saturn'],
    angles: ['asc'],
    sources: ['wiki-house', 'lilly', 'britannica-astrology'],
  },
  {
    id: 'learning-horizons',
    label: 'Learning, Study & Horizons',
    description: 'Everyday study, writing, travel, higher learning, teaching and publishing.',
    houses: [3, 9],
    naturalSignificators: ['mercury', 'jupiter'],
    angles: [],
    sources: ['wiki-house', 'lilly', 'ptolemy'],
  },
  {
    id: 'home-family',
    label: 'Home, Roots & Family',
    description: 'Living environment, family foundations, ancestry and private anchors.',
    houses: [4],
    naturalSignificators: ['moon', 'venus', 'saturn'],
    angles: ['ic'],
    sources: ['wiki-house', 'lilly', 'britannica-astrology'],
  },
  {
    id: 'community-future',
    label: 'Community & Future Aims',
    description: 'Groups, alliances, shared causes, audiences and long-range hopes.',
    houses: [11],
    naturalSignificators: ['uranus', 'jupiter', 'saturn'],
    angles: [],
    sources: ['wiki-house', 'lilly', 'wiki-planets-astrology'],
  },
];

export const BUILT_IN_RESEARCH_THEMES: readonly ResearchThemePreset[] = Object.freeze(
  BUILT_IN_THEME_SEEDS.map(seed => Object.freeze({
    ...seed,
    conventionNote: THEME_CONVENTION_DISCLAIMER,
    builtIn: true,
    houses: Object.freeze([...seed.houses]),
    naturalSignificators: Object.freeze([...seed.naturalSignificators]),
    angles: Object.freeze([...seed.angles]),
    sources: Object.freeze([...seed.sources]),
  })),
);

const BUILT_IN_BY_ID = new Map<string, ResearchThemePreset>(
  BUILT_IN_RESEARCH_THEMES.map(preset => [preset.id, preset]),
);

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_CUSTOM_THEMES = 50;

export interface ThemePresetInput {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly conventionNote?: string;
  readonly houses: readonly HouseId[];
  readonly naturalSignificators?: readonly PlanetId[];
  readonly angles?: readonly ResearchAngleId[];
  readonly preferredAspects?: readonly AspectId[];
  readonly sources?: readonly SourceId[];
}

function dedupeOrdered<T>(values: readonly T[], canonical: readonly T[], label: string): readonly T[] {
  const seen = new Set<T>();
  for (const item of values) {
    if (!canonical.includes(item)) {
      throw new RangeError(`Theme contains unsupported ${label}: ${String(item)}.`);
    }
    seen.add(item);
  }
  return Object.freeze(canonical.filter(item => seen.has(item)));
}

export function normalizeThemePreset(input: ThemePresetInput, builtIn = false): ResearchThemePreset {
  const id = input.id.trim().toLowerCase();
  if (!THEME_ID_PATTERN.test(id)) {
    throw new RangeError('Theme ID must be 1–64 lowercase letters, digits or hyphens.');
  }
  const label = input.label.trim();
  if (!label || label.length > 80 || /[\u0000-\u001f]/.test(label)) {
    throw new RangeError('Theme label must be 1–80 printable characters.');
  }
  const description = (input.description ?? '').trim().slice(0, 300);
  const houses = dedupeOrdered(input.houses, ALL_HOUSE_IDS, 'house');
  const naturalSignificators = dedupeOrdered(input.naturalSignificators ?? [], PLANET_IDS, 'planet');
  const angles = dedupeOrdered(input.angles ?? [], ALL_RESEARCH_ANGLES, 'angle');
  const preferredAspects = input.preferredAspects !== undefined
    ? dedupeOrdered(input.preferredAspects, ALL_ASPECT_IDS, 'aspect')
    : undefined;
  if (!houses.length && !naturalSignificators.length && !angles.length) {
    throw new RangeError('Theme must include at least one house, planet significator or angle.');
  }
  if (preferredAspects !== undefined && !preferredAspects.length) {
    throw new RangeError('Theme preferredAspects cannot be empty when specified.');
  }
  const sources = input.sources ? Object.freeze([...new Set(input.sources)]) : HOUSE_SOURCES;

  return Object.freeze({
    id,
    label,
    description,
    conventionNote: input.conventionNote?.trim() || THEME_CONVENTION_DISCLAIMER,
    builtIn,
    houses,
    naturalSignificators,
    angles,
    ...(preferredAspects ? { preferredAspects } : {}),
    sources,
  });
}

export interface ThemeRegistryCustomizations {
  readonly version: 1;
  readonly overrides: readonly ResearchThemePreset[];
  readonly custom: readonly ResearchThemePreset[];
}

export interface ThemeRegistry {
  readonly ruleSetVersion: typeof RESEARCH_THEME_RULE_SET_VERSION;
  list(): readonly ResearchThemePreset[];
  get(id: string): ResearchThemePreset | undefined;
  isBuiltIn(id: string): boolean;
  isModifiedBuiltIn(id: string): boolean;
  upsert(input: ThemePresetInput): ThemeRegistry;
  remove(id: string): ThemeRegistry;
  resetBuiltIn(id: string): ThemeRegistry;
  resetAllBuiltIns(): ThemeRegistry;
  exportCustomizations(): ThemeRegistryCustomizations;
}

function buildRegistry(
  overrides: ReadonlyMap<string, ResearchThemePreset>,
  custom: ReadonlyMap<string, ResearchThemePreset>,
): ThemeRegistry {
  const orderedList = (): readonly ResearchThemePreset[] => Object.freeze([
    ...BUILT_IN_RESEARCH_THEMES.map(preset => overrides.get(preset.id) ?? preset),
    ...[...custom.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
  ]);

  return Object.freeze({
    ruleSetVersion: RESEARCH_THEME_RULE_SET_VERSION,
    list: orderedList,
    get(id: string) {
      return overrides.get(id) ?? BUILT_IN_BY_ID.get(id) ?? custom.get(id);
    },
    isBuiltIn(id: string) {
      return BUILT_IN_BY_ID.has(id);
    },
    isModifiedBuiltIn(id: string) {
      return overrides.has(id);
    },
    upsert(input: ThemePresetInput) {
      const normalizedId = input.id.trim().toLowerCase();
      const isDefault = BUILT_IN_BY_ID.has(normalizedId);
      const preset = normalizeThemePreset(input, isDefault);
      if (isDefault) {
        const nextOverrides = new Map(overrides);
        nextOverrides.set(preset.id, preset);
        return buildRegistry(nextOverrides, custom);
      }
      if (!custom.has(preset.id) && custom.size >= MAX_CUSTOM_THEMES) {
        throw new RangeError(`At most ${MAX_CUSTOM_THEMES} custom themes are supported.`);
      }
      const nextCustom = new Map(custom);
      nextCustom.set(preset.id, preset);
      return buildRegistry(overrides, nextCustom);
    },
    remove(id: string) {
      if (BUILT_IN_BY_ID.has(id)) {
        if (!overrides.has(id)) return this;
        const nextOverrides = new Map(overrides);
        nextOverrides.delete(id);
        return buildRegistry(nextOverrides, custom);
      }
      if (!custom.has(id)) return this;
      const nextCustom = new Map(custom);
      nextCustom.delete(id);
      return buildRegistry(overrides, nextCustom);
    },
    resetBuiltIn(id: string) {
      if (!overrides.has(id)) return this;
      const nextOverrides = new Map(overrides);
      nextOverrides.delete(id);
      return buildRegistry(nextOverrides, custom);
    },
    resetAllBuiltIns() {
      if (!overrides.size) return this;
      return buildRegistry(new Map(), custom);
    },
    exportCustomizations() {
      return Object.freeze({
        version: 1 as const,
        overrides: Object.freeze([...overrides.values()].sort((a, b) => a.id.localeCompare(b.id))),
        custom: Object.freeze([...custom.values()].sort((a, b) => a.id.localeCompare(b.id))),
      });
    },
  });
}

/** Creates an editable, immutable ThemeRegistry preloaded with built-in themes and optional saved customizations. */
export function createThemeRegistry(saved?: Partial<ThemeRegistryCustomizations>): ThemeRegistry {
  let registry = buildRegistry(new Map(), new Map());
  if (saved?.overrides) {
    for (const item of saved.overrides) {
      if (BUILT_IN_BY_ID.has(item.id.trim().toLowerCase())) {
        registry = registry.upsert(item);
      }
    }
  }
  if (saved?.custom) {
    for (const item of saved.custom) {
      if (!BUILT_IN_BY_ID.has(item.id.trim().toLowerCase())) {
        registry = registry.upsert(item);
      }
    }
  }
  return registry;
}
