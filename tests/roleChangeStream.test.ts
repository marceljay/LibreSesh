import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, seedEvent, type Harness, nextUsername } from './helpers.js';

/**
 * A role change reaches the one person it is about, over their own stream,
 * and nobody else's. Phase 3 of
 * _planning/plans/2026-09-08-permission-integrity.md.
 *
 * `PUT /people/:id/role` already broadcast `person.updated` to the room; that
 * frame names the person, not the reader, so a page could not tell that its
 * own role had moved. A `role.updated` frame now goes to the affected
 * identity alone (`Broker.publishTo`) — per person, because who was promoted
 * is not the room's business.
 */

/** A cookie-carrying fetch against the real listening server. */
class Client {
  cookie = '';
  constructor(private readonly baseUrl: string) {}
  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] as string;
    return res;
  }
  async enter(slug: string, password: string): Promise<void> {
    await this.request('GET', '/api/me');
    const res = await this.request('POST', `/api/e/${slug}/auth`, {
      password,
      displayName: nextUsername(),
    });
    expect(res.status).toBe(200);
  }
  /** Open the stream and collect frames for `ms` after `trigger` runs. */
  async listen(slug: string, trigger: () => Promise<unknown>, ms = 600): Promise<string> {
    const controller = new AbortController();
    const res = await fetch(`${this.baseUrl}/api/e/${slug}/stream`, {
      headers: { cookie: this.cookie },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
        }
      } catch {
        // aborted
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await trigger();
    await new Promise((resolve) => setTimeout(resolve, ms));
    controller.abort();
    await pump;
    return buffer;
  }
}

describe('a role change reaches its subject over the stream', () => {
  let harness: Harness;
  let server: Server;
  let baseUrl: string;
  let admin: Client;
  let subject: Client;
  let bystander: Client;
  let personId: number;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    server = harness.app.express.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    admin = new Client(baseUrl);
    subject = new Client(baseUrl);
    bystander = new Client(baseUrl);
    await admin.enter('testconf', 'admin-pw');
    await subject.enter('testconf', 'viewer-pw');
    await bystander.enter('testconf', 'viewer-pw');
    // A role is set on a profile; the subject needs one that they hold.
    const profile = await subject.request('PATCH', '/api/e/testconf/me/profile', { bio: 'me' });
    expect(profile.status).toBe(200);
    personId = ((await profile.json()) as { id: number }).id;
  });
  afterEach(async () => {
    harness.app.ctx.broker.close();
    await new Promise((resolve) => server.close(resolve));
    harness.close();
  });

  const promote = async () => {
    const res = await admin.request('PUT', `/api/e/testconf/people/${personId}/role`, {
      role: 'user',
    });
    expect(res.status).toBe(200);
  };

  it('sends role.updated with the new role to the person concerned', async () => {
    const frames = await subject.listen('testconf', promote);
    expect(frames).toContain('"type":"role.updated"');
    expect(frames).toContain('"entity":{"role":"user"}');
  });

  it('sends nothing about it to anyone else', async () => {
    const frames = await bystander.listen('testconf', promote);
    expect(frames).not.toContain('role.updated');
    // The room still learns the profile changed, as before.
    expect(frames).toContain('"type":"person.updated"');
  });
});
