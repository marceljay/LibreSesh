/**
 * Drive the built app through a real browser, headless, and say what broke.
 *
 *   npm run build && npm run browser-pass
 *
 * The unit suite renders every route under jsdom (tests/routes.test.tsx), and
 * jsdom has no layout, no drag, no input masking and no media queries. This is
 * the pass for what it cannot see: the built bundle, served by the built
 * server, in Chromium, on a desktop and a phone viewport. Each step mounts a
 * page and checks the one thing that proves it works; every console error,
 * page error, failed request and 4xx/5xx is collected and fails the run.
 *
 * It boots its own server on a free port with a throwaway database, seeded
 * with the demo events and in demo mode so the gate hands out roles without a
 * password. Screenshots land in a temp directory whose path is printed.
 *
 * Needs a Chromium. The dev container image carries Debian's at
 * /usr/bin/chromium; set CHROMIUM to point somewhere else. Playwright's own
 * download does not work here — the firewall blocks where it redirects to.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';

const CHROMIUM = process.env.CHROMIUM ?? '/usr/bin/chromium';
const SLUG = 'democonf-2026';

if (!existsSync('web/dist/index.html') || !existsSync('server/dist/index.js')) {
  console.error('No build to drive. Run `npm run build` first.');
  process.exit(2);
}
if (!existsSync(CHROMIUM)) {
  console.error(`No browser at ${CHROMIUM}. Set CHROMIUM, or rebuild the dev container.`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'libresesh-browser-pass-'));
const shots = join(work, 'shots');
mkdirSync(shots);

// ---- the server ------------------------------------------------------------

const port = 3000 + Math.floor(Math.random() * 1000) + 100;
const BASE = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    DATABASE_PATH: join(work, 'app.db'),
    COOKIE_SECRET: 'browser-pass',
    DEMO_MODE: '1',
    SERVE_STATIC: '1',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const stop = (): void => {
  server.kill();
};
process.on('exit', stop);

for (let i = 0; i < 40; i += 1) {
  try {
    const res = await fetch(`${BASE}/api/events`);
    if (res.ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 250));
}

// ---- the browser -----------------------------------------------------------

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await desktop.newPage();

const problems: string[] = [];
const watch = (p: Page, tag: string): void => {
  p.on('console', (m) => {
    // The browser's own line for a 4xx/5xx; the response listener has it.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
      problems.push(`[${tag} console] ${p.url()} :: ${m.text()}`);
    }
  });
  p.on('pageerror', (e) => problems.push(`[${tag} pageerror] ${p.url()} :: ${e.message}`));
  p.on('requestfailed', (r) => problems.push(`[${tag} requestfailed] ${r.url()}`));
  p.on('response', (r) => {
    // Before the gate, the bundle answers 401 by design: that is how the page
    // learns it has to ask.
    if (r.status() >= 400 && !(r.status() === 401 && r.url().endsWith('/bundle'))) {
      problems.push(`[${tag} http ${r.status()}] ${r.url()}`);
    }
  });
};
watch(page, 'desktop');

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, detail: (e as Error).message.split('\n')[0] });
  }
  const file = `${String(results.length).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`;
  await page.screenshot({ path: join(shots, file) });
}
// Not `networkidle`: the schedule holds an SSE stream open, so the network is
// never idle. Load, then give the first fetches a moment.
const settle = (p: Page = page): Promise<void> =>
  p.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined);
const go = async (path: string): Promise<void> => {
  await page.goto(BASE + path);
  await settle();
};

await step('landing', async () => {
  await go('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
});
await step('events list', async () => {
  await go('/events');
  await page.getByText('DemoConf 2026').first().waitFor();
});
await step('demo gate hands out organiser', async () => {
  await go(`/e/${SLUG}`);
  await page.getByLabel('Username').fill(`Pass ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: /Organiser/ }).click();
  // The organiser's way in is the + Session control, whatever it is called
  // today — a plain button on an event with the board off, a menu otherwise.
  await page.locator('[data-tour="add"]').waitFor({ timeout: 10_000 });
});
await step('schedule', async () => {
  await go(`/e/${SLUG}`);
  await page.getByText('Anonymous identity, real names').first().waitFor();
});
await step('session detail opens over the schedule', async () => {
  await page.getByText('Anonymous identity, real names').first().click();
  await page.waitForURL(/\/s\/\d+/);
  await settle();
  await page.getByRole('button', { name: /Edit session/ }).waitFor();
});
await step('session full width', async () => {
  await page.goto(page.url().replace(/\/?$/, '/full'));
  await settle();
  await page.getByRole('button', { name: /Edit session/ }).waitFor();
});
await step('agenda', async () => {
  await go(`/e/${SLUG}/agenda`);
  await page.getByText('My agenda').waitFor();
});
await step('search', async () => {
  await go(`/e/${SLUG}/search`);
  await page.getByRole('heading', { level: 1 }).waitFor();
});
await step('proposals', async () => {
  await go(`/e/${SLUG}/proposals`);
  await page
    .getByText(/Proposal pool|pitch board/)
    .first()
    .waitFor();
});
await step('admin', async () => {
  await go(`/e/${SLUG}/admin`);
  await page.getByRole('heading', { level: 1, name: /Manage/ }).waitFor();
});
await step('time box masks 0930 to 09:30', async () => {
  await go(`/e/${SLUG}`);
  // The schedule lands on the current session and folds the header's upper
  // rows away, and the control lives in one of them.
  const unfold = page.getByRole('button', { name: 'Show the day picker' });
  if (await unfold.count()) await unfold.click();
  await page.locator('[data-tour="add"]').click();
  // With pitches on, that opened a menu rather than the form.
  const addRow = page.getByRole('menu').getByRole('button', { name: 'Add a session' });
  if (await addRow.count()) await addRow.click();
  const start = page.getByLabel('Start').first();
  await start.click();
  await start.press('Control+a');
  await start.pressSequentially('0930');
  const value = await start.inputValue();
  if (value !== '09:30') throw new Error(`the box holds "${value}"`);
  await page.keyboard.press('Escape');
});
await step('follows the system theme', async () => {
  await go(`/e/${SLUG}`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  const dark = await page.evaluate(
    () =>
      document.documentElement.classList.contains('dark') ||
      document.documentElement.dataset.theme === 'dark',
  );
  if (!dark) throw new Error('the page stayed light');
});
await page.emulateMedia({ colorScheme: 'light' });

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await phone.addCookies((await desktop.storageState()).cookies);
const pp = await phone.newPage();
watch(pp, 'phone');
for (const [name, path] of [
  ['phone schedule', `/e/${SLUG}`],
  ['phone landing', '/'],
] as const) {
  await pp.goto(BASE + path);
  await settle(pp);
  const wider = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  results.push(
    wider ? { name, ok: false, detail: 'the page scrolls sideways' } : { name, ok: true },
  );
  await pp.screenshot({ path: join(shots, `${name.replace(/\s+/g, '-')}.png`) });
}

await browser.close();
stop();

// ---- the verdict -----------------------------------------------------------

for (const r of results)
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
const unique = [...new Set(problems)];
console.log(unique.length ? `\n${unique.join('\n')}` : '\nconsole, page and network: clean');
console.log(`\nscreenshots: ${shots}`);
const failed = results.some((r) => !r.ok) || unique.length > 0;
if (!failed) rmSync(join(work, 'app.db'), { force: true });
process.exit(failed ? 1 : 0);
