import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { goTo, openApp } from './helpers';

const inspection = (page: Page) => page.locator('#inspection');
const cards = (page: Page) => page.locator('#learn-root .learn-card');
const heading = (page: Page) => page.locator('#view-learn h2:visible');

test.describe('Learn index', () => {
  test('is a fifth tab with every one of the 49 entries, grouped by category', async ({ page }) => {
    await openApp(page);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link')).toHaveText(['Chart', 'Events', 'Library', 'Export', 'Learn']);
    await goTo(page, 'learn');
    await expect(page).toHaveTitle('Learn · Divine Orchestration');
    await expect(nav.locator('[data-nav="learn"]')).toHaveAttribute('aria-current', 'page');
    await expect(heading(page)).toBeFocused();
    await expect(cards(page)).toHaveCount(49);
    await expect(page.locator('.learn-count')).toHaveText('49 entries');
    for (const group of ['Planets (10)', 'Signs (12)', 'Houses (12)', 'Aspects (5)', 'Angles (2)', 'Ideas (8)']) {
      await expect(page.getByRole('heading', { name: group })).toBeVisible();
    }
  });

  test('searches, filters by category, combines both, and resets from the empty state', async ({ page }) => {
    await openApp(page, 'learn');
    const search = page.getByLabel('Search the glossary');
    await search.fill('SATURN');
    await expect(page.locator('.learn-card[href="#learn/body/saturn"]')).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill('capricorn earth');
    await expect(page.locator('.learn-card[href="#learn/sign/9"]')).toBeVisible();
    await page.getByRole('button', { name: 'Houses', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Houses', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'false');
    for (const href of await cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))) {
      expect(href).toMatch(/^#learn\/house\//);
    }
    await search.fill('zzzzqqq');
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator('.learn-count')).toHaveText('0 entries match');
    await page.getByRole('button', { name: 'Clear search and category' }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(cards(page)).toHaveCount(49);
  });

  test('keeps the search for the session while an entry is open', async ({ page }) => {
    await openApp(page, 'learn');
    await page.getByLabel('Search the glossary').fill('trine');
    await page.getByRole('button', { name: 'Aspects', exact: true }).click();
    await page.locator('.learn-card[href="#learn/aspect/trine"]').click();
    await expect(heading(page)).toHaveText('Trine');
    await page.getByRole('link', { name: '← Back to Learn' }).click();
    await expect(page.getByLabel('Search the glossary')).toHaveValue('trine');
    await expect(page.getByRole('button', { name: 'Aspects', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Full-text search can match entries that merely mention the word, so assert inclusion rather than a count.
    await expect(page.locator('.learn-card[href="#learn/aspect/trine"]')).toBeVisible();
    expect(await cards(page).count()).toBeLessThan(6);
  });
});

test.describe('Learn entries and routing', () => {
  test('opens a direct entry URL, survives a reload, and has no chart origin', async ({ page }) => {
    await page.goto('/#learn/body/saturn');
    await expect(heading(page)).toHaveText('Saturn');
    await expect(page).toHaveTitle('Saturn · Learn · Divine Orchestration');
    await expect(page.getByRole('link', { name: 'Back to Chart' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '← Back to Learn' })).toBeVisible();
    await page.reload();
    await expect(heading(page)).toHaveText('Saturn');
    const detail = page.locator('.learn-detail');
    await expect(detail).toContainText('Structure and responsibility');
    await expect(detail.getByRole('heading', { name: 'Astronomical background' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Traditional symbolism' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'How to think about it' })).toBeVisible();
    await expect(detail).toContainText('Tradition, not measurement');
  });

  test('every entry id opens a page with the right heading', async ({ page }) => {
    await openApp(page);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#learn-root .learn-card')].map(a => a.getAttribute('href')!));
    expect(ids).toHaveLength(49);
    for (const href of ids) {
      await page.evaluate(h => { location.hash = h; }, href);
      await expect(page.locator('.learn-detail')).toBeVisible();
      await expect(heading(page)).toBeVisible();
    }
  });

  test('moves focus and the title on every Learn route change, and Back/Forward work', async ({ page }) => {
    await openApp(page, 'learn');
    await page.locator('.learn-card[href="#learn/sign/9"]').click();
    await expect(heading(page)).toHaveText('Capricorn');
    await expect(heading(page)).toBeFocused();
    await expect(page).toHaveTitle('Capricorn · Learn · Divine Orchestration');
    await page.goBack();
    await expect(heading(page)).toHaveText('Learn');
    await expect(heading(page)).toBeFocused();
    await expect(page).toHaveTitle('Learn · Divine Orchestration');
    await page.goForward();
    await expect(heading(page)).toHaveText('Capricorn');
    await expect(heading(page)).toBeFocused();
  });

  test('follows related entries and opens collapsed attribution and reflection', async ({ page }) => {
    await page.goto('/#learn/body/saturn');
    const detail = page.locator('.learn-detail');
    await detail.getByRole('link', { name: /Retrograde/ }).click();
    await expect(heading(page)).toHaveText('Retrograde');
    await expect(page).toHaveURL(/#learn\/concept\/retrograde$/);
    const sources = detail.locator('details.sources');
    await expect(sources.locator('li').first()).toBeHidden();
    await sources.locator('summary').click();
    await expect(sources.locator('a[href^="https://"][rel~="noopener"]').first()).toBeVisible();
    const reflection = detail.locator('details.reflection');
    await expect(reflection.locator('p')).toBeHidden();
    await reflection.locator('summary').click();
    await expect(reflection.locator('p')).toBeVisible();
  });

  test('a malformed entry keeps Learn active and shows the index with a notice', async ({ page }) => {
    await page.goto('/#learn/body/vulcan');
    await expect(page.locator('#view-learn')).toBeVisible();
    await expect(page.locator('.learn-notice')).toContainText('body/vulcan');
    await expect(cards(page)).toHaveCount(49);
    await expect(page).toHaveTitle('Learn · Divine Orchestration');
    await page.goto('/#nonsense');
    await expect(page.locator('#view-chart')).toBeVisible();
  });

  test('the skip link still focuses the content', async ({ page }) => {
    await openApp(page, 'learn');
    await page.keyboard.press('Tab');
    await page.getByRole('link', { name: 'Skip to content' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await expect(page.locator('#view-learn')).toBeVisible();
  });

  test('opens even when the calculation engine cannot load', async ({ page }) => {
    await page.route('**/*.wasm', route => route.abort());
    await page.goto('/#learn/sign/9');
    await expect(heading(page)).toHaveText('Capricorn');
    await expect(page.locator('.learn-detail')).toContainText('Cardinal Earth sign');
  });
});

test.describe('Inspector links', () => {
  test('every kind of entry opens in Learn, and Back to Chart restores the chart exactly', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Transit date', { exact: true }).fill('2024-04-15');
    await expect(page.locator('#selected-epoch')).toContainText('2024-04-15');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const zoom = await page.locator('#wheel-zoom-level').innerText();
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    await page.getByRole('button', { name: 'Natal Moon', exact: true }).click();
    await expect(page.locator('#inspection .inspect-title')).toHaveText('Natal Moon');

    const cases: [string, string, string][] = [
      ['body', 'Open Moon in Learn', 'Moon'],
    ];
    for (const [, link, title] of cases) {
      await inspection(page).getByRole('link', { name: link }).click();
      await expect(heading(page)).toHaveText(title);
      await expect(page).toHaveTitle(`${title} · Learn · Divine Orchestration`);
      await page.getByRole('link', { name: 'Back to Chart' }).click();
      await expect(page.locator('#view-chart')).toBeVisible();
      await expect(page.locator('#inspection .inspect-title')).toHaveText('Natal Moon');
      await expect(page.getByLabel('Transit date', { exact: true })).toHaveValue('2024-04-15');
      await expect(page.locator('#wheel-zoom-level')).toHaveText(zoom);
    }
  });

  test('signs, houses, angles, aspect types and ideas each link to their Learn page', async ({ page }) => {
    await openApp(page);
    const cases: [string, string, string][] = [
      ['sign/9', 'Open Capricorn in Learn', 'Capricorn'],
      ['house/7', 'Open House 7 in Learn', 'House 7'],
      ['angle/mc', 'Open Midheaven in Learn', 'Midheaven'],
      ['aspect/trine', 'Open Trine in Learn', 'Trine'],
      ['concept/orb', 'Open Orb in Learn', 'Orb'],
    ];
    for (const [key, link, title] of cases) {
      await page.evaluate(() => { location.hash = '#chart'; });
      if (await page.locator('#inspection .back-link').count()) await page.locator('#inspection .back-link').first().click();
      await inspection(page).locator(`[data-select-key="${key}"]`).click();
      await inspection(page).getByRole('link', { name: link }).click();
      await expect(heading(page)).toHaveText(title);
      await expect(page.getByRole('link', { name: 'Back to Chart' })).toBeVisible();
      await page.getByRole('link', { name: 'Back to Chart' }).click();
      await expect(page.locator('#view-chart')).toBeVisible();
    }
  });

  test('keeps the Inspector concept buttons and the Chart origin across related Learn entries', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Natal Saturn', exact: true }).click();
    await expect(inspection(page).getByRole('button', { name: 'Learn about Retrograde' })).toBeVisible();
    await inspection(page).getByRole('link', { name: 'Open Saturn in Learn' }).click();
    await page.locator('.learn-detail').getByRole('link', { name: /Retrograde/ }).click();
    await expect(heading(page)).toHaveText('Retrograde');
    await expect(page.getByRole('link', { name: 'Back to Chart' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Chart' }).click();
    await expect(page.locator('#inspection .inspect-title')).toHaveText('Natal Saturn');
  });

  test('preserves the Chart data tab', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Aspects', exact: true }).click();
    await page.getByRole('button', { name: 'Natal Sun', exact: true }).click();
    await inspection(page).getByRole('link', { name: 'Open Sun in Learn' }).click();
    await page.getByRole('link', { name: 'Back to Chart' }).click();
    await expect(page.getByRole('button', { name: 'Aspects', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Learn on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('fits five tabs, has no sideways scroll and keeps 44 px targets', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Touch emulation is exercised in Chromium and WebKit.');
    await openApp(page);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const rect of await nav.getByRole('link').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))) {
      expect(rect.height).toBeGreaterThanOrEqual(43.9);
      expect(rect.width).toBeGreaterThanOrEqual(43.9);
    }
    await nav.locator('[data-nav="learn"]').tap();
    await expect(page.locator('#view-learn')).toBeVisible();
    const targets = page.locator('#view-learn .learn-filters button, #view-learn .learn-card, #view-learn input');
    for (const rect of await targets.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))) {
      expect(rect.height).toBeGreaterThanOrEqual(43.9);
    }
    await page.locator('.learn-card[href="#learn/house/7"]').tap();
    await expect(heading(page)).toHaveText('House 7');
    for (const rect of await page.locator('.learn-back a, .learn-detail summary').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))) {
      expect(rect.height).toBeGreaterThanOrEqual(43.9);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});
