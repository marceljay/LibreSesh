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

/**
 * Read a stream that needs no trigger: what is being tested has already
 * happened, and the question is what arrives on connecting. `lastEventId` is
 * what a browser sends back by itself after a drop.
 */
async function readStream(
  baseUrl: string,
  cookie: string,
  slug: string,
  opts: { lastEventId?: string; until?: (frames: string) => boolean; timeoutMs?: number },
): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/e/${slug}/stream`, {
    headers: {
      cookie,
      accept: 'text/event-stream',
      ...(opts.lastEventId ? { 'last-event-id': opts.lastEventId } : {}),
    },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const until = opts.until;

  const readUntil = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return buffer;
        buffer += decoder.decode(value, { stream: true });
        if (until?.(buffer)) return buffer;
      }
    } catch {
      return buffer;
    }
  })();

  // Without a predicate the point is what does *not* arrive, so the wait is
  // the assertion and has to be long enough to mean something.
  const timer = new Promise<string>((resolve) =>
    setTimeout(() => resolve(buffer), opts.timeoutMs ?? (until ? 4000 : 700)),
  );
  const out = await Promise.race([readUntil, timer]);
  controller.abort();
  return out ?? buffer;
}

/** The position a stream would come back with: its most recent `id:` line. */
function lastId(frames: string): string {
  const ids = frames
    .split('\n')
    .filter((line) => line.startsWith('id: '))
    .map((line) => line.slice('id: '.length).trim());
  expect(ids.length).toBeGreaterThan(0);
  return ids[ids.length - 1] as string;
}

/**
 * A reconnect used to refetch the whole bundle — 102 KB and 4.4 ms of server
 * CPU per device, from every device in a room at once, every time one access
 * point wobbled. The stream retries three seconds after a drop, so that was the
 * loudest thing a busy event did to its own server. Now the gap is replayed
 * from a short per-event ring, and the refetch is the fallback.
 */
describe('catching up a reconnect', () => {
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

  const newSession = (title: string, startMin: number, draft = false) =>
    admin.request('POST', '/api/e/testconf/sessions', {
      roomId,
      title,
      startsAt: at(DAY_ONE, startMin),
      endsAt: at(DAY_ONE, startMin + 60),
      ...(draft ? { draft: true } : {}),
    });

  it('gives a first connection a position, before anything has happened', async () => {
    const frames = await readStream(baseUrl, admin.cookieHeader, 'testconf', {});

    // The quiet event is the case that matters: nothing happens all morning,
    // the wifi drops anyway, and a tab with no id would have to refetch to
    // find out that nothing had changed.
    expect(frames).toMatch(/\nid: /);
    expect(frames).not.toContain('event: change');
    expect(frames).not.toContain('event: resync');
  });

  it('replays the frames the gap missed, and only those', async () => {
    const opening = await readStream(baseUrl, admin.cookieHeader, 'testconf', {
      until: (frames) => frames.includes('id: '),
    });
    const position = lastId(opening);

    // The drop: nobody is listening for either of these.
    await newSession('While away one', 600);
    await newSession('While away two', 700);

    const back = await readStream(baseUrl, admin.cookieHeader, 'testconf', {
      lastEventId: position,
      until: (frames) => frames.includes('While away two'),
    });

    expect(back).toContain('While away one');
    expect(back).toContain('While away two');
    expect(back).not.toContain('event: resync');
  });

  it('does not replay what happened before the stream left', async () => {
    await newSession('Before the drop', 800);
    const opening = await readStream(baseUrl, admin.cookieHeader, 'testconf', {
      until: (frames) => frames.includes('id: '),
    });

    const back = await readStream(baseUrl, admin.cookieHeader, 'testconf', {
      lastEventId: lastId(opening),
    });

    // It is in the ring, and this stream has already seen it in the bundle.
    expect(back).not.toContain('Before the drop');
  });

  it('asks for a refetch when the id is from a process that is gone', async () => {
    // What a tab holds across a restart: the number still looks like a
    // position, and pointing it at the new history would tell the tab it had
    // missed nothing when it has in fact missed everything.
    const frames = await readStream(baseUrl, admin.cookieHeader, 'testconf', {
      lastEventId: 'deadbeef-3',
      until: (f) => f.includes('resync'),
    });

    expect(frames).toContain('event: resync');
  });

  it('replays a draft only to someone who may see it', async () => {
    const viewer = new Client(baseUrl);
    await viewer.enter('testconf', 'viewer-pw');

    const viewerOpening = await readStream(baseUrl, viewer.cookieHeader, 'testconf', {
      until: (frames) => frames.includes('id: '),
    });
    const adminOpening = await readStream(baseUrl, admin.cookieHeader, 'testconf', {
      until: (frames) => frames.includes('id: '),
    });

    await newSession('Hidden draft', 900, true);

    // A replay is a second delivery, and the first one was addressed per
    // stream. Replaying from a shared ring without asking again who is
    // reconnecting would hand the room a draft it was never sent live.
    const viewerBack = await readStream(baseUrl, viewer.cookieHeader, 'testconf', {
      lastEventId: lastId(viewerOpening),
    });
    expect(viewerBack).not.toContain('Hidden draft');

    const adminBack = await readStream(baseUrl, admin.cookieHeader, 'testconf', {
      lastEventId: lastId(adminOpening),
      until: (frames) => frames.includes('Hidden draft'),
    });
    expect(adminBack).toContain('Hidden draft');
  });
});
