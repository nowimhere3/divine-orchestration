import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

// Runtime dependencies whose copyright and license texts must ship with the build.
// @js-temporal/polyfill depends on jsbi; the other two are direct dependencies.
const NOTICE_PACKAGES = [
  '@astrodraw/astrochart',
  '@astrologer/ephemera',
  '@js-temporal/polyfill',
  'jsbi',
];

// Self-hosted fonts (SIL Open Font License 1.1). The license text, which carries each
// copyright notice, ships with the fonts and is repeated in the distributed notices.
const FONT_NOTICES = [
  { name: 'Inter (variable, latin subset)', file: 'src/assets/fonts/Inter-OFL.txt' },
  { name: 'Cormorant Garamond (latin subset)', file: 'src/assets/fonts/Cormorant-OFL.txt' },
];

function thirdPartyNotices(): Plugin {
  return {
    name: 'third-party-notices',
    apply: 'build',
    generateBundle() {
      const sections = NOTICE_PACKAGES.map((name) => {
        const dir = new URL(`./node_modules/${name}/`, import.meta.url);
        const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8')) as {
          version: string;
          license: string;
        };
        const license = readFileSync(new URL('LICENSE', dir), 'utf8').trim();
        return `${name} ${pkg.version} (${pkg.license})\n${'='.repeat(72)}\n${license}\n`;
      });
      for (const font of FONT_NOTICES) {
        const license = readFileSync(new URL(`./${font.file}`, import.meta.url), 'utf8').trim();
        sections.push(`${font.name} font (SIL Open Font License 1.1)
${'='.repeat(72)}
${license}
`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-NOTICES.txt',
        source:
          'Third-party software included in this application, with the copyright and license\n' +
          'notices required for redistribution.\n\n' +
          sections.join('\n\n'),
      });
    },
  };
}

// GitHub Pages project sites are served from /<repository>/. The slug is not final,
// so the production base is configurable: DIVINE_BASE=/other-slug/ npm run build
// (or `npm run build -- --base=/other-slug/`, which takes precedence). The dev server stays at /.
const PRODUCTION_BASE = '/divine-orchestration/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.DIVINE_BASE ?? PRODUCTION_BASE) : '/',
  plugins: [thirdPartyNotices()],
  server: {
    fs: {
      deny: [
        '**/.env',
        '**/.env.*',
        '**/*.{crt,pem}',
        '**/.git/**',
        '**/.sideline/**',
        '**/.playwright-browsers/**',
        '**/Plumbing SLC/**',
        '**/Third-Party References/**',
      ],
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
}));
