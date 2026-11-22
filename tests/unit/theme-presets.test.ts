import { describe, expect, test } from 'vitest';
import {
  clearSavedThemes,
  loadThemeRegistry,
  saveThemeRegistry,
  THEME_PRESETS_STORAGE_KEY,
} from '../../src/store/theme-presets';
import { createThemeRegistry } from '../../src/research';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    raw: map,
  };
}

describe('theme-presets localStorage helper', () => {
  test('saves and restores built-in overrides and custom presets', () => {
    const storage = memoryStorage();
    const modified = createThemeRegistry()
      .upsert({
        id: 'finances',
        label: 'Finances & Cash Flow',
        description: 'Added House 6 earned income.',
        houses: [2, 6, 8],
        naturalSignificators: ['venus', 'jupiter', 'saturn'],
      })
      .upsert({
        id: 'custom-launch',
        label: 'Creative Launch',
        description: 'Custom launch preset.',
        houses: [5, 10, 11],
        naturalSignificators: ['sun', 'mercury'],
        angles: ['mc'],
      });

    expect(saveThemeRegistry(modified, storage)).toBe(true);
    const restored = loadThemeRegistry(storage);
    expect(restored.isModifiedBuiltIn('finances')).toBe(true);
    expect(restored.get('finances')?.houses).toEqual([2, 6, 8]);
    expect(restored.get('custom-launch')?.label).toBe('Creative Launch');
    expect(restored.get('custom-launch')?.angles).toEqual(['mc']);

    clearSavedThemes(storage);
    const reset = loadThemeRegistry(storage);
    expect(reset.isModifiedBuiltIn('finances')).toBe(false);
    expect(reset.get('custom-launch')).toBeUndefined();
  });

  test('skips individually malformed entries and recovers cleanly from corrupt JSON', () => {
    const storage = memoryStorage();
    storage.setItem(THEME_PRESETS_STORAGE_KEY, '{not valid json');
    expect(loadThemeRegistry(storage).list().length).toBeGreaterThanOrEqual(10);

    storage.setItem(THEME_PRESETS_STORAGE_KEY, JSON.stringify({
      version: 1,
      overrides: [{ id: 'finances', label: '', houses: [] }], // invalid
      custom: [
        { id: 'BAD ID', label: 'Invalid', houses: [1] },     // invalid
        { id: 'custom-good', label: 'Good Theme', houses: [3, 9], naturalSignificators: ['mercury'] },
      ],
    }));

    const recovered = loadThemeRegistry(storage);
    expect(recovered.get('finances')?.houses).toEqual([2, 8]);
    expect(recovered.get('custom-good')?.label).toBe('Good Theme');
    expect(recovered.get('BAD ID')).toBeUndefined();
  });
});
