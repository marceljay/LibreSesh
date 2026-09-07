import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAY_ONE,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Harness,
  nextUsername,
} from './helpers.js';

/** A cookie-carrying fetch against the real listening server. */
class Client {
  private cookie = '';

  constructor(private readonly baseUrl: string) {}

  get cookieHeader(): string {
    return this.cookie;
  }

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
}

/** Read SSE frames until `predicate` matches or the timeout elapses. */
async function collectFrames(
  baseUrl: string,
  cookie: string,
  slug: string,
  trigger: () => Promise<unknown>,
  predicate: (frames: string) => boolean,
  timeoutMs = 4000,
): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/e/${slug}/stream`, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readUntil = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return buffer;
        buffer += decoder.decode(value, { stream: true });
        if (predicate(buffer)) return buffer;
      }
    } catch {
      return buffer;
    }
  })();

  // Let the subscription attach before the write that should reach it.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await trigger();

  const timer = new Promise<string>((resolve) => setTimeout(() => resolve(buffer), timeoutMs));
  const out = await Promise.race([readUntil, timer]);
  controller.abort();
  return out ?? buffer;
}

describe('SSE stream', () => {
  let harness: Harness;
  let server: Server;
  let baseUrl: string;
  let admin: Client;
  let roomId: number;

  beforeEach(async () => {
    harness = makeHarness();
    const eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 1 });

    server = harness.app.express.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    admin = new Client(baseUrl);
    await admin.enter('testconf', 'admin-pw');
  });

  afterEach(async () => {
    harness.app.ctx.broker.close();
    await new Promise((resolve) => server.close(resolve));
    harness.close();
  });

  const newSession = (title: string, startMin: number) =>
    admin.request('POST', '/api/e/testconf/sessions', {
      roomId,
      title,
      startsAt: at(DAY_ONE, startMin),
      endsAt: at(DAY_ONE, startMin + 60),
    });

  it('rejects a stream without a role', async () => {
    const res = await fetch(`${baseUrl}/api/e/testconf/stream`);
    expect(res.status).toBe(401);
    await res.text();
  });

  it('opens with a retry hint and delivers a session.created frame', async () => {
    const frames = await collectFrames(
      baseUrl,
      admin.cookieHeader,
      'testconf',
      () => newSession('Broadcast me', 600),
      (buffer) => buffer.includes('session.created'),
    );

    expect(frames).toContain('retry: 3000');
    expect(frames).toContain('event: change');

    const line = frames.split('\n').find((l) => l.startsWith('data: ')) as string;
    const payload = JSON.parse(line.slice('data: '.length));
    expect(payload.type).toBe('session.created');
    expect(payload.entity.title).toBe('Broadcast me');
  });

  it('delivers a deletion as just an id', async () => {
    const created = await (await newSession('Doomed', 700)).json();

    const frames = await collectFrames(
      baseUrl,
      admin.cookieHeader,
      'testconf',
      () => admin.request('DELETE', `/api/e/testconf/sessions/${created.id}`),
      (buffer) => buffer.includes('session.deleted'),
    );
    const line = frames.split('\n').find((l) => l.includes('session.deleted')) as string;
    expect(JSON.parse(line.slice('data: '.length)).entity).toEqual({ id: created.id });
  });

  it('does not leak another event’s changes', async () => {
    const otherEventId = seedEvent(harness.db, { slug: 'other' });
    const otherRoom = seedRoom(harness.db, otherEventId, { openBooking: 1 });
    const otherAdmin = new Client(baseUrl);
    await otherAdmin.enter('other', 'admin-pw');

    const frames = await collectFrames(
      baseUrl,
      admin.cookieHeader,
      'testconf',
      () =>
        otherAdmin.request('POST', '/api/e/other/sessions', {
          roomId: otherRoom,
          title: 'Elsewhere',
          startsAt: at(DAY_ONE, 600),
          endsAt: at(DAY_ONE, 660),
        }),
      (buffer) => buffer.includes('Elsewhere'),
      1200,
    );
    expect(frames).not.toContain('Elsewhere');
  });
});
