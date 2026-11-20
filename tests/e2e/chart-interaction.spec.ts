import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

async function openAt(page: Parameters<typeof openApp>[0], date: string) {
  await openApp(page);
  await page.getByLabel('Transit date', { exact: true }).fill(date);
  await expect(page.locator('#selected-epoch')).toContainText(date);
}

test('selecting a planet highlights its aspects, marks partners and dims everything else', async ({ page }) => {
  await openAt(page, '2024-04-15');
  const base = page.locator('.wheel-aspects');
  const baseOpacity = () => base.evaluate(node => Number(getComputedStyle(node).opacity));
  const idle = await baseOpacity();
  await expect(page.locator('#wheel')).toHaveAttribute('data-selection', '');
  await expect(page.locator('.wheel-related')).toHaveCount(0);

  await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
  await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'planet');
  const relations = await page.locator('#inspection .relation').count();
  expect(relations).toBeGreaterThan(0);
  await expect(page.locator('#wheel .wheel-related')).toHaveCount(relations);
  await expect(page.locator('#wheel [data-point-key][data-related]')).toHaveCount(relations);
  await expect(page.locator('#wheel [data-point-key][aria-pressed="true"]')).toHaveCount(1);
  // Each highlighted line carries its aspect so teal/rose and dash styles can apply.
  const names = await page.locator('#wheel .wheel-related').evaluateAll(lines => lines.map(line => line.getAttribute('data-name')));
  expect(names.every(name => ['conjunction', 'sextile', 'square', 'trine', 'opposition'].includes(name!))).toBe(true);
  await expect.poll(baseOpacity).toBeLessThan(idle / 2);
  // Unrelated glyphs recede but stay readable.
  const faded = await page.locator('#wheel [data-point-key]:not([aria-pressed="true"]):not([data-related])').first()
    .evaluate(node => Number(getComputedStyle(node).opacity));
  expect(faded).toBeGreaterThanOrEqual(0.5);
  expect(faded).toBeLessThan(1);
});

test('aspect colors and line styles separate supportive from tense contacts', async ({ page }) => {
  await openAt(page, '2024-04-15');
  await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
  const lines = await page.locator('#wheel .wheel-related').evaluateAll(nodes => nodes.map(node => ({
    name: node.getAttribute('data-name'), stroke: getComputedStyle(node).stroke, dash: getComputedStyle(node).strokeDasharray,
  })));
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) {
    if (line.name === 'trine' || line.name === 'sextile') expect(line.stroke).toBe('rgb(127, 214, 194)');
    if (line.name === 'square' || line.name === 'opposition') expect(line.stroke).toBe('rgb(240, 139, 160)');
    if (line.name === 'sextile') expect(line.dash).not.toBe('none');
    if (line.name === 'opposition') expect(line.dash).not.toBe('none');
    if (line.name === 'trine' || line.name === 'square') expect(line.dash).toBe('none');
  }
});

test('the inspector lists relationships, jumps to an aspect and back to its planets', async ({ page }) => {
  await openAt(page, '2024-04-15');
  const inspection = page.locator('#inspection');
  await expect(inspection).toContainText('Select a planet or aspect');
  await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
  await expect(inspection).toContainText('Natal Sun');
  await expect(inspection).toContainText('°/day');
  await expect(inspection.locator('.sign-mark')).toBeVisible();
  const first = inspection.locator('.relation').first();
  const label = await first.getAttribute('aria-label');
  await first.click();
  await expect(inspection).toContainText('Exact angle');
  await expect(inspection.locator('.orb-meter')).toBeVisible();
  await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'aspect');
  await expect(page.locator('#wheel .wheel-focus')).toHaveCount(1);
  await expect(page.locator('#wheel [data-aspect-member]')).toHaveCount(2);
  await expect(page.locator('#wheel .wheel-related')).toHaveCount(0);
  expect(label).toMatch(/^\w+ to (Natal|Transit) \w+ .+ orb · (Blending|Supportive|Tense)$/);
  // Keyboard focus moves to the new heading instead of being lost with the clicked button.
  await expect(inspection.locator('.inspect-title')).toBeFocused();

  await inspection.locator('.pair-end').first().click();
  await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'planet');
  await expect(page.locator('#wheel [data-point-key][aria-pressed="true"]')).toHaveCount(1);
  await expect(inspection).not.toContainText('Exact angle');
});

test('relationships are reachable by keyboard and survive Time Machine redraws', async ({ page }) => {
  await openAt(page, '2024-04-15');
  await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
  const relation = page.locator('#inspection .relation').first();
  await relation.focus();
  const before = await page.locator('#wheel').innerHTML();
  // A scrub redraws the inspector and the wheel while focus is inside the inspector.
  await page.locator('#timeline').evaluate(node => {
    const slider = node as HTMLInputElement;
    slider.value = String(Number(slider.value) + 1);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#selected-epoch')).toContainText('2024-04-16');
  await expect(page.locator('#inspection .relation').first()).toBeFocused();
  await expect(page.locator('#wheel [data-point-key][aria-pressed="true"]')).toHaveCount(1);
  expect(await page.locator('#wheel').innerHTML()).not.toBe(before);
  await page.keyboard.press('Enter');
  await expect(page.locator('#inspection')).toContainText('Exact angle');
  await expect(page.locator('#inspection .inspect-title')).toBeFocused();
});

test('no outer glyph or target is clipped by the wheel frame across many dates', async ({ page }) => {
  await openApp(page);
  const margins: number[] = [];
  for (const date of ['1990-05-05', '2000-02-02', '2012-12-21', '2024-01-01', '2024-06-21', '2026-11-19', '2030-08-08', '2100-03-03']) {
    await page.getByLabel('Transit date', { exact: true }).fill(date);
    await expect(page.locator('#selected-epoch')).toContainText(date);
    margins.push(await page.evaluate(() => {
      const svg = document.querySelector<SVGSVGElement>('#wheel svg')!;
      const frame = svg.getBoundingClientRect();
      const scale = frame.width / svg.viewBox.baseVal.width;
      let min = Infinity;
      for (const glyph of document.querySelectorAll('#wheel [data-point-key]')) {
        const box = glyph.getBoundingClientRect();
        min = Math.min(min, (box.left - frame.left) / scale, (box.top - frame.top) / scale,
          (frame.right - box.right) / scale, (frame.bottom - box.bottom) / scale);
      }
      return min;
    }));
  }
  expect(Math.min(...margins)).toBeGreaterThan(2);
  const overflow = await page.locator('#wheel svg').evaluate(node => getComputedStyle(node).overflow);
  expect(overflow).toBe('visible');
});

test('redraws stay stable: no duplicated layers, unique ids, one highlight group', async ({ page }) => {
  await openAt(page, '2024-04-15');
  await page.getByRole('button', { name: 'Natal Mercury', exact: true }).click();
  const before = await page.evaluate(() => ({
    tracks: document.querySelectorAll('#wheel .wheel-track').length,
    svgs: document.querySelectorAll('#wheel svg').length,
    groups: document.querySelectorAll('#wheel .wheel-highlight').length,
  }));
  expect(before).toEqual({ tracks: 2, svgs: 1, groups: 1 });
  for (let day = 16; day <= 24; day++) {
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.locator('#selected-epoch')).toContainText(`2024-04-${day}`);
  }
  const after = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    return {
      tracks: document.querySelectorAll('#wheel .wheel-track').length,
      svgs: document.querySelectorAll('#wheel svg').length,
      groups: document.querySelectorAll('#wheel .wheel-highlight').length,
      transit: document.querySelectorAll('#wheel [data-layer="transit"]').length,
      natal: document.querySelectorAll('#wheel [data-layer="natal"]').length,
      unique: ids.length === new Set(ids).size,
    };
  });
  expect(after).toEqual({ tracks: 2, svgs: 1, groups: 1, transit: 10, natal: 10, unique: true });
  await expect(page.locator('#wheel [data-point-key][aria-pressed="true"]')).toHaveCount(1);
});

test('motion is skipped when the user prefers reduced motion', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await openApp(page);
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    const lineAnimation = await page.locator('#wheel .wheel-related').first().evaluate(node => getComputedStyle(node).animationName);
    expect(lineAnimation).toBe('none');
    const viewAnimation = await page.locator('#view-chart').evaluate(node => getComputedStyle(node).animationName);
    expect(viewAnimation).toBe('none');
  } finally {
    await context.close();
  }
});

test('lights the wheel with motion enabled by default', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
  const names = await page.locator('#wheel .wheel-related').first().evaluate(node => getComputedStyle(node).animationName);
  expect(names).toBe('line-in');
});
