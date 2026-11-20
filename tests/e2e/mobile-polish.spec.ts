import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { goTo, openApp } from './helpers';
import type { View } from './helpers';

const viewBox = (page: Page) => page.locator('#wheel svg').evaluate(svg => svg.getAttribute('viewBox')!.split(' ').map(Number).slice(0, 3));
const zoomText = (page: Page) => page.locator('#wheel-zoom-level').innerText();

async function openAt(page: Page, date = '2024-04-15') {
  await openApp(page);
  await page.getByLabel('Transit date', { exact: true }).fill(date);
  await expect(page.locator('#selected-epoch')).toContainText(date);
}

test.describe('wheel zoom and pan', () => {
  test('zoom buttons magnify, clamp and reset, and tell the person where they are', async ({ page }) => {
    await openAt(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    const reset = page.getByRole('button', { name: 'Reset wheel view' });
    const [, , whole] = await viewBox(page);
    await expect(page.locator('#wheel-zoom-level')).toHaveText('100%');
    await expect(zoomOut).toBeDisabled();
    await expect(reset).toBeDisabled();
    await expect(page.locator('#wheel')).not.toHaveAttribute('data-zoomed', '');

    await zoomIn.click();
    await expect(page.locator('#wheel-zoom-level')).toHaveText('150%');
    expect((await viewBox(page))[2]).toBeCloseTo(whole / 1.5, 1);
    await expect(page.locator('#wheel')).toHaveAttribute('data-zoomed', '');
    // A zoomed wheel owns touch gestures so a drag pans the chart instead of scrolling the page.
    expect(await page.locator('#wheel').evaluate(node => getComputedStyle(node).touchAction)).toBe('none');
    await expect(zoomOut).toBeEnabled();
    await expect(reset).toBeEnabled();

    for (let index = 0; index < 6; index += 1) if (await zoomIn.isEnabled()) await zoomIn.click();
    await expect(page.locator('#wheel-zoom-level')).toHaveText('400%');
    await expect(zoomIn).toBeDisabled();
    expect((await viewBox(page))[2]).toBeCloseTo(whole / 4, 1);

    await reset.click();
    await expect(page.locator('#wheel-zoom-level')).toHaveText('100%');
    expect(await viewBox(page)).toEqual([-24, -24, whole]);
    await expect(page.locator('#wheel')).not.toHaveAttribute('data-zoomed', '');
    expect(await page.locator('#wheel').evaluate(node => getComputedStyle(node).touchAction)).toBe('pan-y');
  });

  test('keyboard zoom, pan and reset work from a focused glyph', async ({ page }) => {
    await openAt(page);
    const sun = page.getByRole('button', { name: 'Natal Sun', exact: true });
    await sun.focus();
    await page.keyboard.press('+');
    await expect(page.locator('#wheel-zoom-level')).toHaveText('150%');
    await page.keyboard.press('+');
    await expect(page.locator('#wheel-zoom-level')).toHaveText('225%');
    const before = await viewBox(page);
    await page.keyboard.press('ArrowLeft');
    const after = await viewBox(page);
    expect(after[0]).toBeLessThan(before[0]);
    expect(after[2]).toBeCloseTo(before[2], 5);
    await page.keyboard.press('-');
    await expect(page.locator('#wheel-zoom-level')).toHaveText('150%');
    await page.keyboard.press('0');
    await expect(page.locator('#wheel-zoom-level')).toHaveText('100%');
    // Arrow keys keep their usual meaning on a wheel that is not zoomed.
    const idle = await viewBox(page);
    await page.keyboard.press('ArrowLeft');
    expect(await viewBox(page)).toEqual(idle);
  });

  test('tabbing to a glyph that is off screen pans it into view', async ({ page }) => {
    await openAt(page);
    for (let index = 0; index < 3; index += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
    // Focus the glyph that is furthest from the centre of the zoomed view.
    const target = await page.evaluate(() => {
      const view = document.querySelector('#wheel svg')!.getAttribute('viewBox')!.split(' ').map(Number);
      const centre = [view[0] + view[2] / 2, view[1] + view[2] / 2];
      const points = [...document.querySelectorAll('#wheel [data-point-key]')].map(node => {
        const circle = node.querySelector('circle')!;
        const dx = Number(circle.getAttribute('cx')) - centre[0];
        const dy = Number(circle.getAttribute('cy')) - centre[1];
        return { key: node.getAttribute('data-point-key')!, distance: Math.hypot(dx, dy) };
      });
      return points.sort((a, b) => b.distance - a.distance)[0].key;
    });
    const before = await viewBox(page);
    await page.locator(`#wheel [data-point-key="${target}"]`).focus();
    const after = await viewBox(page);
    expect(after[0] !== before[0] || after[1] !== before[1]).toBe(true);
    const glyph = await page.locator(`#wheel [data-point-key="${target}"]`).boundingBox();
    const frame = await page.locator('#wheel svg').boundingBox();
    expect(glyph!.x).toBeGreaterThanOrEqual(frame!.x - 1);
    expect(glyph!.x + glyph!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
  });

  test('selection survives zooming, panning and resetting', async ({ page }) => {
    await openAt(page);
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    const related = await page.locator('#wheel .wheel-related').count();
    expect(related).toBeGreaterThan(0);
    const title = await page.locator('#inspection .inspect-title').innerText();
    const check = async (count: number, name = title) => {
      await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'planet');
      await expect(page.locator('#wheel [data-point-key][aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator('#wheel .wheel-related')).toHaveCount(count);
      await expect(page.locator('#inspection .inspect-title')).toHaveText(name);
    };
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await check(related);
    await page.locator('#wheel').focus();
    await page.keyboard.press('ArrowRight');
    await check(related);
    // Stepping the Time Machine redraws the wheel; zoom and selection both stay.
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.locator('#wheel-zoom-level')).toHaveText('225%');
    // A day later the planet may have different aspects: the selection stays, and the wheel
    // and the Inspector keep agreeing about them.
    const agree = () => expect.poll(async () => (await page.locator('#wheel .wheel-related').count()) === (await page.locator('#inspection .relation').count())).toBe(true);
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'planet');
    await expect(page.locator('#wheel [data-point-key][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#inspection .inspect-title')).toHaveText(title);
    await agree();
    await page.getByRole('button', { name: 'Reset wheel view' }).click();
    await expect(page.locator('#wheel [data-point-key][aria-pressed="true"]')).toHaveCount(1);
    await agree();
  });

  test('dragging a zoomed wheel pans it without selecting anything', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit does not expose synthetic mouse drags on SVG consistently.');
    await openAt(page);
    for (let index = 0; index < 3; index += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
    const frame = (await page.locator('#wheel svg').boundingBox())!;
    const before = await viewBox(page);
    const x = frame.x + frame.width / 2;
    const y = frame.y + frame.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 40, { steps: 6 });
    await page.mouse.up();
    const after = await viewBox(page);
    expect(after[0]).toBeLessThan(before[0]);
    expect(after[1]).toBeLessThan(before[1]);
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', '');
    await expect(page.locator('#wheel [aria-pressed="true"]')).toHaveCount(0);
  });

  test('two pointers pinch the wheel and a single touch on a glyph still selects it', async ({ page }) => {
    await openAt(page);
    const frame = (await page.locator('#wheel svg').boundingBox())!;
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    await page.evaluate(({ cx, cy }) => {
      const wheel = document.querySelector('#wheel svg')!;
      const fire = (type: string, id: number, x: number, y: number) =>
        wheel.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1 }));
      fire('pointerdown', 1, cx - 40, cy);
      fire('pointerdown', 2, cx + 40, cy);
      for (let step = 1; step <= 8; step += 1) {
        fire('pointermove', 1, cx - 40 - step * 10, cy);
        fire('pointermove', 2, cx + 40 + step * 10, cy);
      }
      fire('pointerup', 1, cx - 120, cy);
      fire('pointerup', 2, cx + 120, cy);
    }, { cx, cy });
    const level = Number.parseInt(await zoomText(page), 10);
    expect(level).toBeGreaterThan(200);
    // Pinching is not a tap: nothing was selected.
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', '');
    await page.getByRole('button', { name: 'Reset wheel view' }).click();
    // A tap right after a gesture is swallowed (it is the gesture's own click); a tap a moment later selects.
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', 'planet');
  });

  test('Ctrl or ⌘ with the mouse wheel zooms, a plain wheel scrolls the page', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Modified wheel events are driven in Chromium.');
    await openAt(page);
    const frame = (await page.locator('#wheel svg').boundingBox())!;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.mouse.wheel(0, 200);
    await expect(page.locator('#wheel-zoom-level')).toHaveText('100%');
    // Playwright's wheel does not carry modifier keys, so send the event a trackpad pinch produces.
    await page.locator('#wheel svg').evaluate(svg => svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, ctrlKey: true, bubbles: true, cancelable: true, clientX: 200, clientY: 300 })));
    await expect.poll(async () => Number.parseInt(await zoomText(page), 10)).toBeGreaterThan(100);
  });
});

test.describe('touch alternatives on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the planet strip offers every planet as a 44 px button and selects through the Inspector', async ({ page }) => {
    await openApp(page);
    const strip = page.getByRole('group', { name: 'Choose a planet' });
    await expect(strip).toBeVisible();
    const buttons = strip.getByRole('button');
    expect(await buttons.count()).toBe(20);
    for (const box of await buttons.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(strip.getByRole('button', { name: 'Select Natal Sun' })).toHaveAttribute('aria-pressed', 'false');
    await strip.getByRole('button', { name: 'Select Transit Moon' }).click();
    await expect(strip.getByRole('button', { name: 'Select Transit Moon' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#wheel [data-point-key="transit/moon"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#inspection .inspect-title')).toContainText('Moon');
    // The glyph and the strip agree about what is selected.
    await expect(strip.locator('[aria-pressed="true"]')).toHaveCount(1);
  });

  test('an in-flow selection bar keeps the details one tap away and clears the selection', async ({ page }) => {
    await openApp(page);
    const bar = page.locator('#selection-bar');
    await expect(bar).toBeHidden();
    await page.getByRole('button', { name: 'Select Natal Sun' }).click();
    await expect(bar).toBeVisible();
    await expect(page.locator('#selection-summary')).toContainText('Natal Sun');
    // It is part of the page flow, so it can never cover the dock, the Inspector or the tab bar.
    expect(await bar.evaluate(node => getComputedStyle(node).position)).not.toBe('fixed');
    const strip = (await page.getByRole('group', { name: 'Choose a planet' }).boundingBox())!;
    const box = (await bar.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
    const toggle = page.locator('#selection-toggle');
    await expect(toggle).toHaveText('View details');
    await toggle.click();
    await expect(page.locator('#inspection')).toBeInViewport({ ratio: 0.3 });
    await expect(page.locator('#inspection .inspect-title')).toBeFocused();
    // Back at the chart, the bar is where it was left: in the flow under the wheel.
    await page.locator('#wheel-heading').scrollIntoViewIfNeeded();
    await expect(bar).toBeVisible();
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(bar).toBeHidden();
    await expect(page.locator('#wheel')).toHaveAttribute('data-selection', '');
    await expect(page.getByRole('group', { name: 'Choose a planet' }).locator('[aria-pressed="true"]')).toHaveCount(0);
  });

  test('the selection bar belongs to the chart view only', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Select Natal Sun' }).click();
    await expect(page.locator('#selection-bar')).toBeVisible();
    await goTo(page, 'events');
    await expect(page.locator('#selection-bar')).toBeHidden();
    await goTo(page, 'chart');
    await expect(page.locator('#selection-bar')).toBeVisible();
  });

  test('with reduced motion the details jump without animation and controls do not transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await page.getByRole('button', { name: 'Select Natal Sun' }).click();
    expect(await page.locator('.strip-button').first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
    await page.locator('#selection-toggle').click();
    // A jump is already finished on the next frame; a smooth scroll would still be moving.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
    await expect(page.locator('#inspection')).toBeInViewport({ ratio: 0.3 });
  });

  for (const width of [320, 390]) {
    test(`at ${width} px the zoom controls sit in the wheel's corners without covering a glyph`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openApp(page);
      const overlap = await page.evaluate(() => {
        const rect = (node: Element) => node.getBoundingClientRect();
        const hits = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const controls = [...document.querySelectorAll('.wheel-tools button')].map(rect);
        const glyphs = [...document.querySelectorAll('#wheel [data-point-key]')].map(rect);
        return controls.flatMap(control => glyphs.filter(glyph => hits(control, glyph))).length;
      });
      expect(overlap).toBe(0);
    });
  }

  test('zoom controls stay reachable and 44 px tall on a phone', async ({ page }) => {
    await openApp(page);
    for (const name of ['Zoom in', 'Zoom out', 'Reset wheel view']) {
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.9);
      expect(box.width).toBeGreaterThanOrEqual(43.9);
    }
    await page.getByRole('button', { name: 'Zoom in' }).tap();
    await expect(page.locator('#wheel-zoom-level')).toHaveText('150%');
  });
});

test.describe('layout polish', () => {
  test('the Events month headings do not stick over the cards on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, 'events');
    await page.getByLabel('From (UTC midnight)', { exact: true }).fill('2024-03-20');
    await page.getByLabel('To (UTC midnight)', { exact: true }).fill('2024-06-30');
    await page.getByLabel('Transiting planet').selectOption('mercury');
    await page.getByRole('button', { name: 'Search events' }).click();
    await expect(page.locator('#event-status')).toContainText(/Found/, { timeout: 30_000 });
    const position = (width: number) => page.setViewportSize({ width, height: 844 })
      .then(() => page.locator('.event-month h3').first().evaluate(node => getComputedStyle(node).position));
    expect(await position(390)).toBe('static');
    expect(await position(768)).toBe('static');
    expect(await position(1280)).toBe('sticky');
  });

  const widths = [320, 390, 768, 1280, 1440];
  for (const width of widths) {
    test(`no view overflows sideways at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 700 ? 800 : 900 });
      await openApp(page);
      await page.getByRole('button', { name: width < 700 ? 'Select Natal Sun' : 'Natal Sun', exact: true }).click();
      for (const view of ['chart', 'events', 'library', 'export'] as View[]) {
        await goTo(page, view);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${view} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('the app bar keeps the brand on one line at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openApp(page);
    const heading = (await page.locator('.brand-text h1').boundingBox())!;
    const lineHeight = await page.locator('.brand-text h1').evaluate(node => Number.parseFloat(getComputedStyle(node).lineHeight));
    expect(heading.height).toBeLessThan(lineHeight * 1.6);
  });
});

test.describe('assets', () => {
  test('declares an SVG favicon that loads', async ({ page }) => {
    await openApp(page);
    const href = await page.locator('link[rel="icon"]').getAttribute('href');
    expect(href).toBeTruthy();
    const response = await page.request.get(new URL(href!, page.url()).toString());
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('<svg');
  });

  test('ships only the two font files the interface uses', async ({ page }) => {
    await openApp(page);
    const faces = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
      .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
      .map(rule => `${rule.style.getPropertyValue('font-family')}|${rule.style.getPropertyValue('font-weight')}|${rule.style.getPropertyValue('src')}`));
    expect(faces).toHaveLength(2);
    expect(faces.some(face => face.includes('inter-latin-wght-normal'))).toBe(true);
    expect(faces.some(face => face.includes('cormorant-garamond-latin-600-normal'))).toBe(true);
  });
});
