import { marked } from 'marked';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The schema page (see `schemaDiagram`) as a self-contained printable HTML
 * document: the Markdown rendered, the Mermaid fence left as a `pre.mermaid`
 * for the inlined library to draw, and the per-table sections flowed into
 * columns. `mermaidJs` is the library source, inlined so the page loads with
 * no network. When the drawing finishes, `window.__schemaReady` is `'ok'`,
 * or `'error: …'` — the printer waits on that.
 */
export async function schemaPageHtml(markdown: string, mermaidJs: string): Promise<string> {
  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }) =>
    lang === 'mermaid'
      ? `<pre class="mermaid">${escapeHtml(text)}</pre>\n`
      : `<pre><code>${escapeHtml(text)}</code></pre>\n`;
  const body = await marked.parse(markdown, { renderer });
  const tablesAt = body.indexOf('<h2>Tables</h2>');
  const content =
    tablesAt === -1
      ? body
      : `${body.slice(0, tablesAt)}<h2>Tables</h2><div class="tables">${body.slice(tablesAt + '<h2>Tables</h2>'.length)}</div>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Database schema</title>
<style>
  @page { size: A3 landscape; margin: 12mm; }
  body { font: 11px/1.4 system-ui, sans-serif; color: #1c1917; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  h2 { font-size: 16px; margin: 0 0 8px; page-break-before: always; }
  h3 { font-size: 12px; margin: 10px 0 2px; }
  h3 + ul { margin: 0 0 6px 0; padding-left: 14px; }
  li { margin: 1px 0; }
  code { font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; background: #f5f5f4; padding: 0 2px; border-radius: 2px; }
  a { color: inherit; text-decoration: none; }
  p { margin: 0 0 6px; max-width: 900px; }
  pre.mermaid { page-break-before: always; page-break-inside: avoid; margin: 0; text-align: center; }
  pre.mermaid svg { max-width: 100% !important; max-height: 268mm; height: auto; }
  .tables { column-count: 3; column-gap: 18px; }
  .tables h3 { break-after: avoid; }
  .tables ul { break-inside: avoid; }
</style></head>
<body>
${content}
<script>${mermaidJs}</script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', er: { useMaxWidth: true } });
  mermaid.run().then(
    () => { window.__schemaReady = 'ok'; },
    (e) => { window.__schemaReady = 'error: ' + (e && e.message ? e.message : String(e)); },
  );
</script>
</body></html>`;
}
