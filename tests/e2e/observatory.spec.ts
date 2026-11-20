import { expect, test } from '@playwright/test';
import { openApp, openBirth } from './helpers';

const openChart = (page: Parameters<typeof openApp>[0]) => openApp(page, 'chart');

test('renders the real natal and transit charts with accessible angle and aspect readings', async ({ page }) => {
  await openChart(page);
  const natal = page.getByRole('table', { name: 'Natal planetary positions' });
  await expect(natal.getByRole('row')).toHaveCount(11);
  await expect(natal.getByRole('row', { name: /Sun/ })).toContainText('Capricorn');
  await expect(page.locator('#wheel [data-layer="transit"]')).toHaveCount(10);
  await expect(page.locator('.wheel-angle')).toHaveText(['ASC', 'MC']);
  await expect(page.locator('.wheel-aspects line').first()).toBeVisible();
  await expect(page.locator('#house-system')).toHaveValue('WholeSign');
  const sun = page.getByRole('button', { name: 'Natal Sun', exact: true });
  await sun.focus();
  await page.keyboard.press('Enter');
  await expect(sun).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#inspection')).toContainText('Natal Sun');
  await expect(page.locator('#inspection')).toContainText('°/day');
  await page.getByRole('button', { name: 'Houses & angles' }).click();
  await expect(page.getByRole('table', { name: 'Whole Sign houses' }).getByRole('row')).toHaveCount(13);
  await expect(page.getByRole('table', { name: 'Natal angles' })).toContainText('Midheaven');
  await page.getByRole('button', { name: 'Aspects', exact: true }).click();
  await page.getByRole('table', { name: 'Natal aspects' }).getByRole('button').first().click();
  await expect(page.locator('#inspection')).toContainText('Exact angle');
  await expect(page.locator('.wheel-highlight line')).toHaveCount(1);
  await expect(page.locator('#wheel [data-aspect-member]')).toHaveCount(2);
});

test('navigates past, present and future and updates positions through the scrubber', async ({ page }) => {
  await openChart(page);
  await page.getByRole('button', { name: 'Transit', exact: true }).click();
  const date = page.getByLabel('Transit date', { exact: true });
  const table = page.getByRole('table', { name: 'Transit planetary positions' });
  const sun = table.getByRole('row', { name: /Sun/ });
  await date.fill('1980-09-01');
  await expect(page.locator('#selected-epoch')).toContainText('1980-09-01');
  const first = await sun.innerText();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('#selected-epoch')).toContainText('1980-09-02');
  await expect(sun).not.toHaveText(first);
  const slider = page.getByRole('slider', { name: /Scrub by day/ });
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(page.locator('#selected-epoch')).toContainText('1980-09-03');
  await expect(slider).toHaveAttribute('aria-valuetext', /^1980-09-03 \d\d:\d\d UTC$/);
  await date.fill('2030-06-15');
  await expect(page.locator('#selected-epoch')).toContainText('2030-06-15');
  await expect(page.locator('#calculation-notes')).toContainText('Future UTC assumes');
  await date.fill('1450-01-01');
  await expect(page.locator('#transit-status')).toContainText('Choose a transit date');
  await expect(page.locator('#selected-epoch')).toContainText('2030-06-15');
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(date).toHaveValue(await page.evaluate(() => new Date().toISOString().slice(0, 10)));
});

test('requires a fold choice and removes natal facts when birth time is unknown', async ({ page }) => {
  await openChart(page);
  await openBirth(page);
  await page.getByLabel('Birth date', { exact: true }).fill('2024-11-03');
  await page.getByLabel('Local birth time').fill('01:30');
  await page.getByLabel('Time zone', { exact: true }).fill('America/New_York');
  const submit = page.getByRole('button', { name: 'Calculate natal chart' });
  await submit.click();
  await expect(page.locator('#birth-status')).toContainText('occurred twice');
  await expect(page.locator('#wheel-caption')).toContainText('2000-01-01');
  const choice = page.getByLabel('Choose birth offset');
  await expect(choice.locator('option')).toHaveCount(3);
  await choice.selectOption('later');
  await submit.click();
  await expect(page.locator('#birth-status')).toContainText('-05:00');
  await expect(page.locator('#wheel-caption')).toContainText('2024-11-03');
  await expect(page.getByRole('dialog')).toBeHidden();
  await openBirth(page);
  await page.getByLabel('Birth time unknown').check();
  await submit.click();
  await expect(page.locator('#wheel-caption')).toContainText('Transit only');
  await expect(page.locator('#wheel [data-layer="natal"]')).toHaveCount(0);
  await expect(page.locator('#wheel [data-layer="transit"]')).toHaveCount(10);
  await expect(page.locator('#wheel .wheel-angle, #wheel [id$="-cusps"]')).toHaveCount(0);
  await expect(page.locator('#data-view')).toContainText('Unknown birth time');
});

test('shows the engine’s polar Placidus fallback and allows a planets-only chart', async ({ page }) => {
  await openChart(page);
  await openBirth(page);
  await page.getByLabel('Latitude', { exact: true }).fill('69.6492');
  await page.getByLabel('Longitude', { exact: true }).fill('18.9553');
  await page.locator('#house-system').selectOption('Placidus');
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.locator('#wheel-caption')).toContainText('Porphyry');
  await expect(page.locator('#calculation-notes')).toContainText('Placidus is undefined');
  await openBirth(page);
  await page.getByLabel('Latitude', { exact: true }).clear();
  await page.getByLabel('Longitude', { exact: true }).clear();
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.locator('#wheel-caption')).toContainText('no houses');
  await expect(page.locator('#wheel [data-layer="natal"]')).toHaveCount(10);
  await expect(page.locator('#wheel .wheel-angle, #wheel [id$="-cusps"]')).toHaveCount(0);
});

test('isolates chart instances, lays out clustered glyphs and disposes listeners', async ({ page }) => {
  await openChart(page);
  const result = await page.evaluate(async ({ adapter, domain }) => {
    const { AstroWheel } = await import(adapter) as typeof import('../../src/view/astro-wheel');
    const { createDateOnlyNatalChart, PLANET_IDS } = await import(domain) as typeof import('../../src/domain/chart');
    const host = document.createElement('div');
    document.body.append(host);
    const natal = createDateOnlyNatalChart({
      id: 'natal', label: null,
      time: { kind: 'unknown-time', input: { date: '2000-01-01', time: null }, calendar: 'proleptic-gregorian' },
      settings: { zodiac: 'tropical', requestedHouseSystem: null, observer: null },
    });
    let calls = 0;
    const wheel = new AstroWheel(host, () => calls++);
    const planet = { longitudeDeg: 29, latitudeDeg: 0, distanceAu: 1, retrograde: false,
      longitudeSpeedDegPerDay: 1, latitudeSpeedDegPerDay: 0, distanceSpeedAuPerDay: 0 };
    const clustered = new Map(PLANET_IDS.map((id, index) => [id, { ...planet, longitudeDeg: 29 + index / 10 }]));
    for (let i = 0; i < 8; i++) wheel.render(natal, new Map(), clustered, []);
    const targets = [...host.querySelectorAll('.planet-target')].map(node => [Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))]);
    const minDistance = Math.min(...targets.flatMap(([x, y], index) =>
      targets.slice(index + 1).map(([a, b]) => Math.hypot(a - x, b - y))));
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    const button = host.querySelector('[data-point-key]')!;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const mount = host.firstElementChild!;
    wheel.dispose();
    mount.append(button);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const remaining = host.children.length;
    host.remove();
    return { unique: ids.length === new Set(ids).size, calls, remaining, minDistance, targets: targets.length };
  }, { adapter: '/src/view/astro-wheel.ts', domain: '/src/domain/chart.ts' });
  expect(result).toMatchObject({ unique: true, calls: 1, remaining: 0, targets: 10 });
  expect(result.minDistance).toBeGreaterThan(29);
});

test('measures scrub redraws and checks touch interaction on a narrow screen', async ({ browser, browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Mobile emulation and timing are measured in Chromium.');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const touch = await mobile.newPage();
    for (const [name, target] of [['desktop', page], ['mobile emulation', touch]] as const) {
      await openChart(target);
      await target.getByRole('button', { name: 'Transit', exact: true }).click();
      const metrics = await target.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>('#timeline')!;
        const render: number[] = [];
        const frames: number[] = [];
        for (let i = 1; i <= 24; i++) {
          const began = performance.now();
          input.value = String(i);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          frames.push(performance.now() - began);
          render.push(performance.getEntriesByName('divine-orchestration:redraw')[0].duration);
        }
        const stats = (values: number[]) => {
          values.sort((a, b) => a - b);
          return { p50: values[11], p95: values[22] };
        };
        return { render: stats(render), twoFrames: stats(frames) };
      });
      console.log(`${name} scrub timing (ms): ${JSON.stringify(metrics)}`);
      expect(metrics.render.p95).toBeLessThan(120);
      expect(metrics.twoFrames.p95).toBeLessThan(250);
    }
    await touch.getByRole('button', { name: 'Natal Sun', exact: true }).tap();
    await expect(touch.locator('#inspection')).toContainText('Natal Sun');
    await expect(touch.getByRole('button', { name: 'Natal Sun', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const hasOverflow = await touch.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasOverflow).toBe(false);
  } finally {
    await mobile.close();
  }
});
