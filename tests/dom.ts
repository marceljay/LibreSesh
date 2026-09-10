import type { Agent } from './helpers';

/**
 * What a component test needs that jsdom does not bring: the browser APIs
 * the app touches on mount, and a `fetch` that reaches the real server.
 *
 * Only files that opt into jsdom (`// @vitest-environment jsdom`) use this.
 * The rest of the suite stays on node and never renders.
 */

/** jsdom has no `matchMedia`, no `ResizeObserver`, no `scrollIntoView`, and
 *  its `scrollTo` logs "not implemented" through console.error — which the
 *  smoke tests treat as a failure. Each is stubbed to a no-op. */
export function installBrowserShims(): void {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
  if (typeof globalThis.EventSource !== 'function') {
    // Live updates arrive over SSE. Under jsdom nothing is pushed unless a
    // test pushes it: `emitChange` delivers a frame to every open stream, as
    // the server's broker would, so a page can be shown reacting to one.
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  }
  window.scrollTo = () => {};
}

type Listener = (ev: { data: string }) => void;

const streams = new Set<FakeEventSource>();

class FakeEventSource {
  onopen = null;
  onmessage = null;
  onerror = null;
  readyState = 1;
  private listeners = new Map<string, Set<Listener>>();
  constructor(readonly url: string) {
    streams.add(this);
  }
  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  close(): void {
    streams.delete(this);
  }
  deliver(type: string, data: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }
}

/** Push one change frame to every open stream, as the broker would. */
export function emitChange(change: { type: string; entity: unknown }): void {
  for (const s of streams) s.deliver('change', JSON.stringify(change));
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const inFlight = new Set<Promise<unknown>>();

/** Resolves once every request the page started has been answered. A test
 *  that closes its database while a fetch is still on the wire hands the
 *  server a "database connection is not open" — the page did nothing wrong,
 *  it was just still talking. Await this before tearing the harness down. */
export const settled = async (): Promise<void> => {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
};

/**
 * Point the client's `fetch` at a supertest agent, so a rendered page talks to
 * the real Express app under test rather than to a mock of it. The agent
 * carries the identity cookie across requests, exactly as a browser would, so
 * whatever role it holds is the role the page renders with.
 */
export function routeFetchTo(agent: Agent): void {
  let queue: Promise<unknown> = Promise.resolve();
  globalThis.fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    // One at a time. A supertest agent listens on an ephemeral port and closes
    // that server when a response ends, so a second request already on the
    // wire was cut off mid-flight: the page saw `ECONNRESET` from a server
    // that answers in five milliseconds, intermittently, and only where it
    // fired two requests at once — the gate asking `/gate` while its form
    // posted `/auth`. A browser's parallelism is not what any of these tests
    // are about, and nothing in the app depends on it.
    const p = queue.then(
      () => send(agent, input, init),
      () => send(agent, input, init),
    );
    queue = p.catch(() => undefined);
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
    return p;
  };
}

async function send(agent: Agent, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init.method ?? 'GET').toLowerCase() as Method;
  // One request per connection. supertest listens on an ephemeral port for the
  // request and closes that server when the response ends, while Node's global
  // HTTP agent has kept sockets alive since 19 — so the next request through
  // the same agent reached for a socket to a server that was already gone and
  // came back `ECONNRESET`. The page then showed a network error for a server
  // that had answered every request in 5ms, intermittently and only in a file
  // with several requests in a row.
  let req = agent[method](url).set('Connection', 'close');
  new Headers(init.headers).forEach((value, name) => {
    req = req.set(name, value);
  });
  if (typeof init.body === 'string') req = req.send(init.body);
  const res = await req;
  // A body on a 204 is a TypeError in the Response constructor.
  const body = res.status === 204 || res.status === 304 ? null : res.text;
  return new Response(body, {
    status: res.status,
    headers: Object.fromEntries(
      Object.entries(res.headers as Record<string, string | string[]>).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join(', ') : v,
      ]),
    ),
  });
}
