/**
 * Print the schema page (see server/src/schemaDiagram.ts) to a PDF.
 *
 * The page is regenerated from a freshly migrated in-memory database, not
 * read from docs/schema.md, so the PDF is always the schema this build
 * produces. The Mermaid library is inlined from node_modules and the page is
 * printed by the container's Chromium through Playwright, as the browser pass
 * does — no network. A3 landscape: the diagram is scaled to fit one page and
 * stays vector, so it reads at any zoom on screen; on paper its text is
 * small. Output: docs/schema.pdf, or the path given as the first argument.
 * Set CHROMIUM to use another browser binary.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { openDb } from '../server/src/db.js';
import { schemaDiagram } from '../server/src/schemaDiagram.js';
import { schemaPageHtml } from '../server/src/schemaHtml.js';

const CHROMIUM = process.env.CHROMIUM ?? '/usr/bin/chromium';
const out = process.argv[2] ?? new URL('../docs/schema.pdf', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const mermaidJs = readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');

const html = await schemaPageHtml(schemaDiagram(openDb(':memory:')), mermaidJs);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as { __schemaReady?: string }).__schemaReady, null, {
    timeout: 60_000,
  });
  const ready = await page.evaluate(() => (window as { __schemaReady?: string }).__schemaReady);
  if (ready !== 'ok' || errors.length > 0) {
    throw new Error(
      `Mermaid did not render: ${ready}${errors.length ? '\n' + errors.join('\n') : ''}`,
    );
  }
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: out,
    format: 'A3',
    landscape: true,
    printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
  });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
