// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allEntries, entriesOfKind } from '../../src/knowledge';
import { CATEGORIES, parseLearnRoute, searchEntries } from '../../src/view/learn-model';
import { viewFromHash } from '../../src/view/shell';

describe('Learn routes', () => {
  it('resolves every one of the 49 entry ids exactly', () => {
    const entries = allEntries();
    expect(entries).toHaveLength(49);
    for (const entry of entries) {
      expect(parseLearnRoute(`#learn/${entry.id}`), entry.id).toEqual({ type: 'entry', id: entry.id });
    }
  });

  it('accepts the index, a leading slash, a query suffix and a trailing slash', () => {
    expect(parseLearnRoute('#learn')).toEqual({ type: 'index' });
    expect(parseLearnRoute('#/learn')).toEqual({ type: 'index' });
    expect(parseLearnRoute('#learn/')).toEqual({ type: 'index' });
    expect(parseLearnRoute('#LEARN/body/saturn?x=1')).toEqual({ type: 'entry', id: 'body/saturn' });
    expect(parseLearnRoute('#learn/body%2Fsaturn')).toEqual({ type: 'entry', id: 'body/saturn' });
  });

  it('keeps malformed entries inside Learn and leaves other routes alone', () => {
    expect(parseLearnRoute('#learn/body/vulcan')).toEqual({ type: 'unknown', raw: 'body/vulcan' });
    expect(parseLearnRoute('#learn/%E0%A4%A')).toMatchObject({ type: 'unknown' });
    expect(parseLearnRoute('#learn/constructor')).toMatchObject({ type: 'unknown' });
    expect(parseLearnRoute('#chart')).toBeNull();
    expect(parseLearnRoute('#learning')).toBeNull();
    expect(parseLearnRoute('')).toBeNull();
  });

  it('adds Learn to the view router without disturbing the legacy fallback', () => {
    expect(viewFromHash('#learn')).toBe('learn');
    expect(viewFromHash('#learn/sign/9')).toBe('learn');
    expect(viewFromHash('#export')).toBe('export');
    expect(viewFromHash('#nonsense')).toBe('chart');
    expect(viewFromHash('')).toBe('chart');
  });
});

describe('Learn search', () => {
  it('counts every category and the whole glossary', () => {
    expect(CATEGORIES.map(category => entriesOfKind(category.kind).length)).toEqual([10, 12, 12, 5, 2, 8]);
    expect(searchEntries('')).toHaveLength(49);
    for (const category of CATEGORIES) expect(searchEntries('', category.kind)).toHaveLength(entriesOfKind(category.kind).length);
  });

  it('matches case-insensitively on names, taglines and category labels', () => {
    expect(searchEntries('SATURN').map(entry => entry.id)).toContain('body/saturn');
    expect(searchEntries('structure and responsibility').map(entry => entry.id)).toContain('body/saturn');
    expect(searchEntries('trine').map(entry => entry.id)).toContain('aspect/trine');
    expect(searchEntries('planets', 'body')).toHaveLength(10);
  });

  it('requires every term (AND) and combines with the category', () => {
    const both = searchEntries('capricorn earth').map(entry => entry.id);
    expect(both).toContain('sign/9');
    expect(searchEntries('capricorn zzzzqqq')).toHaveLength(0);
    expect(searchEntries('  capricorn   ', 'sign').map(entry => entry.id)).toContain('sign/9');
    expect(searchEntries('capricorn', 'house').map(entry => entry.kind)).toEqual(expect.arrayContaining([]));
    for (const entry of searchEntries('capricorn', 'house')) expect(entry.kind).toBe('house');
  });
});
