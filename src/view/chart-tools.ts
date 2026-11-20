import { PLANET_IDS } from '../domain/chart';
import type { PlanetId } from '../domain/chart';
import { MAX_ZOOM } from './astro-wheel';
import type { AstroWheel } from './astro-wheel';
import type { PositionMap } from './chart-data';
import { planetName } from './chart-data';
import { planetGlyphs } from './inspector';
import { node } from './readings';
import { byId } from './timeline';

export interface ChartToolsHooks {
  select(key: string): void;
  /** The Inspector container, whose title names the current selection. */
  inspection: HTMLElement;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Touch and small-screen helpers around the wheel: zoom controls, a row of full-size planet buttons
 * (the accessible alternative to tapping small glyphs), and a bar that keeps the Inspector in reach.
 */
export function mountChartTools(wheel: AstroWheel, hooks: ChartToolsHooks, signal: AbortSignal) {
  const zoomIn = byId<HTMLButtonElement>('wheel-zoom-in');
  const zoomOut = byId<HTMLButtonElement>('wheel-zoom-out');
  const reset = byId<HTMLButtonElement>('wheel-zoom-reset');
  const level = byId('wheel-zoom-level');
  const strip = byId('planet-strip');
  const bar = byId('selection-bar');
  const summary = byId('selection-summary');
  const toggle = byId<HTMLButtonElement>('selection-toggle');
  let stripKeys = '';
  let selected = '';

  const step = 1.5;
  // With a planet selected, zooming keeps that planet where it is, so it never leaves the view.
  zoomIn.addEventListener('click', () => wheel.zoomBy(step, wheel.pointOf(selected)), { signal });
  zoomOut.addEventListener('click', () => wheel.zoomBy(1 / step, wheel.pointOf(selected)), { signal });
  reset.addEventListener('click', () => wheel.resetView(), { signal });
  wheel.onViewChange(zoom => {
    level.textContent = `${Math.round(zoom * 100)}%`;
    zoomIn.disabled = zoom >= MAX_ZOOM - .001;
    zoomOut.disabled = zoom <= 1.001;
    reset.disabled = zoom <= 1.001;
  });
  level.textContent = '100%';
  zoomOut.disabled = reset.disabled = true;

  /** Builds the planet buttons when the set of available planets changes. */
  function refreshStrip(natal: PositionMap, transit: PositionMap) {
    const keys = (['natal', 'transit'] as const).flatMap(layer =>
      PLANET_IDS.filter(id => (layer === 'natal' ? natal : transit).has(id)).map(id => `${layer}/${id}`));
    const signature = keys.join();
    if (signature === stripKeys) return;
    stripKeys = signature;
    const rows = (['natal', 'transit'] as const).map(layer => {
      const row = node('div');
      row.className = `strip-row strip-${layer}`;
      row.append(Object.assign(node('span', layer === 'natal' ? 'Natal' : 'Transit'), { className: 'strip-label' }));
      for (const key of keys.filter(candidate => candidate.startsWith(`${layer}/`))) {
        const id = key.split('/')[1] as PlanetId;
        const button = node('button');
        button.type = 'button';
        button.className = 'strip-button';
        button.dataset.stripKey = key;
        button.setAttribute('aria-label', `Select ${layer === 'natal' ? 'Natal' : 'Transit'} ${planetName(id)}`);
        button.setAttribute('aria-pressed', String(key === selected));
        const mark = node('span', `${planetGlyphs[id]}︎`);
        mark.setAttribute('aria-hidden', 'true');
        button.append(mark);
        row.append(button);
      }
      return row;
    });
    strip.replaceChildren(...rows.filter(row => row.querySelector('button')));
  }
  strip.addEventListener('click', event => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-strip-key]')?.dataset.stripKey;
    if (key) hooks.select(key);
  }, { signal });

  function updateBar() {
    const title = hooks.inspection.querySelector('.inspect-title')?.textContent ?? '';
    const place = hooks.inspection.querySelector('.inspect-place')?.textContent ?? '';
    bar.hidden = !selected || !title;
    // The place (sign and degree) is secondary: it drops away on narrow screens so the name never truncates.
    const detail = Object.assign(document.createElement('span'), { className: 'selection-place', textContent: place ? ` · ${place}` : '' });
    summary.replaceChildren(title, detail);
  }

  /** Mirrors the selection onto the strip and the bar. */
  function markSelection(key: string) {
    selected = key;
    for (const button of strip.querySelectorAll<HTMLElement>('[data-strip-key]')) {
      button.setAttribute('aria-pressed', String(button.dataset.stripKey === key));
    }
    updateBar();
  }

  const smooth = () => (reducedMotion() ? 'auto' : 'smooth') as ScrollBehavior;
  // The bar sits in the page flow under the wheel, so scrolling back up to the chart is just a scroll.
  toggle.addEventListener('click', () => {
    hooks.inspection.scrollIntoView({ behavior: smooth(), block: 'start' });
    hooks.inspection.querySelector<HTMLElement>('.inspect-title')?.focus({ preventScroll: true });
  }, { signal });
  byId('selection-clear').addEventListener('click', () => {
    hooks.select('');
    byId('wheel-heading').focus({ preventScroll: true });
  }, { signal });
  return { refreshStrip, markSelection, updateBar };
}
