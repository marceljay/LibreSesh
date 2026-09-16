import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDoc, readEndpoints, SUMMARIES } from '../server/src/openapiDoc.js';
import pkg from '../package.json' with { type: 'json' };

/**
 * `web/public/openapi.json` is generated, so the failure worth catching is a
 * committed copy that no longer matches the code — the same shape as
 * `docs/schema.md` and its test. Run `npm run openapi` when the first one fails.
 *
 * The rest of this file is about the half that cannot be generated. Paths come
 * out of the routers by regex, which is loose enough that it has to be checked
 * against something: here, against the same extraction `apiDoc.test.ts` does,
 * and against the hand-written summaries, so a route added without a line in
 * either fails rather than quietly going undocumented.
 */
const ROUTES_DIR = join(import.meta.dirname, '..', 'server', 'src', 'routes');
const COMMITTED = join(import.meta.dirname, '..', 'web', 'public', 'openapi.json');

const doc = JSON.parse(readFileSync(COMMITTED, 'utf8')) as {
  openapi: string;
  info: { version: string };
  paths: Record<string, Record<string, { operationId: string; summary: string }>>;
  components: { schemas: Record<string, unknown> };
};

function operations(): { key: string; op: { operationId: string; summary: string } }[] {
  return Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, op })),
  );
}

describe('web/public/openapi.json', () => {
  it('matches what the code produces (run `npm run openapi` when this fails)', () => {
    const generated = `${JSON.stringify(buildOpenApiDoc(ROUTES_DIR, pkg.version), null, 2)}\n`;
    expect(readFileSync(COMMITTED, 'utf8')).toBe(generated);
  });

  it('is a 3.1 document carrying this build’s version', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe(pkg.version);
  });

  it('describes every route the server mounts, and no route it does not', () => {
    // The second extraction, deliberately written differently from the one in
    // openapiDoc.ts: this one only cares about the path, so a bug in the
    // prefixing or the ownership logic there shows up as a mismatch here.
    const mounted = new Set<string>();
    for (const file of readdirSync(ROUTES_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
      for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g)) {
        mounted.add(`${m[1].toUpperCase()} ${m[3].replace(/:(\w+)/g, '{$1}')}`);
      }
    }
    // Compared on the suffix, because only `openapiDoc.ts` knows the prefix.
    const documented = new Set(
      operations().map(({ key }) => key.replace(' /api/e/{slug}', ' ').replace(' /api', ' ')),
    );
    const normalise = (s: Set<string>) =>
      [...s].map((k) => k.replace(/ +/, ' ').replace(' /', ' /')).sort();

    expect(normalise(documented)).toEqual(normalise(mounted));
  });

  it('gives every operation a summary and a unique operationId', () => {
    const ops = operations();
    expect(ops.filter(({ op }) => !op.summary)).toEqual([]);
    const ids = ops.map(({ op }) => op.operationId);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('leaves no summary behind for a route that no longer exists', () => {
    const live = new Set(
      readEndpoints(ROUTES_DIR).map((e) => `${e.method.toUpperCase()} ${e.path}`),
    );
    const stale = Object.keys(SUMMARIES).filter((key) => !live.has(key));
    expect(stale).toEqual([]);
  });

  it('resolves every $ref it contains', () => {
    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string') refs.push(v);
        else walk(v);
      }
    };
    walk(doc);
    expect(refs.length).toBeGreaterThan(30);
    const missing = refs.filter((ref) => {
      const path = ref.replace(/^#\//, '').split('/');
      let node: unknown = doc;
      for (const part of path) node = (node as Record<string, unknown>)?.[part];
      return node === undefined;
    });
    expect(missing).toEqual([]);
  });

  it('generates request bodies from the schemas that validate them', () => {
    // Spot-check rather than restate: the point is that the constraints
    // survive the trip, since `trimmed()` loses them on the input side.
    const contribution = doc.components.schemas.Contribution as {
      properties: { kind: { enum: string[] }; body: { maxLength: number } };
      required: string[];
    };
    expect(contribution.properties.kind.enum).toEqual(['note', 'link', 'question']);
    expect(contribution.properties.body.maxLength).toBe(2000);
    expect(contribution.required).toEqual(['kind', 'body']);
  });

  it('says a role’s capabilities are not in here', () => {
    // The one thing the document must not pretend to know: permissions are
    // middleware an organiser can change while the event runs.
    expect(JSON.stringify(doc)).toContain('permissions');
  });
});
