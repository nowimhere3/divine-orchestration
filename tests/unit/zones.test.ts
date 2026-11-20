import { expect, test } from 'vitest';
import { describeZoneSelection, isValidIanaZone, searchTimeZones } from '../../src/time/zones';

test('searchTimeZones surfaces Calgary / Edmonton / Alberta for friendly queries and IANA ids', () => {
  for (const query of ['Calgary', 'Edmonton', 'Alberta', 'America/Edmonton', '']) {
    const results = searchTimeZones(query);
    expect(results.some(entry => entry.id === 'America/Edmonton')).toBe(true);
  }
  expect(searchTimeZones('calgary')[0].id).toBe('America/Edmonton');
  expect(searchTimeZones('london')[0].id).toBe('Europe/London');
  expect(searchTimeZones('tokyo')[0].id).toBe('Asia/Tokyo');
});

test('searchTimeZones also finds uncommon IANA zones from runtime data', () => {
  const results = searchTimeZones('Katmandu');
  expect(results.some(entry => entry.id === 'Asia/Katmandu')).toBe(true);
  expect(searchTimeZones('Fiji').some(entry => entry.id === 'Pacific/Fiji')).toBe(true);
});

test('isValidIanaZone accepts valid IANA zones and aliases while rejecting non-zones', () => {
  expect(isValidIanaZone('America/Edmonton')).toBe(true);
  expect(isValidIanaZone('Canada/Mountain')).toBe(true);
  expect(isValidIanaZone('UTC')).toBe(true);
  expect(isValidIanaZone('Calgary')).toBe(false);
  expect(isValidIanaZone('Not/A_Zone')).toBe(false);
  expect(isValidIanaZone('')).toBe(false);
});

test('describeZoneSelection explains zones clearly without requiring UTC knowledge', () => {
  const alberta2027 = describeZoneSelection('America/Edmonton', '2027-01-15', '12:00', () => 69);
  expect(alberta2027.valid).toBe(true);
  expect(alberta2027.title).toContain('Calgary / Edmonton · Alberta');
  expect(alberta2027.detail).toContain('Permanent Alberta Time');

  const edmonton1995 = describeZoneSelection('America/Edmonton', '1995-01-15', '12:00', () => 69);
  expect(edmonton1995.valid).toBe(true);
  expect(edmonton1995.detail).toContain('7 hours behind Greenwich');

  const manual = describeZoneSelection('Canada/Mountain', '1960-06-01', '12:00', () => 33);
  expect(manual.valid).toBe(true);
  expect(manual.known).toBe(false);
  expect(manual.title).toContain('Manual IANA zone');
  expect(manual.detail).toContain('Historical zone rules before 1970');

  const invalid = describeZoneSelection('Calgary', '2000-01-01', '12:00', () => 64);
  expect(invalid.valid).toBe(false);
  expect(invalid.title).toBe('Unrecognized time zone');
});
