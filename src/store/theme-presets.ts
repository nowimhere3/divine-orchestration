import {
  createThemeRegistry,
  normalizeThemePreset,
} from '../knowledge/research-themes';
import type {
  ResearchThemePreset,
  ThemeRegistry,
  ThemeRegistryCustomizations,
} from '../knowledge/research-themes';

export const THEME_PRESETS_STORAGE_KEY = 'divine-orchestration.research-themes.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validPresets(items: unknown, builtIn: boolean): ResearchThemePreset[] {
  if (!Array.isArray(items)) return [];
  const list: ResearchThemePreset[] = [];
  for (const raw of items) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.label !== 'string' || !Array.isArray(raw.houses)) {
      continue;
    }
    try {
      list.push(normalizeThemePreset({
        id: raw.id,
        label: raw.label,
        description: typeof raw.description === 'string' ? raw.description : '',
        conventionNote: typeof raw.conventionNote === 'string' ? raw.conventionNote : undefined,
        houses: raw.houses as ResearchThemePreset['houses'],
        naturalSignificators: Array.isArray(raw.naturalSignificators)
          ? raw.naturalSignificators as ResearchThemePreset['naturalSignificators']
          : [],
        angles: Array.isArray(raw.angles) ? raw.angles as ResearchThemePreset['angles'] : [],
        preferredAspects: Array.isArray(raw.preferredAspects)
          ? raw.preferredAspects as ResearchThemePreset['preferredAspects']
          : undefined,
        sources: Array.isArray(raw.sources) ? raw.sources as ResearchThemePreset['sources'] : undefined,
      }, builtIn));
    } catch {
      // Skip individual malformed presets instead of discarding valid ones.
    }
  }
  return list;
}

/** Loads saved theme overrides and custom presets from localStorage, falling back cleanly on malformed data. */
export function loadThemeRegistry(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): ThemeRegistry {
  if (!storage) return createThemeRegistry();
  try {
    const rawText = storage.getItem(THEME_PRESETS_STORAGE_KEY);
    if (!rawText) return createThemeRegistry();
    const parsed: unknown = JSON.parse(rawText);
    if (!isRecord(parsed) || parsed.version !== 1) return createThemeRegistry();
    const saved: Partial<ThemeRegistryCustomizations> = {
      version: 1,
      overrides: validPresets(parsed.overrides, true),
      custom: validPresets(parsed.custom, false),
    };
    return createThemeRegistry(saved);
  } catch {
    return createThemeRegistry();
  }
}

/** Saves modified built-ins and custom presets to localStorage. Returns false if storage is unavailable. */
export function saveThemeRegistry(
  registry: ThemeRegistry,
  storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null,
): boolean {
  if (!storage) return false;
  try {
    const payload = registry.exportCustomizations();
    storage.setItem(THEME_PRESETS_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Removes saved theme customizations from localStorage safely. */
export function clearSavedThemes(storage: Pick<Storage, 'removeItem'> | null = globalThis.localStorage ?? null): void {
  if (!storage) return;
  try {
    storage.removeItem(THEME_PRESETS_STORAGE_KEY);
  } catch {
    // Storage is optional.
  }
}
