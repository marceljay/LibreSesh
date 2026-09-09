// Write docs/schema.md from a freshly migrated in-memory database, so the
// page always shows the schema this build of the migrations produces.
import { writeFileSync } from 'node:fs';
import { openDb } from '../server/src/db.js';
import { schemaDiagram } from '../server/src/schemaDiagram.js';

const out = new URL('../docs/schema.md', import.meta.url);
writeFileSync(out, schemaDiagram(openDb(':memory:')));
console.log(`wrote ${out.pathname}`);
