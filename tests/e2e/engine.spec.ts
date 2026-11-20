import { expect, test } from '@playwright/test';

test('loads the bundled Ephemera WASM and calculates the J2000 Sun', async ({ page }) => {
  const wasmResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith('/ephemeris-1as.wasm') && response.ok(),
  );
  await page.goto('/tests/e2e/fixtures/engine.html');
  await wasmResponse;
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-engine-result', /"status":"ok"/);
  const result = JSON.parse((await body.getAttribute('data-engine-result'))!);
  expect(result.engine).toMatchObject({ version: '0.4.1', dataMode: '1as' });
  expect(Math.abs(result.value.longitude - 280.3681519) * 3600).toBeLessThan(1);
});
