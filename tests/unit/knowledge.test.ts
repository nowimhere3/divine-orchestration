import { describe, expect, it } from 'vitest';
import {
  allEntries, angleEntry, aspectEntry, bodyEntry, conceptEntry, entriesOfKind, entryForRef, houseEntry, parseElementKey,
  signEntry, SOURCES, sourcesFor, tipText,
} from '../../src/knowledge';

const planets = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

describe('knowledge library', () => {
  it('covers every element the wheel can show', () => {
    expect(entriesOfKind('body')).toHaveLength(10);
    expect(entriesOfKind('sign')).toHaveLength(12);
    expect(entriesOfKind('house')).toHaveLength(12);
    expect(entriesOfKind('aspect')).toHaveLength(5);
    expect(entriesOfKind('angle')).toHaveLength(2);
    expect(entriesOfKind('concept').map(entry => entry.id).sort()).toEqual([
      'concept/degrees', 'concept/house-systems', 'concept/natal-chart', 'concept/orb', 'concept/retrograde', 'concept/transits',
    ]);
    for (const id of planets) expect(bodyEntry(id), id).toBeDefined();
  });

  it('gives every entry a definition, facts, symbolism, a reading and real sources, with unique ids', () => {
    const entries = allEntries();
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.tagline.length, entry.id).toBeGreaterThan(3);
      expect(entry.summary.length, entry.id).toBeGreaterThan(30);
      expect(entry.facts.length, entry.id).toBeGreaterThan(0);
      expect(entry.symbolism.length, entry.id).toBeGreaterThan(0);
      expect(entry.reading.length, entry.id).toBeGreaterThan(20);
      expect(entry.sources.length, entry.id).toBeGreaterThan(0);
      for (const source of entry.sources) expect(SOURCES[source], `${entry.id} → ${source}`).toBeDefined();
      for (const see of entry.see ?? []) expect(allEntries().some(other => other.id === see), `${entry.id} → ${see}`).toBe(true);
    }
  });

  it('records attribution for every source and never mentions a commercial text', () => {
    for (const source of Object.values(SOURCES)) {
      expect(source.title).not.toBe('');
      expect(source.author).not.toBe('');
      expect(source.used).not.toBe('');
      if (source.url) expect(source.url).toMatch(/^https:\/\//);
    }
    expect(sourcesFor(['ptolemy']).map(source => source.id)).toEqual(['ptolemy']);
    const text = JSON.stringify(allEntries()).toLowerCase();
    for (const banned of ['chani', 'co-star', 'costar']) expect(text).not.toContain(banned);
  });

  it('keeps symbolism and prediction wording honest', () => {
    for (const entry of allEntries()) {
      const prose = [entry.summary, ...entry.facts, entry.reading].join(' ');
      expect(prose, entry.id).not.toMatch(/\byou will\b|\bwill happen\b|\bdestined\b/i);
    }
  });

  it('writes the hover labels the product asks for', () => {
    expect(tipText(bodyEntry('saturn')!)).toBe('Saturn · Structure and responsibility');
    expect(tipText(signEntry(9)!)).toBe('Capricorn · Cardinal Earth sign');
    expect(tipText(houseEntry(7)!)).toBe('House 7 · Partnerships');
    expect(tipText(aspectEntry('trine')!)).toBe('Trine · 120° relationship');
    expect(tipText(angleEntry('mc')!)).toBe('MC · Midheaven');
    expect(tipText(angleEntry('asc')!)).toBe('ASC · Ascendant');
  });

  it('orders signs and houses so an index maps straight to an entry', () => {
    expect(signEntry(0)!.name).toBe('Aries');
    expect(signEntry(11)!.name).toBe('Pisces');
    expect(signEntry(4)!.tagline).toBe('Fixed Fire sign');
    expect(signEntry(5)!.tagline).toBe('Mutable Earth sign');
    for (let index = 0; index < 12; index += 1) expect(signEntry(index)!.id).toBe(`sign/${index}`);
    for (let number = 1; number <= 12; number += 1) expect(houseEntry(number)!.id).toBe(`house/${number}`);
  });

  it('parses selectable keys and rejects everything else', () => {
    expect(parseElementKey('sign/0')).toEqual({ type: 'sign', index: 0 });
    expect(parseElementKey('sign/11')).toEqual({ type: 'sign', index: 11 });
    expect(parseElementKey('house/12')).toEqual({ type: 'house', number: 12 });
    expect(parseElementKey('angle/mc')).toEqual({ type: 'angle', which: 'mc' });
    expect(parseElementKey('aspect/trine')).toEqual({ type: 'aspect', aspect: 'trine' });
    expect(parseElementKey('concept/orb')).toEqual({ type: 'concept', id: 'orb' });
    for (const bad of ['', 'sign/12', 'sign/-1', 'sign/01', 'house/0', 'house/13', 'angle/ic', 'aspect/quincunx',
      'concept/nope', 'concept/constructor', 'aspect/toString', 'natal/sun', 'transit/moon', '[{"a":1}]', 'sign/1/2']) {
      expect(parseElementKey(bad), bad).toBeNull();
    }
    expect(entryForRef(parseElementKey('house/7')!)?.name).toBe('House 7');
    expect(conceptEntry('orb')?.name).toBe('Orb');
  });
});
