import { byId } from './timeline';

export const VIEWS = ['chart', 'events', 'library', 'export'] as const;
export type ViewName = (typeof VIEWS)[number];

const TITLES: Record<ViewName, string> = {
  chart: 'Chart', events: 'Events', library: 'Library', export: 'Export',
};

/** Maps a location hash to a view; anything unrecognised falls back to the chart. */
export function viewFromHash(hash: string): ViewName {
  const name = hash.replace(/^#\/?/, '').split(/[?&]/)[0].toLowerCase();
  return (VIEWS as readonly string[]).includes(name) ? name as ViewName : 'chart';
}

/**
 * Hash-based view switching. Every view stays mounted in the document and is only
 * hidden, so form values, the chart, the Time Machine, search results and exports
 * keep their state when the user moves between views. Works on any static host.
 */
export function mountShell(signal: AbortSignal) {
  const panels = new Map(VIEWS.map(name => [name, document.querySelector<HTMLElement>(`[data-page="${name}"].view`)!]));
  const links = new Map(VIEWS.map(name => [name, document.querySelector<HTMLAnchorElement>(`[data-nav="${name}"]`)!]));
  let current: ViewName | null = null;

  function show(name: ViewName, moveFocus: boolean) {
    for (const view of VIEWS) {
      panels.get(view)!.hidden = view !== name;
      const link = links.get(view)!;
      if (view === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.body.dataset.view = name;
    document.title = name === 'chart' ? 'Divine Orchestration' : `${TITLES[name]} · Divine Orchestration`;
    if (moveFocus && current !== name) {
      window.scrollTo({ top: 0 });
      panels.get(name)!.querySelector<HTMLElement>('h2[tabindex="-1"]')?.focus({ preventScroll: true });
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
