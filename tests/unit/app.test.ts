import { expect, test } from 'vitest';
import { applicationName } from '../../src/app';

test('uses the approved application name', () => {
  expect(applicationName).toBe('Divine Orchestration');
});
