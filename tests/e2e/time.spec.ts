import { expect, test } from '@playwright/test';

test('resolves a fold with the Vite browser time and engine modules', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ timeModule, engineModule }) => {
    const { resolveBirthTime } = await import(timeModule) as typeof import('../../src/time/resolve');
    const { loadBrowserEphemeraEngine } = await import(engineModule) as typeof import('../../src/engine/browser');
    const engine = await loadBrowserEphemeraEngine();
    const input = { date: '2024-11-03', time: '01:30', timeZone: 'America/New_York' };
    return {
      unresolved: resolveBirthTime(input, engine.modelDeltaTSeconds),
      resolved: resolveBirthTime({ ...input, disambiguation: 'later' }, engine.modelDeltaTSeconds),
    };
  }, { timeModule: '/src/time/resolve.ts', engineModule: '/src/engine/browser.ts' });
  expect(result.unresolved).toMatchObject({ reason: 'ambiguous-wall-time' });
  expect(result.resolved).toMatchObject({
    kind: 'resolved', utc: '2024-11-03T06:30:00.000Z', offset: { foldChoice: 'later' },
  });
});
