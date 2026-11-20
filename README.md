# Divine Orchestration

A browser-based astrology observatory for exploring natal charts, transits and planetary events. Saved profiles stay in the browser. Backup and export files are created locally.

## Local development

Use Node.js 24 and npm. Install the locked dependencies and run the Vite dev server.

```sh
npm ci
npm run dev
```

Install the browser test binaries once, then run the full verification gate.

```sh
npm run test:e2e:install
npm run check
```

## Production build

`npm run build` writes the production site to `dist/`. To refresh the tracked GitHub Pages site under `docs/`, run:

```sh
npm run build -- --base=/divine-orchestration/ --outDir=docs
node -e "require('node:fs').writeFileSync('docs/.nojekyll', '')"
```

Vite replaces the generated output on each build. The second command restores the marker that lets GitHub Pages serve those files directly. Commit the refreshed `docs/` together with the corresponding source. Runtime dependency and font licenses are in `docs/THIRD-PARTY-NOTICES.txt`.

## GitHub Pages

In the repository, open **Settings → Pages → Build and deployment**. Select **Deploy from a branch**, choose **main** and **/docs**, then click **Save**. Leave the custom domain blank. The expected address after activation is [nowimhere3.github.io/divine-orchestration](https://nowimhere3.github.io/divine-orchestration/).

Publishing from a private repository requires an eligible GitHub plan. The published Pages site can be publicly accessible. See [GitHub's publishing-source settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
