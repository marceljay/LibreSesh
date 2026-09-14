- **The build and test tools took their last two majors.** Vitest 3 → 5
  carried the two moderate advisories `npm audit` still listed, a path
  traversal in its module mocker that only a running test process could
  reach; the audit reads **0** again. Vite 6 → 8 swaps esbuild and Rollup
  for Oxc and Rolldown underneath, and raises the browsers the bundle is
  built for to Chrome 111, Firefox 114 and Safari 16.4 — anything older
  gets the same app it did before only if it can run that syntax. Nothing
  in the served output changes on purpose: the built app was driven through
  headless Chromium with console and network clean, and the dev server's
  API proxy behaves as before. Neither package runs in the deployed image.
