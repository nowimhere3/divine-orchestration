import type { Observer } from '../engine/ephemera';
import type { NatalProfile } from '../store/library';

export const OBSERVING_LOCATION_STORAGE_KEY = 'divine-orchestration.observer.v1';

export type ObserverPresetId = 'calgary' | 'edmonton';

export interface ObserverPreset {
  readonly id: ObserverPresetId;
  readonly name: string;
  readonly label: string;
  readonly observer: Observer;
}

export const OBSERVER_PRESETS: Readonly<Record<ObserverPresetId, ObserverPreset>> = {
  calgary: {
    id: 'calgary',
    name: 'Calgary, Alberta',
    label: 'Calgary, Alberta (51.04°N, 114.07°W)',
    observer: { latitudeDeg: 51.0447, longitudeDeg: -114.0719 },
  },
  edmonton: {
    id: 'edmonton',
    name: 'Edmonton, Alberta',
    label: 'Edmonton, Alberta (53.55°N, 113.49°W)',
    observer: { latitudeDeg: 53.5461, longitudeDeg: -113.4938 },
  },
};

export type ObservingLocation =
  | { readonly mode: 'none' }
  | { readonly mode: 'preset'; readonly presetId: ObserverPresetId }
  | { readonly mode: 'profile'; readonly profileId: string }
  | { readonly mode: 'manual'; readonly observer: Observer };

export function formatObserverCoordinates(observer: Observer): string {
  const latDir = observer.latitudeDeg < 0 ? 'S' : 'N';
  const lonDir = observer.longitudeDeg < 0 ? 'W' : 'E';
  return `${Math.abs(observer.latitudeDeg).toFixed(2)}°${latDir}, ${Math.abs(observer.longitudeDeg).toFixed(2)}°${lonDir}`;
}

export function isValidObserverCoordinates(latitudeDeg: number, longitudeDeg: number): boolean {
  return (
    Number.isFinite(latitudeDeg) &&
    Math.abs(latitudeDeg) <= 90 &&
    Number.isFinite(longitudeDeg) &&
    Math.abs(longitudeDeg) <= 180
  );
}

export function loadObservingLocation(storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): ObservingLocation {
  if (!storage) return { mode: 'none' };
  try {
    const raw = storage.getItem(OBSERVING_LOCATION_STORAGE_KEY);
    if (!raw) return { mode: 'none' };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return { mode: 'none' };
    if (parsed.mode === 'none') return { mode: 'none' };
    if (parsed.mode === 'preset' && (parsed.presetId === 'calgary' || parsed.presetId === 'edmonton')) {
      return { mode: 'preset', presetId: parsed.presetId };
    }
    if (parsed.mode === 'profile' && typeof parsed.profileId === 'string' && parsed.profileId.trim()) {
      return { mode: 'profile', profileId: parsed.profileId.trim() };
    }
    if (parsed.mode === 'manual' && parsed.observer && typeof parsed.observer === 'object') {
      const obs = parsed.observer as Record<string, unknown>;
      const lat = Number(obs.latitudeDeg);
      const lon = Number(obs.longitudeDeg);
      if (isValidObserverCoordinates(lat, lon)) {
        return { mode: 'manual', observer: { latitudeDeg: lat, longitudeDeg: lon } };
      }
    }
  } catch {
    /* Fall back to geocentric default when storage is unavailable or malformed. */
  }
  return { mode: 'none' };
}

export function saveObservingLocation(
  location: ObservingLocation,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(OBSERVING_LOCATION_STORAGE_KEY, JSON.stringify(location));
  } catch {
    /* Storage is optional. */
  }
}

export interface ResolvedObservingLocation {
  readonly effective: ObservingLocation;
  readonly observer: Observer | null;
  readonly shortLabel: string;
  readonly fullLabel: string;
  readonly fallbackNotice: string | null;
}

/**
 * Resolves the active observing location against the current list of saved profiles.
 * Degrades gracefully to mode: 'none' (geocentric only) if a chosen profile was deleted
 * or has no stored birthplace coordinates. Never silently reuses demo coordinates.
 */
export function resolveObservingLocation(
  location: ObservingLocation,
  profiles: readonly NatalProfile[],
): ResolvedObservingLocation {
  switch (location.mode) {
    case 'none':
      return {
        effective: { mode: 'none' },
        observer: null,
        shortLabel: 'Geocentric only',
        fullLabel: 'No observer location selected (geocentric only)',
        fallbackNotice: null,
      };
    case 'preset': {
      const preset = OBSERVER_PRESETS[location.presetId];
      return {
        effective: location,
        observer: preset.observer,
        shortLabel: preset.name,
        fullLabel: preset.label,
        fallbackNotice: null,
      };
    }
    case 'manual': {
      const coords = formatObserverCoordinates(location.observer);
      return {
        effective: location,
        observer: location.observer,
        shortLabel: `Manual (${coords})`,
        fullLabel: `Manual coordinates (${coords})`,
        fallbackNotice: null,
      };
    }
    case 'profile': {
      const profile = profiles.find(p => p.id === location.profileId);
      if (!profile) {
        return {
          effective: { mode: 'none' },
          observer: null,
          shortLabel: 'Geocentric only',
          fullLabel: 'No observer location selected (geocentric only)',
          fallbackNotice: 'The selected saved profile was deleted. Reverted to geocentric view.',
        };
      }
      if (!profile.observer) {
        return {
          effective: { mode: 'none' },
          observer: null,
          shortLabel: 'Geocentric only',
          fullLabel: 'No observer location selected (geocentric only)',
          fallbackNotice: `Saved profile “${profile.name}” has no birthplace coordinates. Reverted to geocentric view.`,
        };
      }
      const coords = formatObserverCoordinates(profile.observer);
      return {
        effective: location,
        observer: profile.observer,
        shortLabel: `${profile.name} birthplace`,
        fullLabel: `Birthplace · ${profile.name} (${coords})`,
        fallbackNotice: null,
      };
    }
  }
}
