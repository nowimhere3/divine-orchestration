import { resolve } from 'node:path';
import { build } from 'vite';
import { expect, test } from 'vitest';

test('Vite emits a same-origin WASM URL under the GitHub Pages base', async () => {
  const buildResult = await build({
    configFile: false,
    base: '/divine-orchestration/',
    logLevel: 'silent',
    build: {
      write: false,
      rolldownOptions: { input: resolve('tests/e2e/fixtures/engine.html') },
    },
  });
  if (Array.isArray(buildResult) || !('output' in buildResult)) {
    throw new Error('Expected one Vite build output.');
  }
  const wasm = buildResult.output.find(item => item.type === 'asset' && item.fileName.endsWith('.wasm'));
  expect(wasm).toBeDefined();
  const code = buildResult.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
  expect(code).toContain(`/divine-orchestration/${wasm!.fileName}`);
  expect(code).not.toMatch(/node:fs|Third-Party References|swisseph/i);
});
