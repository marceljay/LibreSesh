import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../server/src/db.js';
import { schemaDiagram } from '../server/src/schemaDiagram.js';
import { schemaPageHtml } from '../server/src/schemaHtml.js';

describe('docs/schema.md', () => {
  it('matches what the migrations produce (run `npm run schema` when this fails)', () => {
    const committed = readFileSync(new URL('../docs/schema.md', import.meta.url), 'utf8');
    expect(committed).toBe(schemaDiagram(openDb(':memory:')));
  });

  it('names every table and every foreign key', () => {
    const db = openDb(':memory:');
    const page = schemaDiagram(db);
    const tables = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    for (const { name } of tables) {
      expect(page).toContain(`  ${name} {`);
      for (const fk of db.pragma(`foreign_key_list(${name})`) as {
        table: string;
        from: string;
      }[]) {
        expect(page).toContain(`--o{ ${name} : ${fk.from}`);
        expect(page).toContain(`[\`${fk.table}\`](#${fk.table})`);
      }
    }
  });
});

describe('schemaPageHtml', () => {
  it('leaves the diagram for Mermaid, inlines the library and columns the tables', async () => {
    const markdown = schemaDiagram(openDb(':memory:'));
    const html = await schemaPageHtml(markdown, '/* mermaid */');
    expect(html).toContain('<pre class="mermaid">erDiagram');
    expect(html).not.toContain('language-mermaid');
    expect(html).toContain('<script>/* mermaid */</script>');
    expect(html).toContain('<h2>Tables</h2><div class="tables">');
    expect(html).toContain('<h3><code>people</code></h3>');
    expect(html).toContain('href="#events"');
  });
});
