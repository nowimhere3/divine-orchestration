import { expect, test } from 'vitest';
import { angularSeparation, calculateAspects, createAspectRuleSet } from '../../src/domain/aspects';
import { createDateOnlyNatalChart } from '../../src/domain/chart';

test('calculates stable conjunctions across zero with any input order', () => {
  const from = { chartId: 'natal', planetId: 'sun', longitudeDeg: 359 } as const;
  const to = { chartId: 'transit', planetId: 'sun', longitudeDeg: 1 } as const;
  const result = calculateAspects([from, to]);
  expect(result).toEqual(calculateAspects([to, from]));
  expect(result[0]).toMatchObject({
    from: { chartId: 'natal', planetId: 'sun' }, to: { chartId: 'transit', planetId: 'sun' },
    aspect: 'conjunction', exactAngleDeg: 0, separationDeg: 2, orbDeg: 2, ruleSetVersion: 0,
  });
  expect(angularSeparation(-1, 361)).toBe(2);
  expect(angularSeparation(10, 190)).toBe(180);
});

test('uses independent inclusive orbs and selects the nearest exact angle in overlap', () => {
  const from = { chartId: 'natal', planetId: 'sun', longitudeDeg: 0 } as const;
  const to = { chartId: 'natal', planetId: 'moon', longitudeDeg: 92 } as const;
  expect(calculateAspects([from, to], createAspectRuleSet({ square: 1 }))).toEqual([]);
  expect(calculateAspects([from, to], createAspectRuleSet({ square: 2, sextile: 40 }))[0]).toMatchObject({
    aspect: 'square', orbDeg: 2, allowedOrbDeg: 2,
  });
  expect(() => createAspectRuleSet({ square: -1 })).toThrow(RangeError);
  expect(() => calculateAspects([from, from])).toThrow(/unique/);
  expect(() => calculateAspects([{ ...from, longitudeDeg: NaN }])).toThrow(/finite/);
});

test('date-only chart leaves houses, angles and instantaneous planet positions unavailable', () => {
  const chart = createDateOnlyNatalChart({
    id: 'natal', label: null,
    settings: { zodiac: 'tropical', requestedHouseSystem: 'Placidus', observer: { latitudeDeg: 51, longitudeDeg: 0 } },
    time: { kind: 'unknown-time', input: { date: '1980-03-03', time: null }, calendar: 'proleptic-gregorian' },
  });
  expect(chart.houses).toEqual({ status: 'unavailable', reason: 'unknown-birth-time' });
  expect(chart.planets).toEqual({ status: 'unavailable', reason: 'unknown-birth-time' });
  expect(chart.time).not.toHaveProperty('jdUt');
});
