import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('declares a valid web app manifest and PNG icons including maskable', async ({ page }) => {
  await openApp(page);
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();

  const manifestUrl = new URL(manifestHref!, page.url()).toString();
  const manifestRes = await page.request.get(manifestUrl);
  expect(manifestRes.ok()).toBe(true);

  const manifest = await manifestRes.json();
  expect(manifest.name).toBe('Divine Orchestration');
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.id).toBeTruthy();
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#0b0a14');
  expect(manifest.background_color).toBe('#0b0a14');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

  const has192 = manifest.icons.some((icon: { sizes: string; purpose?: string }) => icon.sizes === '192x192' && (!icon.purpose || icon.purpose.includes('any')));
  const has512 = manifest.icons.some((icon: { sizes: string; purpose?: string }) => icon.sizes === '512x512' && (!icon.purpose || icon.purpose.includes('any')));
  const hasMaskable = manifest.icons.some((icon: { sizes: string; purpose?: string }) => icon.sizes === '512x512' && icon.purpose?.includes('maskable'));
  expect(has192).toBe(true);
  expect(has512).toBe(true);
  expect(hasMaskable).toBe(true);

  for (const icon of manifest.icons) {
    const res = await page.request.get(new URL(icon.src, manifestUrl).toString());
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('image/png');
  }

  const appleIconHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(appleIconHref).toBeTruthy();
  const appleRes = await page.request.get(new URL(appleIconHref!, page.url()).toString());
  expect(appleRes.ok()).toBe(true);
});

test('passes Chromium manifest parsing and installability checks without service worker', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP manifest and installability diagnostics are Chromium-only.');
  await openApp(page);
  const cdp = await page.context().newCDPSession(page);
  const manifestInfo = await cdp.send('Page.getAppManifest');
  expect(manifestInfo.errors).toEqual([]);
  expect(manifestInfo.data).toBeTruthy();
  const parsed = JSON.parse(manifestInfo.data!);
  expect(parsed.short_name).toBe('Divine Orch');
  expect(parsed.display).toBe('standalone');

  const installability = await cdp.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
});

test('preserves direct Learn hash links and normal browser operation', async ({ page }) => {
  await page.goto('/#learn/body/saturn');
  await expect(page.locator('#view-learn')).toBeVisible();
  await expect(page.locator('#learn-root')).toContainText('Saturn');
});
