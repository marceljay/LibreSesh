/**
 * Builds `web/public/openapi.json` from the code that already defines the API,
 * so the document cannot drift the way a hand-written endpoint table can.
 *
 * Three sources, each used for what it actually knows:
 *
 * - **Paths and methods** come from the routers, read as text. They are not in
 *   the schemas and there is nowhere else they exist. A regex over source is
 *   loose, so `tests/openapi.test.ts` checks the set it finds against the set
 *   `tests/apiDoc.test.ts` finds, and every endpoint here must carry a summary
 *   written by hand — a new route fails the suite until someone describes it.
 * - **Request bodies** come from `validation.ts` through `z.toJSONSchema`.
 * - **Roles and capabilities** come from nowhere. They are middleware, not
 *   data, and an event's organiser can change them at runtime, so duplicating
 *   them here would be duplicating something that is already wrong by the time
 *   it is read. The document says to read the bundle's `permissions` map.
 *
 * Responses are described loosely on purpose: the DTOs are TypeScript
 * interfaces in `shared/types.ts`, not schemas, and inventing a second source
 * of truth for them is worse than saying "an object" and pointing at `/api.md`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import * as validation from './validation.js';

/**
 * `createApp` mounts these four at `/api` and every other router under
 * `/api/e/:slug`. The split is per exported router rather than per file:
 * `me.ts` and `backup.ts` each export one of both kinds.
 */
const INSTANCE_ROUTERS = new Set(['meRoutes', 'eventRoutes', 'importRoutes', 'backupRoutes']);

const EXPORTED_ROUTER = /export function (\w+)/g;
const MOUNTED_ROUTE = /router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g;
const PARSED_SCHEMA = /parse\(\s*(\w+)/g;
const EXPLICIT_STATUS = /res\.status\((\d{3})\)/g;

export interface Endpoint {
  method: string;
  /** OpenAPI path, `{slug}` and `{id}` rather than `:slug` and `:id`. */
  path: string;
  /** Export name of the zod schema the handler parses, where it parses one. */
  schema?: string;
  /** What the handler answers when it succeeds, read from `res.status(…)`. */
  success: number;
  /** Gated by the instance password in `X-Instance-Key` rather than a cookie. */
  instanceKey: boolean;
  /** Route file the endpoint lives in, used as its OpenAPI tag. */
  tag: string;
}

function tagFor(file: string): string {
  const stem = file.replace(/\.(ts|js)$/, '');
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/** `/sessions/:id/star` → `/sessions/{id}/star`. */
function openApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

/**
 * Reads every mounted route out of the router sources. Text rather than a
 * running app: Express 5 routes through path-to-regexp 8, where reconstructing
 * a path from a mounted layer's regexp is guesswork, while the string passed to
 * `router.get` is the path itself.
 */
export function readEndpoints(routesDir: string): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const file of readdirSync(routesDir).sort()) {
    if (!/\.(ts|js)$/.test(file)) continue;
    const src = readFileSync(join(routesDir, file), 'utf8');
    const routers = [...src.matchAll(EXPORTED_ROUTER)].map((m) => ({
      at: m.index,
      name: m[1],
    }));
    const routes = [...src.matchAll(MOUNTED_ROUTE)];
    for (const [i, match] of routes.entries()) {
      const at = match.index;
      // Everything between this route and the next one is its handler, which
      // is where its `parse(…)` and its `res.status(…)` live.
      const body = src.slice(at, i + 1 < routes.length ? routes[i + 1].index : src.length);
      const router = routers.filter((r) => r.at < at).at(-1)?.name ?? '';
      const prefix = INSTANCE_ROUTERS.has(router) ? '/api' : '/api/e/{slug}';
      // First rather than only: `/auth` parses a second schema in its demo
      // branch, and the first is the one every caller sends.
      const schema = [...body.matchAll(PARSED_SCHEMA)][0]?.[1];
      const statuses = [...body.matchAll(EXPLICIT_STATUS)].map((m) => Number(m[1]));
      endpoints.push({
        method: match[1],
        path: prefix + openApiPath(match[3]),
        ...(schema && schema in validation ? { schema } : {}),
        // An untouched `res.json(…)` is a 200; anything else says so out loud.
        success: statuses.find((s) => s < 300) ?? 200,
        instanceKey: body.includes('requireInstanceKey'),
        tag: tagFor(file),
      });
    }
  }
  return endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * One line per endpoint, written by hand because nothing in the code knows what
 * an endpoint is *for*. Keyed `METHOD path`; `tests/openapi.test.ts` fails when
 * a route has no entry, which is what stops a new endpoint shipping undescribed.
 */
export const SUMMARIES: Record<string, string> = {
  'POST /api/backup': 'Download the whole database, encrypted',
  'GET /api/events': 'Every event on this instance: names and dates, no schedule',
  'POST /api/events': 'Create an event',
  'POST /api/events/import': 'Build a whole event from one document',
  'GET /api/me': 'Who this cookie is, its role per event, and the build',
  'PATCH /api/me': 'Rename yourself instance-wide',
  'POST /api/me/link': 'Redeem a device phrase and become that identity',
  'POST /api/me/link-code': 'Mint a device phrase for another device to redeem',
  'GET /api/e/{slug}/audit': 'The event log. Organisers',
  'POST /api/e/{slug}/auth': 'Send an event password, receive the identity cookie',
  'POST /api/e/{slug}/breaks': 'Add a break',
  'PATCH /api/e/{slug}/breaks/{id}': 'Edit a break',
  'DELETE /api/e/{slug}/breaks/{id}': 'Remove a break',
  'GET /api/e/{slug}/bundle': 'The entire event in one response',
  'POST /api/e/{slug}/calendar-token': 'Mint this identity’s calendar subscription token',
  'GET /api/e/{slug}/calendar.ics': 'The calendar feed, authenticated by token',
  'DELETE /api/e/{slug}/claims/{id}': 'Withdraw a profile claim',
  'POST /api/e/{slug}/claims/{id}/approve': 'Approve a profile claim. Organisers',
  'POST /api/e/{slug}/claims/{id}/decline': 'Decline a profile claim. Organisers',
  'POST /api/e/{slug}/confirm-admin': 'Re-type the organiser password',
  'DELETE /api/e/{slug}/contributions/{id}': 'Delete a note, link or question',
  'PATCH /api/e/{slug}/contributions/{id}/hidden': 'Hide or unhide one. Organisers',
  'POST /api/e/{slug}/contributions/{id}/restore': 'Restore a deleted contribution',
  'GET /api/e/{slug}/export.json': 'Whole-event JSON. Organisers',
  'POST /api/e/{slug}/formats': 'Add a session format. Organisers',
  'PATCH /api/e/{slug}/formats/{id}': 'Edit a session format. Organisers',
  'DELETE /api/e/{slug}/formats/{id}': 'Remove a session format. Organisers',
  'GET /api/e/{slug}/login': 'What this event’s login page needs to draw itself',
  'POST /api/e/{slug}/login-attempts/reset': 'Lift the sign-in stop. Organisers',
  'GET /api/e/{slug}/login-health': 'Failed sign-in counts. Organisers',
  'POST /api/e/{slug}/logout': 'Drop this event’s role from the cookie',
  'PATCH /api/e/{slug}/me': 'Rename yourself in this event',
  'PATCH /api/e/{slug}/me/profile': 'Edit your own profile here',
  'GET /api/e/{slug}/notifications': 'Your inbox for this event',
  'PATCH /api/e/{slug}/notifications/mutes': 'Choose what you are notified about',
  'POST /api/e/{slug}/notifications/read': 'Mark notifications read',
  'POST /api/e/{slug}/password-role': 'Ask what a password grants, without entering',
  'POST /api/e/{slug}/people': 'Add someone to the roster',
  'GET /api/e/{slug}/people/{id}': 'One person’s profile',
  'PATCH /api/e/{slug}/people/{id}': 'Edit a profile',
  'DELETE /api/e/{slug}/people/{id}': 'Remove someone from the roster',
  'POST /api/e/{slug}/people/{id}/archive': 'File a person out of the lists',
  'DELETE /api/e/{slug}/people/{id}/archive': 'Put an archived person back',
  'POST /api/e/{slug}/people/{id}/claim': 'Ask to hold this profile',
  'POST /api/e/{slug}/people/{id}/merge': 'Fold one profile into another. Organisers',
  'PUT /api/e/{slug}/people/{id}/role': 'Change what someone may do. Organisers',
  'POST /api/e/{slug}/people/{id}/speaker-code': 'Mint a standing speaker code. Organisers',
  'DELETE /api/e/{slug}/people/{id}/speaker-code': 'Revoke a speaker code. Organisers',
  'PATCH /api/e/{slug}/permissions': 'Edit the capability matrix. Organisers',
  'POST /api/e/{slug}/proposals': 'Pitch a session',
  'PATCH /api/e/{slug}/proposals/{id}': 'Edit a pitch',
  'DELETE /api/e/{slug}/proposals/{id}': 'Withdraw a pitch',
  'PUT /api/e/{slug}/proposals/{id}/interest': 'Register interest in a pitch (private)',
  'DELETE /api/e/{slug}/proposals/{id}/interest': 'Withdraw that interest',
  'POST /api/e/{slug}/proposals/{id}/place': 'Give a pitch a room and a time',
  'POST /api/e/{slug}/rooms': 'Add a room. Organisers',
  'PATCH /api/e/{slug}/rooms/{id}': 'Edit a room. Organisers',
  'DELETE /api/e/{slug}/rooms/{id}': 'Remove a room. Organisers',
  'POST /api/e/{slug}/sessions': 'Put a session on the programme',
  'POST /api/e/{slug}/sessions/link': 'Link two sessions together',
  'POST /api/e/{slug}/sessions/repeat': 'Repeat one session across days',
  'POST /api/e/{slug}/sessions/unlink': 'Unlink a session',
  'GET /api/e/{slug}/sessions/{id}': 'One session and its contributions',
  'PATCH /api/e/{slug}/sessions/{id}': 'Edit a session. Send expectedUpdatedAt',
  'DELETE /api/e/{slug}/sessions/{id}': 'Delete a session (soft, restorable)',
  'POST /api/e/{slug}/sessions/{id}/contributions': 'Post a note, link or question',
  'GET /api/e/{slug}/sessions/{id}/link-candidates': 'Sessions this one could be linked to',
  'POST /api/e/{slug}/sessions/{id}/restore': 'Restore a deleted session',
  'PUT /api/e/{slug}/sessions/{id}/star': 'Star a session for your own agenda (private)',
  'DELETE /api/e/{slug}/sessions/{id}/star': 'Unstar it',
  'PATCH /api/e/{slug}/settings': 'Edit the event itself. Organisers',
  'GET /api/e/{slug}/stream': 'Server-Sent Events: every change to this event',
  'POST /api/e/{slug}/tags': 'Add a tag. Organisers',
  'PATCH /api/e/{slug}/tags/{id}': 'Edit a tag. Organisers',
  'DELETE /api/e/{slug}/tags/{id}': 'Remove a tag. Organisers',
  'POST /api/e/{slug}/tracks': 'Add a track. Organisers',
  'PATCH /api/e/{slug}/tracks': 'Reorder the tracks. Organisers',
  'PATCH /api/e/{slug}/tracks/{id}': 'Edit a track. Organisers',
  'DELETE /api/e/{slug}/tracks/{id}': 'Remove a track. Organisers',
  'GET /api/e/{slug}/trash': 'What has been deleted and can be restored',
};

/**
 * Where the handler parses more than one schema and the first one in the file
 * is not the one a caller sends. `/auth` reads `demoAuthSchema` in its
 * demo-instance branch, above the password path every real caller takes.
 */
const BODY_SCHEMA: Record<string, string> = {
  'POST /api/e/{slug}/auth': 'authSchema',
};

/**
 * Query strings validated by a schema local to its route file rather than by
 * one exported from `validation.ts`, so the generator cannot reach them. Two,
 * and both are worth a reader knowing about.
 */
const QUERY_PARAMS: Record<string, Record<string, unknown>[]> = {
  'GET /api/e/{slug}/audit': [
    {
      name: 'before',
      in: 'query',
      required: false,
      description: 'Page backwards from this entry id. Keyset, not offset.',
      schema: { type: 'integer', exclusiveMinimum: 0 },
    },
  ],
  'GET /api/e/{slug}/export.json': [
    {
      name: 'include',
      in: 'query',
      required: false,
      description: 'Comma-separated parts to export. Absent means all of them.',
      schema: { type: 'string' },
    },
  ],
};

/**
 * Every error the API answers with, from `/api.md`. Branch on `code`, never on
 * `message` — the messages are written for people and change freely.
 */
const ERROR_CODES = [
  'validation',
  'name_required',
  'unauthorized',
  'forbidden',
  'not_found',
  'name_taken',
  'profile_exists',
  'already_claimed',
  'claim_pending',
  'stale',
  'overlap',
  'blocked',
  'draft',
  'rate_limited',
] as const;

/**
 * `io: 'output'` rather than `'input'`. The transforms in `validation.ts` are
 * trims — `trimmed(40)` is `.transform(s => s.trim()).pipe(z.string().min(1)
 * .max(40))` — and on the input side a piped schema reports a bare string with
 * every length gone. The output side carries the lengths, and since trimming is
 * all that happens between the two, it is also the rule a caller has to satisfy.
 */
const TO_JSON_SCHEMA = {
  target: 'draft-2020-12',
  io: 'output',
  unrepresentable: 'any',
} as const;

/** `sessionPatchSchema` → `SessionPatch`, which is what a reader sees in a
 *  `$ref` and in generated client code. */
function componentName(schemaName: string): string {
  const stem = schemaName.replace(/Schema$/, '');
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function jsonSchemaFor(name: string): Record<string, unknown> {
  const schema = (validation as Record<string, unknown>)[name];
  if (!(schema instanceof z.ZodType)) throw new Error(`${name} is not a zod schema`);
  const json = z.toJSONSchema(schema, TO_JSON_SCHEMA) as Record<string, unknown>;
  // The dialect belongs on the document, not on each schema inside it.
  delete json.$schema;
  return json;
}

/**
 * `POST /api/e/{slug}/sessions/{id}/star` → `postEventSessionsByIdStar`.
 *
 * The `event` marks the scope and is not decoration: `PATCH /api/me` renames
 * you instance-wide and `PATCH /api/e/{slug}/me` renames you inside one event,
 * and without it the two collide on one id.
 */
function operationId(endpoint: Endpoint): string {
  const scope = endpoint.path.startsWith('/api/e/{slug}') ? ['event'] : [];
  const parts = [...scope, ...endpoint.path.split('/')]
    .filter((p) => p && p !== 'api' && p !== 'e' && p !== '{slug}')
    .map((p) => (p.startsWith('{') ? `by-${p.slice(1, -1)}` : p))
    .join('-')
    .replace(/[^a-zA-Z0-9-]/g, '-');
  return endpoint.method + parts.replace(/(?:^|-)([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function buildOpenApiDoc(routesDir: string, version: string): Record<string, unknown> {
  const endpoints = readEndpoints(routesDir);
  const used = new Set<string>();
  const paths: Record<string, Record<string, unknown>> = {};

  for (const endpoint of endpoints) {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    const summary = SUMMARIES[key];
    if (!summary) throw new Error(`No summary for ${key} — add one to SUMMARIES`);

    const parameters: Record<string, unknown>[] = [];
    for (const name of endpoint.path.matchAll(/\{(\w+)\}/g)) {
      parameters.push({
        name: name[1],
        in: 'path',
        required: true,
        schema: { type: name[1] === 'slug' ? 'string' : 'integer' },
      });
    }

    const operation: Record<string, unknown> = {
      operationId: operationId(endpoint),
      summary,
      tags: [endpoint.tag],
    };

    parameters.push(...(QUERY_PARAMS[key] ?? []));

    const schemaName = BODY_SCHEMA[key] ?? endpoint.schema;
    if (schemaName) {
      used.add(schemaName);
      const ref = { $ref: `#/components/schemas/${componentName(schemaName)}` };
      if (endpoint.method === 'get') {
        // A schema parsed by a GET is its query string, not a body.
        const json = jsonSchemaFor(schemaName);
        const properties = (json.properties ?? {}) as Record<string, unknown>;
        const required = new Set((json.required ?? []) as string[]);
        for (const [name, schema] of Object.entries(properties)) {
          parameters.push({ name, in: 'query', required: required.has(name), schema });
        }
      } else {
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: ref } },
        };
      }
    }

    if (parameters.length) operation.parameters = parameters;

    operation.responses = {
      [String(endpoint.success)]:
        endpoint.success === 204
          ? { description: 'Done. No content — there is nothing to parse.' }
          : {
              description: summary,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
      default: { $ref: '#/components/responses/Error' },
    };

    if (endpoint.instanceKey) operation.security = [{ instanceKey: [] }];
    if (endpoint.path.endsWith('/calendar.ics')) operation.security = [{ calendarToken: [] }];

    paths[endpoint.path] ??= {};
    paths[endpoint.path][endpoint.method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'LibreSesh',
      version,
      summary: 'The HTTP API of one LibreSesh instance.',
      description: [
        'Generated from the zod schemas and the routers — see `/api.md` for the',
        'prose reference, and `/agents.md` if you are a program acting for someone.',
        '',
        '**Identity is a signed cookie, not a bearer token.** `POST /api/e/{slug}/auth`',
        'with an event password sets it; keep your cookie jar or every later request',
        'is a `401`. `GET /api/me` tells you which events you already hold a role in.',
        '',
        '**What a role may do is not in this document.** Capabilities are middleware,',
        'and an organiser can change them while the event runs, so the answer lives at',
        'runtime in the bundle’s `permissions` map (capability → the roles allowed to',
        'use it). Read it rather than provoking a `403` to find out.',
        '',
        '**Response bodies are described loosely.** Request bodies are generated from',
        'the schemas that validate them and are exact; responses are TypeScript',
        'interfaces rather than schemas, so they are typed as objects here and written',
        'out in `/api.md`.',
      ].join('\n'),
      license: { name: 'AGPL-3.0-or-later', identifier: 'AGPL-3.0-or-later' },
    },
    servers: [{ url: '/', description: 'This instance' }],
    security: [{ identityCookie: [] }],
    paths,
    components: {
      securitySchemes: {
        identityCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'cid',
          description: 'Signed identity cookie, set by `POST /api/e/{slug}/auth`.',
        },
        instanceKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Instance-Key',
          description: 'The instance password. Creating, importing, backing up.',
        },
        calendarToken: {
          type: 'apiKey',
          in: 'query',
          name: 'token',
          description: 'Per-person calendar token from `POST /calendar-token`.',
        },
      },
      responses: {
        Error: {
          description: 'Every failure has this shape. Branch on `code`.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: [...ERROR_CODES] },
                message: {
                  type: 'string',
                  description: 'Written for people; do not branch on it.',
                },
              },
            },
          },
        },
        ...Object.fromEntries(
          [...used].sort().map((name) => [componentName(name), jsonSchemaFor(name)]),
        ),
      },
    },
  };
}
