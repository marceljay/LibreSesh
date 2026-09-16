// Write web/public/openapi.json from the routers and the zod schemas, so the
// document Vite copies into the build is always the one this code produces.
// `tests/openapi.test.ts` regenerates and compares; run this when it fails.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDoc } from '../server/src/openapiDoc.js';
import pkg from '../package.json' with { type: 'json' };

const routes = fileURLToPath(new URL('../server/src/routes', import.meta.url));
const out = new URL('../web/public/openapi.json', import.meta.url);

writeFileSync(out, `${JSON.stringify(buildOpenApiDoc(routes, pkg.version), null, 2)}\n`);
console.log(`wrote ${out.pathname}`);
