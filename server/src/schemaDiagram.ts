import type { Db } from './db.js';

/**
 * Render the live schema — whatever the migrations produce today — as a
 * Markdown page with a Mermaid entity diagram and, per table, what it points
 * at and what points at it. Read straight from SQLite's own pragmas, so it
 * cannot drift from the migrations: `npm run schema` writes `docs/schema.md`
 * and `tests/schemaDiagram.test.ts` fails when that file is behind.
 */

interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface ForeignKey {
  table: string;
  from: string;
  to: string;
}

interface Index {
  name: string;
  unique: number;
  origin: 'c' | 'u' | 'pk';
  partial: number;
}

interface Table {
  name: string;
  columns: Column[];
  foreignKeys: ForeignKey[];
  uniques: { columns: string[]; partial: boolean }[];
}

function readTables(db: Db): Table[] {
  const names = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  return names.map((name) => {
    const uniques = (db.pragma(`index_list(${name})`) as Index[])
      .filter((i) => i.unique === 1 && i.origin !== 'pk')
      .map((i) => ({
        columns: (db.pragma(`index_info(${i.name})`) as { seqno: number; name: string }[])
          .sort((a, b) => a.seqno - b.seqno)
          .map((c) => c.name),
        partial: i.partial === 1,
      }))
      .sort((a, b) => a.columns.join().localeCompare(b.columns.join()));
    return {
      name,
      columns: db.pragma(`table_info(${name})`) as Column[],
      foreignKeys: (db.pragma(`foreign_key_list(${name})`) as ForeignKey[]).sort((a, b) =>
        a.from.localeCompare(b.from),
      ),
      uniques,
    };
  });
}

function entity(table: Table): string {
  const fkColumns = new Set(table.foreignKeys.map((fk) => fk.from));
  const uniqueColumns = new Set(
    table.uniques.filter((u) => u.columns.length === 1 && !u.partial).map((u) => u.columns[0]),
  );
  const lines = table.columns.map((c) => {
    const keys: string[] = [];
    if (c.pk) keys.push('PK');
    if (fkColumns.has(c.name)) keys.push('FK');
    if (uniqueColumns.has(c.name)) keys.push('UK');
    const notes: string[] = [];
    if (!c.pk && c.notnull === 0) notes.push('nullable');
    if (c.dflt_value !== null) notes.push(`default ${c.dflt_value.replace(/"/g, "'")}`);
    const type = c.type === '' ? 'ANY' : c.type.replace(/\s+/g, '_');
    const key = keys.length > 0 ? ` ${keys.join(', ')}` : '';
    const note = notes.length > 0 ? ` "${notes.join(', ')}"` : '';
    return `    ${type} ${c.name}${key}${note}`;
  });
  return `  ${table.name} {\n${lines.join('\n')}\n  }`;
}

function relationships(tables: Table[]): string[] {
  const out: string[] = [];
  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      const column = table.columns.find((c) => c.name === fk.from);
      const parentEnd = column && column.notnull === 0 && !column.pk ? '|o' : '||';
      out.push(`  ${fk.table} ${parentEnd}--o{ ${table.name} : ${fk.from}`);
    }
  }
  return out;
}

function tableSection(table: Table, all: Table[]): string {
  const lines = [`### \`${table.name}\``, ''];
  const outgoing = table.foreignKeys.map(
    (fk) => `\`${fk.from}\` → [\`${fk.table}\`](#${fk.table}).\`${fk.to}\``,
  );
  const incoming = all
    .flatMap((t) => t.foreignKeys.filter((fk) => fk.table === table.name).map((fk) => ({ t, fk })))
    .map(({ t, fk }) => `[\`${t.name}\`](#${t.name}).\`${fk.from}\``);
  lines.push(`- **References:** ${outgoing.length > 0 ? outgoing.join(', ') : 'nothing'}`);
  lines.push(`- **Referenced by:** ${incoming.length > 0 ? incoming.join(', ') : 'nothing'}`);
  const pk = table.columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
  lines.push(`- **Primary key:** ${pk.map((c) => `\`${c.name}\``).join(', ')}`);
  if (table.uniques.length > 0) {
    lines.push(
      `- **Unique:** ${table.uniques
        .map(
          (u) =>
            u.columns.map((c) => `\`${c}\``).join(' + ') +
            (u.partial ? ' (partial — see the migration for the condition)' : ''),
        )
        .join('; ')}`,
    );
  }
  return lines.join('\n');
}

export function schemaDiagram(db: Db): string {
  const tables = readTables(db);
  const head = [
    '# Database schema',
    '',
    '_Generated from the migrations by `npm run schema` — do not edit by hand._',
    '_`tests/schemaDiagram.test.ts` fails when this page is behind the migrations._',
    '',
    'Every deployment has this schema, demo or production: the tables are what',
    'the files in `server/migrations` make, and only the rows differ. Read this',
    'beside the Data model section of `ARCHITECTURE.md`, which says what each',
    'table is for; this page says what it contains and what links to what.',
    '',
    'Crow’s feet: `||` exactly one, `|o` zero or one (a nullable reference),',
    '`o{` many. Each line is labelled with the referencing column. `PK` primary',
    'key, `FK` foreign key, `UK` unique on its own; multi-column unique indexes',
    'are listed under the table.',
    '',
    '```mermaid',
    'erDiagram',
    ...tables.map(entity),
    ...relationships(tables),
    '```',
    '',
    '## Tables',
    '',
  ];
  return head.join('\n') + tables.map((t) => tableSection(t, tables)).join('\n\n') + '\n';
}
