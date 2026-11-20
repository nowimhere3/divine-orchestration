import { allEntries, entryById } from '../knowledge';
import type { Entry, EntryKind } from '../knowledge';
import { bulletList, quiet, sourcesBlock } from './inspector';
import { CATEGORIES, categoryLabel, learnHref, searchEntries } from './learn-model';
import type { LearnRoute } from './learn-model';
import { node } from './readings';
import { byId } from './timeline';

export interface LearnShown {
  readonly title: string;
  /** The heading that should take focus after an in-app route change. */
  readonly heading: HTMLElement;
}

const TITLE = 'Learn';

/**
 * The Learn glossary: a searchable index of every knowledge entry, and a page for each. The index is built
 * once and stays in the document, so the search text and category survive opening an entry and coming back.
 * The shell calls `render` on every route change and then handles the title and focus itself.
 */
export function mountLearn(signal: AbortSignal) {
  const root = byId('learn-root');
  let query = '';
  let kind: EntryKind | 'all' = 'all';

  const indexView = node('div');
  indexView.className = 'learn-index';
  const indexHeading = Object.assign(node('h2', 'Learn'), { id: 'learn-heading', tabIndex: -1 });
  const lede = Object.assign(node('p', 'A plain-language glossary for everything on the chart. Each entry keeps measurable astronomy apart from traditional symbolism.'), { className: 'lede' });
  const notice = Object.assign(node('p'), { className: 'learn-notice', hidden: true });
  notice.setAttribute('role', 'status');

  const search = Object.assign(node('input'), { type: 'search', id: 'learn-search', autocomplete: 'off', spellcheck: false });
  search.setAttribute('placeholder', 'Try “Saturn”, “trine” or “house”');
  const searchLabel = Object.assign(node('label', 'Search the glossary'), { htmlFor: 'learn-search' });
  const field = node('div');
  field.className = 'learn-search';
  field.append(searchLabel, search);

  const filters = node('div');
  filters.className = 'learn-filters';
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Category');
  const filterButtons = new Map<EntryKind | 'all', HTMLButtonElement>();
  const options: [EntryKind | 'all', string][] = [['all', 'All'], ...CATEGORIES.map((category): [EntryKind, string] => [category.kind, category.label])];
  for (const [value, label] of options) {
    const button = Object.assign(node('button', label), { type: 'button' });
    button.setAttribute('aria-pressed', String(value === 'all'));
    button.addEventListener('click', () => { kind = value; refresh(); }, { signal });
    filterButtons.set(value, button);
    filters.append(button);
  }

  const count = Object.assign(node('p'), { className: 'learn-count' });
  count.setAttribute('role', 'status');
  const results = node('div');
  results.className = 'learn-results';
  indexView.append(indexHeading, lede, notice, field, filters, count, results);

  const detailView = node('article');
  detailView.className = 'learn-detail';
  detailView.hidden = true;
  root.append(indexView, detailView);

  function symbolOf(entry: Entry) {
    const mark = Object.assign(node('span', entry.symbol ? `${entry.symbol}︎` : '✦'), { className: `learn-mark mark-${entry.kind}` });
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  }

  function card(entry: Entry) {
    const link = Object.assign(node('a'), { href: learnHref(entry.id), className: 'learn-card' });
    const text = node('span');
    text.className = 'learn-card-text';
    text.append(node('strong', entry.name), node('small', entry.tagline));
    link.append(symbolOf(entry), text);
    return link;
  }

  function list(entries: readonly Entry[]) {
    const ul = node('ul');
    ul.className = 'learn-cards';
    for (const entry of entries) {
      const item = node('li');
      item.append(card(entry));
      ul.append(item);
    }
    return ul;
  }

  function refresh() {
    for (const [value, button] of filterButtons) button.setAttribute('aria-pressed', String(value === kind));
    const found = searchEntries(query, kind);
    const filtering = query.trim() !== '' || kind !== 'all';
    count.textContent = filtering
      ? `${found.length} ${found.length === 1 ? 'entry matches' : 'entries match'}`
      : `${found.length} entries`;
    if (!found.length) {
      const reset = Object.assign(node('button', 'Clear search and category'), { type: 'button', className: 'secondary' });
      reset.addEventListener('click', () => {
        query = '';
        kind = 'all';
        search.value = '';
        refresh();
        search.focus();
      }, { signal });
      results.replaceChildren(quiet('Nothing in the glossary matches that. Try fewer words, or another category.'), reset);
      return;
    }
    if (filtering) {
      results.replaceChildren(list(found));
      return;
    }
    // Unfiltered: six labelled groups in reading order.
    results.replaceChildren(...CATEGORIES.map(category => {
      const section = node('section');
      section.className = 'learn-group';
      const entries = found.filter(entry => entry.kind === category.kind);
      const headingId = `learn-group-${category.kind}`;
      section.setAttribute('aria-labelledby', headingId);
      section.append(Object.assign(node('h3', `${category.label} (${entries.length})`), { id: headingId }), list(entries));
      return section;
    }));
  }

  search.addEventListener('input', () => { query = search.value; refresh(); }, { signal });
  refresh();

  function section(title: string, ...content: HTMLElement[]) {
    const block = node('section');
    block.className = 'learn-section';
    block.append(node('h3', title), ...content);
    return block;
  }

  function detail(entry: Entry, fromChart: boolean): LearnShown {
    const back = node('nav');
    back.className = 'learn-back';
    back.setAttribute('aria-label', 'Return');
    back.append(Object.assign(node('a', '← Back to Learn'), { href: '#learn' }));
    if (fromChart) back.append(Object.assign(node('a', 'Back to Chart'), { href: '#chart' }));

    const title = Object.assign(node('h2', entry.longName ?? entry.name), { tabIndex: -1 });
    const head = node('header');
    head.className = 'learn-head';
    const text = node('div');
    text.append(title, Object.assign(node('p', `${categoryLabel(entry.kind)} · ${entry.tagline}`), { className: 'learn-sub' }));
    head.append(symbolOf(entry), text);

    const parts: HTMLElement[] = [back, head, Object.assign(node('p', entry.summary), { className: 'learn-summary' }),
      section('Astronomical background', bulletList(entry.facts)),
      section('Traditional symbolism', quiet('Tradition, not measurement: long-standing associations, not predictions or facts about you.'), bulletList(entry.symbolism)),
      section('How to think about it', node('p', entry.reading))];
    if (entry.reflection) {
      const prompt = node('details');
      prompt.className = 'reflection';
      prompt.append(node('summary', 'A question to reflect on'), node('p', entry.reflection));
      parts.push(prompt);
    }
    const related = (entry.see ?? []).map(id => entryById(id)).filter((other): other is Entry => !!other);
    if (related.length) parts.push(section('Related', list(related)));
    parts.push(sourcesBlock(entry));
    detailView.replaceChildren(...parts);
    return { title: `${entry.name} · ${TITLE}`, heading: title };
  }

  function render(route: LearnRoute, fromChart: boolean): LearnShown {
    const entry = route.type === 'entry' ? entryById(route.id) : undefined;
    indexView.hidden = !!entry;
    detailView.hidden = !entry;
    if (entry) return detail(entry, fromChart);
    detailView.replaceChildren();
    notice.hidden = route.type !== 'unknown';
    notice.textContent = route.type === 'unknown' ? `There is no glossary entry called “${route.raw}”. Browse the index below.` : '';
    return { title: TITLE, heading: indexHeading };
  }

  return { render, total: allEntries().length };
}
