import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { openApp, openBirth } from './helpers';

const tip = (page: Page) => page.locator('.wheel-tip');
const inspection = (page: Page) => page.locator('#inspection');
const title = (page: Page) => page.locator('#inspection .inspect-title');
const element = (page: Page, key: string) => page.locator(`#wheel [data-element-key="${key}"]`);

/**
 * A client point that really lands on the shape: inside it and not under a planet glyph or another control.
 * The search starts at the shape's middle and works outward, so a real mouse or finger can be aimed at it.
 */
async function pointIn(locator: Locator) {
  return locator.evaluate(node => {
    const shape = node as unknown as SVGGeometryElement;
    const matrix = shape.getScreenCTM()!;
    const svg = shape.ownerSVGElement!;
    const toClient = (x: number, y: number) => {
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      const client = point.matrixTransform(matrix);
      return { x: client.x, y: client.y };
    };
    if (!shape.getTotalLength) {
      const box = (shape as unknown as SVGGraphicsElement).getBBox();
      return toClient(box.x + box.width / 2, box.y + box.height / 2);
    }
    if (shape instanceof SVGLineElement) {
      return toClient((shape.x1.baseVal.value + shape.x2.baseVal.value) / 2, (shape.y1.baseVal.value + shape.y2.baseVal.value) / 2);
    }
    const length = shape.getTotalLength();
    const samples = 48;
    const edge = Array.from({ length: samples }, (_, index) => shape.getPointAtLength(length * index / samples));
    const middle = { x: edge.reduce((sum, point) => sum + point.x, 0) / samples, y: edge.reduce((sum, point) => sum + point.y, 0) / samples };
    const candidates = [{ ...middle }];
    for (const t of [0.15, 0.3, 0.45, 0.6]) {
      for (const point of edge) candidates.push({ x: middle.x + (point.x - middle.x) * t, y: middle.y + (point.y - middle.y) * t });
    }
    for (const candidate of candidates) {
      const client = toClient(candidate.x, candidate.y);
      // A couple of pixels of margin each way, since a browser may round the pointer position.
      const clear = [-3, 0, 3].every(dx => [-3, 0, 3].every(dy =>
        document.elementFromPoint(client.x + dx, client.y + dy)?.closest('[data-element-key], [data-point-key]') === shape));
      if (clear) return client;
    }
    return toClient(middle.x, middle.y);
  });
}

async function hoverOn(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const { x, y } = await pointIn(locator);
  await page.mouse.move(x - 3, y - 3);
  await page.mouse.move(x, y);
  return { x, y };
}

async function clickOn(page: Page, locator: Locator) {
  const { x, y } = await hoverOn(page, locator);
  await page.mouse.click(x, y);
}

async function useBirth(page: Page, change: (page: Page) => Promise<void>) {
  await openBirth(page);
  await change(page);
  await page.getByRole('button', { name: 'Calculate natal chart' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test.describe('identifying symbols on the wheel', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Transit date', { exact: true }).fill('2024-04-15');
    await expect(page.locator('#selected-epoch')).toContainText('2024-04-15');
  });

  test('hovering names every kind of symbol with its short meaning', async ({ page }) => {
    await expect(tip(page)).toBeHidden();
    await hoverOn(page, page.getByRole('button', { name: 'Natal Saturn', exact: true }));
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toContainText('Saturn · Structure and responsibility');
    await expect(tip(page)).toContainText('Natal planet');

    await hoverOn(page, element(page, 'sign/9'));
    await expect(tip(page)).toContainText('Capricorn · Cardinal Earth sign');
    await hoverOn(page, element(page, 'house/7'));
    await expect(tip(page)).toContainText('House 7 · Partnerships');
    await hoverOn(page, element(page, 'angle/mc'));
    await expect(tip(page)).toContainText('MC · Midheaven');
    await hoverOn(page, element(page, 'angle/asc'));
    await expect(tip(page)).toContainText('ASC · Ascendant');

    const line = page.locator('#wheel .wheel-hit-line').first();
    const expected = await line.getAttribute('data-tip');
    expect(expected).toMatch(/^(Conjunction|Sextile|Square|Trine|Opposition) · \d+° relationship$/);
    await hoverOn(page, line);
    await expect(tip(page)).toContainText(expected!);

    await page.mouse.move(2, 2);
    await expect(tip(page)).toBeHidden();
  });

  test('a transit planet says it is a transit, and Escape dismisses a label', async ({ page }) => {
    await hoverOn(page, page.getByRole('button', { name: 'Transit Moon', exact: true }));
    await expect(tip(page)).toContainText('Moon · Emotions, habits and needs');
    await expect(tip(page)).toContainText('Transit planet');
    await page.keyboard.press('Escape');
    await expect(tip(page)).toBeHidden();
  });

  test('keyboard focus identifies the same symbols, and the label is exposed as a description', async ({ page }) => {
    await element(page, 'sign/0').focus();
    await expect(tip(page)).toContainText('Aries · Cardinal Fire sign');
    await expect(element(page, 'sign/0')).toHaveAttribute('aria-description', 'Aries · Cardinal Fire sign');
    await expect(element(page, 'sign/0')).toHaveAttribute('aria-label', 'Zodiac sign Aries');
    await element(page, 'house/10').focus();
    await expect(tip(page)).toContainText('House 10 · Career and public life');
    await page.locator('#wheel').getByRole('button', { name: 'Midheaven' }).focus();
    await expect(tip(page)).toContainText('MC · Midheaven');
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).focus();
    await expect(tip(page)).toContainText('Sun · Core identity and vitality');
    await page.keyboard.press('Escape');
    await expect(tip(page)).toBeHidden();
  });

  test('every control is a named, pressable button that points at the Inspector', async ({ page }) => {
    const controls = page.locator('#wheel [data-element-key]');
    expect(await controls.count()).toBeGreaterThan(12 + 12 + 2);
    for (const attributes of await controls.evaluateAll(nodes => nodes.map(node => ({
      role: node.getAttribute('role'), label: node.getAttribute('aria-label'), pressed: node.getAttribute('aria-pressed'),
      controls: node.getAttribute('aria-controls'), tip: node.getAttribute('data-tip'),
    })))) {
      expect(attributes.role).toBe('button');
      expect(attributes.label).toBeTruthy();
      expect(attributes.pressed).toBe('false');
      expect(attributes.controls).toBe('inspection');
      expect(attributes.tip).toContain(' · ');
    }
    await expect(page.getByRole('group', { name: 'Zodiac signs' })).toBeAttached();
    await expect(page.getByRole('group', { name: 'Houses', exact: true })).toBeAttached();
    await expect(page.getByRole('group', { name: 'Natal aspect lines' })).toBeAttached();
  });
});

test.describe('selecting elements on the wheel', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Transit date', { exact: true }).fill('2024-04-15');
    await expect(page.locator('#selected-epoch')).toContainText('2024-04-15');
  });

  test('starts with a guide that still invites a selection', async ({ page }) => {
    await expect(inspection(page)).toContainText('Select a planet or aspect');
    await expect(inspection(page).getByRole('button', { name: 'Zodiac sign Capricorn' })).toBeVisible();
    await expect(inspection(page).getByRole('button', { name: /^House 7,/ })).toBeVisible();
    await expect(inspection(page).getByRole('button', { name: 'Midheaven (MC)' })).toBeVisible();
    await expect(inspection(page).getByRole('button', { name: 'Trine aspects' })).toBeVisible();
  });

  test('a sign opens its meaning first, then the calculated facts, and marks the planets inside it', async ({ page }) => {
    await clickOn(page, element(page, 'sign/9'));
    await expect(title(page)).toHaveText('Capricorn');
    await expect(element(page, 'sign/9')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'region');
    const headings = await inspection(page).locator('h3').allInnerTexts();
    expect(headings.slice(0, 2).map(text => text.toLowerCase())).toEqual(['meaning', 'calculated facts']);
    await expect(inspection(page)).toContainText('Cardinal Earth sign');
    await expect(inspection(page)).toContainText('Astronomical background');
    await expect(inspection(page)).toContainText('Traditional symbolism');
    await expect(inspection(page)).toContainText('Tradition, not measurement');
    await expect(inspection(page)).toContainText('How to think about it');
    await expect(inspection(page).locator('.facts')).toContainText('270° to 300°');
    // The demonstration chart has its Sun in Capricorn; it is listed and marked on the wheel.
    await expect(inspection(page).locator('.facts').getByRole('button', { name: /^Natal Sun/ })).toBeVisible();
    await expect(page.locator('#wheel [data-point-key="natal/sun"]')).toHaveAttribute('data-related', '');
    // Other glyphs recede; the Sun, inside the sign, does not.
    expect(await page.locator('#wheel [data-point-key="natal/sun"]').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  });

  test('a house shows its topics, its cusp and the planets in it', async ({ page }) => {
    await clickOn(page, element(page, 'house/10'));
    await expect(title(page)).toHaveText('House 10');
    await expect(element(page, 'house/10')).toHaveAttribute('aria-pressed', 'true');
    await expect(inspection(page)).toContainText('Career and public life');
    await expect(inspection(page).locator('.facts')).toContainText('Whole Sign');
    await expect(inspection(page).locator('.facts')).toContainText('Cusp');
    await expect(inspection(page).locator('.facts dd', { hasText: /^30\.000°$/ })).toBeVisible();
  });

  test('the Ascendant and Midheaven are selectable and give their calculated position', async ({ page }) => {
    await page.locator('#wheel').getByRole('button', { name: 'Midheaven' }).click();
    await expect(title(page)).toHaveText('Midheaven');
    await expect(inspection(page).locator('.facts')).toContainText('Imum Coeli');
    await expect(page.locator('#wheel').getByRole('button', { name: 'Midheaven' })).toHaveAttribute('aria-pressed', 'true');
    await clickOn(page, element(page, 'angle/asc'));
    await expect(title(page)).toHaveText('Ascendant');
    await expect(inspection(page).locator('.facts')).toContainText('Descendant');
    await expect(inspection(page)).toContainText('Traditional symbolism');
  });

  test('an aspect line selects that aspect, with the meaning of its type and both planets', async ({ page }) => {
    const line = page.locator('#wheel .wheel-hit-line').first();
    const key = await line.getAttribute('data-element-key');
    await clickOn(page, line);
    await expect(line).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'aspect');
    await expect(page.locator('#wheel .wheel-focus')).toHaveCount(1);
    expect(key).toContain('natal');
    await expect(title(page)).toContainText('·');
    await expect(inspection(page).locator('.meaning')).toContainText('Traditional symbolism');
    await expect(inspection(page).locator('.meaning .pair-themes li')).toHaveCount(2);
    await expect(inspection(page).locator('.facts')).toContainText('Allowed orb');
  });

  test('clicking a planet still wins over the sign and house behind it', async ({ page }) => {
    for (const name of ['Natal Sun', 'Natal Moon', 'Transit Saturn']) {
      const planet = page.getByRole('button', { name, exact: true });
      const box = (await planet.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(title(page)).toHaveText(name);
      await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'planet');
    }
    await expect(page.locator('#wheel [aria-pressed="true"]')).toHaveCount(1);
  });

  test('a planet links to its sign and house, and an aspect type selects every such aspect', async ({ page }) => {
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    await inspection(page).getByRole('button', { name: 'Open the sign Capricorn' }).click();
    await expect(title(page)).toHaveText('Capricorn');
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    await inspection(page).getByRole('button', { name: /^Open house \d+$/ }).click();
    await expect(title(page)).toContainText('House');

    const first = page.locator('#wheel .wheel-hit-line').first();
    const kind = (await first.getAttribute('data-tip'))!.split(' · ')[0];
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    await clickOn(page, first);
    await inspection(page).getByRole('button', { name: new RegExp(`^All ${kind.toLowerCase()}s in this chart`) }).click();
    await expect(title(page)).toHaveText(kind);
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'aspect-type');
    await expect(inspection(page).locator('.facts')).toContainText('Exact angle');
    expect(await page.locator('#wheel .wheel-related').count()).toBeGreaterThan(0);
  });

  test('an idea opens from "Learn more", leaves the wheel unmarked, and steps back to where you were', async ({ page }) => {
    await page.getByRole('button', { name: 'Natal Saturn', exact: true }).click();
    await inspection(page).getByRole('button', { name: 'Learn about Retrograde' }).click();
    await expect(title(page)).toHaveText('Retrograde');
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', '');
    await expect(inspection(page).locator('.facts')).toContainText('Retrograde now');
    await inspection(page).getByRole('button', { name: 'Back to Natal Saturn' }).click();
    await expect(title(page)).toHaveText('Natal Saturn');
    await expect(inspection(page).getByRole('button', { name: /^Back to (?!the chart guide)/ })).toHaveCount(0);
  });

  test('the orb idea lists the orbs the app actually uses', async ({ page }) => {
    await inspection(page).getByRole('button', { name: 'About Orb' }).click();
    await expect(title(page)).toHaveText('Orb');
    const facts = inspection(page).locator('.facts');
    await expect(facts).toContainText('Conjunction');
    await expect(facts).toContainText('8.000°');
    await expect(facts).toContainText('Sextile');
    await expect(facts).toContainText('4.000°');
  });

  test('the sections can be reached from a jump bar, sources are attributed, and reflection is optional', async ({ page }) => {
    await page.getByRole('button', { name: 'Natal Saturn', exact: true }).click();
    await inspection(page).getByRole('button', { name: 'Calculated facts' }).click();
    await expect(inspection(page).locator('#inspect-facts-heading')).toBeFocused();
    await inspection(page).getByRole('button', { name: 'Meaning' }).click();
    await expect(inspection(page).locator('#inspect-meaning-heading')).toBeFocused();
    const sources = inspection(page).locator('details.sources');
    await expect(sources.locator('li').first()).toBeHidden();
    await sources.locator('summary').click();
    await expect(sources.locator('li').first()).toBeVisible();
    await expect(sources.locator('a[href^="https://"][rel~="noopener"]').first()).toBeVisible();
    await expect(inspection(page).locator('details.reflection summary')).toContainText('reflect');
  });

  test('the calculated facts keep natal and transit context and never invent anything', async ({ page }) => {
    await page.getByRole('button', { name: 'Natal Saturn', exact: true }).click();
    await expect(inspection(page).locator('.facts .context-note')).toContainText('Natal chart, fixed at the birth moment');
    await page.getByRole('button', { name: 'Transit Saturn', exact: true }).click();
    await expect(inspection(page).locator('.facts .context-note')).toContainText('Transits at the Time Machine moment');
    await expect(inspection(page).locator('.facts .context-note')).toContainText('2024-04-15');
    await expect(inspection(page).locator('.facts')).toContainText('°/day');
    await expect(inspection(page).locator('.relations')).toBeVisible();
  });

  test('selection survives zoom, panning and Time Machine redraws, and a drag does not select', async ({ page, browserName }) => {
    await clickOn(page, element(page, 'sign/9'));
    await expect(title(page)).toHaveText('Capricorn');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.locator('#selected-epoch')).toContainText('2024-04-16');
    await expect(title(page)).toHaveText('Capricorn');
    await expect(element(page, 'sign/9')).toHaveAttribute('aria-pressed', 'true');
    await expect(inspection(page).locator('.inspect-title')).toHaveText('Capricorn');

    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(title(page)).toHaveText('Natal Sun');
    await expect(page.getByRole('button', { name: 'Natal Sun', exact: true })).toHaveAttribute('aria-pressed', 'true');

    if (browserName !== 'webkit') {
      // Begin the drag on a house region that is on screen, so a drag across a real target must pan, not select.
      const start = await page.evaluate(() => {
        const frame = document.querySelector('#wheel svg')!.getBoundingClientRect();
        const clear = (x: number, y: number) => [-3, 0, 3].every(dx => [-3, 0, 3].every(dy =>
          document.elementFromPoint(x + dx, y + dy)?.getAttribute('data-element-key')?.startsWith('house/')));
        for (let y = frame.top + 20; y < frame.bottom - 20; y += 8) {
          for (let x = frame.left + 20; x < frame.right - 20; x += 8) if (clear(x, y)) return { x, y };
        }
        return null;
      });
      expect(start).not.toBeNull();
      const before = await page.locator('#wheel svg').getAttribute('viewBox');
      await page.mouse.move(start!.x, start!.y);
      await page.mouse.down();
      await page.mouse.move(start!.x - 40, start!.y - 30, { steps: 6 });
      await page.mouse.up();
      expect(await page.locator('#wheel svg').getAttribute('viewBox')).not.toBe(before);
      await expect(title(page)).toHaveText('Natal Sun');
    }
  });
});

test.describe('keyboard use', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('signs, houses and aspects are one tab stop each and move with the arrow keys', async ({ page }) => {
    for (const group of ['signs', 'houses', 'aspects']) {
      expect(await page.locator(`#wheel [data-rove-group="${group}"] [data-rove][tabindex="0"]`).count()).toBe(1);
    }
    await element(page, 'sign/0').focus();
    await page.keyboard.press('ArrowRight');
    await expect(element(page, 'sign/1')).toBeFocused();
    await expect(element(page, 'sign/1')).toHaveAttribute('tabindex', '0');
    await expect(element(page, 'sign/0')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('End');
    await expect(element(page, 'sign/11')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(element(page, 'sign/0')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(element(page, 'sign/11')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(element(page, 'sign/0')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText('Aries');
    await element(page, 'house/3').focus();
    await page.keyboard.press(' ');
    await expect(title(page)).toHaveText('House 3');
  });
});

test.describe('houses under different systems and when unavailable', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('Whole Sign houses are equal 30° slices; Placidus houses differ and say so', async ({ page }) => {
    await clickOn(page, element(page, 'house/1'));
    await expect(inspection(page).locator('.facts')).toContainText('Whole Sign');
    await expect(inspection(page).locator('.facts dd', { hasText: /^30\.000°$/ })).toBeVisible();

    await useBirth(page, async p => { await p.locator('#house-system').selectOption('Placidus'); });
    await expect(page.locator('#wheel-caption')).toContainText('Placidus');
    await expect(page.locator('#wheel [data-element-key^="house/"]')).toHaveCount(12);
    await clickOn(page, element(page, 'house/2'));
    await expect(title(page)).toHaveText('House 2');
    await expect(inspection(page).locator('.facts')).toContainText('Placidus');
    const size = await inspection(page).locator('.facts dt', { hasText: 'Size' }).locator('xpath=following-sibling::dd[1]').innerText();
    expect(size).not.toBe('30.000°');
  });

  test('without a birth time there are no house or angle targets, but signs and every meaning remain', async ({ page }) => {
    await useBirth(page, async p => { await p.getByLabel('Birth time unknown').check(); });
    await expect(page.locator('#wheel [data-element-key^="sign/"]')).toHaveCount(12);
    await expect(page.locator('#wheel [data-element-key^="house/"]')).toHaveCount(0);
    await expect(page.locator('#wheel [data-element-key^="angle/"]')).toHaveCount(0);
    await expect(page.locator('#wheel [id$="-cusps"]')).toHaveCount(0);
    await expect(inspection(page)).toContainText('Unknown birth time');
    await inspection(page).getByRole('button', { name: /^House 7,/ }).click();
    await expect(title(page)).toHaveText('House 7');
    await expect(inspection(page).locator('.meaning')).toContainText('Partnerships');
    await expect(inspection(page).locator('.facts')).toContainText('Houses need a birth time and a birth place');
    await expect(inspection(page).locator('.facts')).toContainText('Unknown birth time');
    await inspection(page).getByRole('button', { name: 'Back to the chart guide' }).click();
    await expect(inspection(page).locator('.inspect-intro')).toBeFocused();
    await inspection(page).getByRole('button', { name: 'Midheaven (MC)' }).click();
    await expect(inspection(page).locator('.facts')).toContainText('Angles need a birth time and a birth place');
    await clickOn(page, element(page, 'sign/0'));
    await expect(title(page)).toHaveText('Aries');
    await expect(inspection(page).locator('.facts')).toContainText('Natal planets are unavailable');
  });

  test('a missing birth place explains that houses need a location', async ({ page }) => {
    await useBirth(page, async p => {
      await p.getByLabel('Latitude', { exact: true }).clear();
      await p.getByLabel('Longitude', { exact: true }).clear();
    });
    await expect(page.locator('#wheel-caption')).toContainText('no houses');
    await expect(page.locator('#wheel [data-element-key^="house/"]')).toHaveCount(0);
    await inspection(page).getByRole('button', { name: /^House 1,/ }).click();
    await expect(inspection(page).locator('.facts')).toContainText('Enter latitude and longitude');
    await clickOn(page, element(page, 'sign/9'));
    await expect(title(page)).toHaveText('Capricorn');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('a tap identifies and selects, and full-size buttons reach the targets that are too small to tap', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Touch emulation is exercised in Chromium and WebKit.');
    await openApp(page);
    const sign = element(page, 'sign/9');
    const { x, y } = await pointIn(sign);
    await page.touchscreen.tap(x, y);
    await expect(title(page)).toHaveText('Capricorn');
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toContainText('Capricorn · Cardinal Earth sign');
    const box = (await tip(page).boundingBox())!;
    const view = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    // The label goes away by itself, so it never lingers over the chart.
    await expect(tip(page)).toBeHidden({ timeout: 6000 });

    // The planet strip carries the way to everything else: a Guide button with 44 px targets.
    const guide = page.getByRole('button', { name: 'Chart guide: signs, houses, angles and aspects' });
    const guideBox = (await guide.boundingBox())!;
    expect(guideBox.height).toBeGreaterThanOrEqual(43.9);
    await guide.click();
    await expect(inspection(page)).toBeInViewport({ ratio: 0.2 });
    await expect(inspection(page).locator('.inspect-intro')).toBeFocused();
    const buttons = inspection(page).locator('.guide-button, .concept-link');
    for (const rect of await buttons.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))) {
      expect(rect.height).toBeGreaterThanOrEqual(43.9);
      expect(rect.width).toBeGreaterThanOrEqual(43.9);
    }
    await inspection(page).getByRole('button', { name: /^House 7,/ }).click();
    await expect(title(page)).toHaveText('House 7');
    await expect(page.locator('#selection-summary')).toContainText('House 7');
    await page.locator('#selection-toggle').click();
    await expect(inspection(page).locator('.inspect-title')).toBeFocused();
  });

  test('keeps stepping and Now on the first screen with a sign or house selected', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Touch emulation is exercised in Chromium and WebKit.');
    await openApp(page);
    const first = async () => {
      const view = page.viewportSize()!;
      for (const target of [page.getByRole('button', { name: 'Previous day' }), page.getByRole('button', { name: 'Next day' }), page.getByRole('button', { name: 'Now', exact: true })]) {
        const rect = (await target.boundingBox())!;
        expect(rect.y + rect.height).toBeLessThanOrEqual(view.height);
      }
    };
    await first();
    const { x, y } = await pointIn(element(page, 'house/10'));
    await page.touchscreen.tap(x, y);
    await expect(title(page)).toHaveText('House 10');
    await first();
  });
});
