import { allEntries, entryById } from '../knowledge';
import type { Entry, EntryKind } from '../knowledge';

/** The categories offered in Learn, in reading order. */
export const CATEGORIES: readonly { readonly kind: EntryKind; readonly label: string }[] = [
  { kind: 'body', label: 'Planets' },
  { kind: 'sign', label: 'Signs' },
  { kind: 'house', label: 'Houses' },
  { kind: 'aspect', label: 'Aspects' },
  { kind: 'angle', label: 'Angles' },
  { kind: 'concept', label: 'Ideas' },
];

export const categoryLabel = (kind: EntryKind) => CATEGORIES.find(category => category.kind === kind)!.label;

export type LearnRoute =
  | { readonly type: 'index' }
  | { readonly type: 'entry'; readonly id: string }
  | { readonly type: 'unknown'; readonly raw: string };

/**
 * Reads `#learn` and `#learn/<entry id>` (for example `#learn/body/saturn`). Returns null for any other
 * top-level view. The leading slash and a `?query` suffix are accepted, like the other routes.
 */
export function parseLearnRoute(hash: string): LearnRoute | null {
  const path = hash.replace(/^#\/?/, '').split(/[?&]/)[0];
  const [head, ...rest] = path.split('/');
  if (head.toLowerCase() !== 'learn') return null;
  let raw = rest.join('/');
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw text */ }
  raw = raw.replace(/\/+$/, '');
  if (!raw) return { type: 'index' };
  return entryById(raw) ? { type: 'entry', id: raw } : { type: 'unknown', raw };
}

export const learnHref = (id: string) => `#learn/${id}`;

/** Everything a person could search for in an entry, lower-cased. */
function haystack(entry: Entry) {
  return [entry.name, entry.longName ?? '', entry.tagline, entry.summary, ...entry.facts, ...entry.symbolism, entry.reading,
    categoryLabel(entry.kind), entry.kind].join(' ').toLowerCase();
}

const searchable = new Map(allEntries().map(entry => [entry.id, haystack(entry)]));

/** Case-insensitive, whitespace-separated terms that must all match, within an optional category. */
export function searchEntries(query: string, kind: EntryKind | 'all' = 'all'): readonly Entry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return allEntries().filter(entry => (kind === 'all' || entry.kind === kind)
    && terms.every(term => searchable.get(entry.id)!.includes(term)));
}
