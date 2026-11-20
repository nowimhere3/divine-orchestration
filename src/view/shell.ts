import { parseLearnRoute } from './learn-model';
import type { LearnRoute } from './learn-model';
import type { LearnShown } from './learn';
import { byId } from './timeline';

export const VIEWS = ['chart', 'events', 'library', 'export', 'learn'] as const;
export type ViewName = (typeof VIEWS)[number];

const TITLES: Record<ViewName, string> = {
  chart: 'Chart', events: 'Events', library: 'Library', export: 'Export', learn: 'Learn',
};

/** Maps a location hash to a view; anything unrecognised falls back to the chart. */
export function viewFromHash(hash: string): ViewName {
  const name = hash.replace(/^#\/?/, '').split(/[?&]/)[0].split('/')[0].toLowerCase();
  return (VIEWS as readonly string[]).includes(name) ? name as ViewName : 'chart';
}

/**
 * Hash-based view switching. Every view stays mounted in the document and is only
 * hidden, so form values, the chart, the Time Machine, search results and exports
 * keep their state when the user moves between views. Works on any static host.
 */
export function mountShell(signal: AbortSignal, renderLearn?: (route: LearnRoute, fromChart: boolean) => LearnShown) {
  const panels = new Map(VIEWS.map(name => [name, document.querySelector<HTMLElement>(`[data-page="${name}"].view`)!]));
  const links = new Map(VIEWS.map(name => [name, document.querySelector<HTMLAnchorElement>(`[data-nav="${name}"]`)!]));
  let current: ViewName | null = null;
  // True while a Learn visit began on the chart, so Learn can offer a way back to it.
  let learnFromChart = false;

  function show(name: ViewName, moveFocus: boolean) {
    if (name === 'learn' && current !== 'learn') learnFromChart = current === 'chart';
    // Learn renders first, so the title and focus below describe what is actually on screen.
    const learn = name === 'learn' && renderLearn ? renderLearn(parseLearnRoute(location.hash) ?? { type: 'index' }, learnFromChart) : null;
    for (const view of VIEWS) {
      panels.get(view)!.hidden = view !== name;
      const link = links.get(view)!;
      if (view === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.body.dataset.view = name;
    document.title = learn ? `${learn.title} · Divine Orchestration`
      : name === 'chart' ? 'Divine Orchestration' : `${TITLES[name]} · Divine Orchestration`;
    // Moving between Learn pages is a route change too, even though the view stays the same.
    if (moveFocus && (current !== name || name === 'learn')) {
      window.scrollTo({ top: 0 });
      (learn?.heading ?? panels.get(name)!.querySelector<HTMLElement>('h2[tabindex="-1"]'))?.focus({ preventScroll: true });
    }
    current = name;
  }

  // The hash selects the view, so the skip link moves focus without touching it.
  document.querySelector('.skip-link')?.addEventListener('click', event => {
    event.preventDefault();
    byId('main-content').focus();
  }, { signal });
  window.addEventListener('hashchange', () => show(viewFromHash(location.hash), true), { signal });
  show(viewFromHash(location.hash), false);

  return {
    current: () => current!,
    go(name: ViewName) { if (location.hash !== `#${name}`) location.hash = name; },
  };
}

/** Opens the birth-details dialog and wires its close controls. */
export function mountBirthDialog(signal: AbortSignal) {
  const dialog = byId<HTMLDialogElement>('birth-dialog');
  const open = () => {
    if (!dialog.open) dialog.showModal();
    byId('birth-date').focus();
  };
  byId('edit-birth').addEventListener('click', open, { signal });
  byId('birth-close').addEventListener('click', () => dialog.close(), { signal });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }, { signal });
  dialog.addEventListener('close', () => byId('edit-birth').focus(), { signal });
  return { open, close: () => { if (dialog.open) dialog.close(); } };
}
