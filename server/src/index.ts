import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { DEMO_PASSWORDS, LONG_DEMO, seedDemoEvent } from './seed.js';
import { formatPreflight, preflight } from './preflight.js';
import { IDLE_IDENTITY_DAYS, sweepIdleIdentities } from './sweepIdentities.js';
import { nextSlotText, PollerPool } from './telegram.js';
import { rotateAtRest } from './secretsAtRest.js';
import { PURPOSE as NOSTR_SECKEY } from './nostr/keys.js';
import { startNostrSync } from './nostr/queue.js';

// Before loadConfig — which throws on the first missing variable it meets —
// and before openDb, which would mkdir the data directory and make an
// unmounted path indistinguishable from a mounted one.
const problems = preflight(process.env);
if (problems.length > 0) {
  const report = formatPreflight(problems);
  if (problems.some((p) => p.severity === 'fatal')) {
    console.error(report);
    process.exit(1);
  }
  console.warn(report);
}

const config = loadConfig();
const db = openDb(config.databasePath);

// Only ever creates the event when it is absent — never replaces one — so a
// redeploy cannot wipe what people added to the demo, and deleting it in the
// admin UI is not undone on the next restart.
if (config.seedDemoEvent) {
  const seeded = [seedDemoEvent(db)];
  // A demo instance gets the long fixture too: a fortnight with tracks, a week
  // rail and empty weekends exercises screens a two-day event never reaches.
  // A real instance does not — one sample event on the landing page is a
  // courtesy, two is clutter.
  if (config.demoMode) seeded.push(seedDemoEvent(db, { ...LONG_DEMO }));

  for (const event of seeded) {
    if (!event) continue;
    console.log(`seeded the demo event "${event.slug}" (${event.sessionCount} sessions)`);
  }
  if (seeded.some(Boolean)) {
    console.log(
      `Demo passwords: viewer=${DEMO_PASSWORDS.viewer} user=${DEMO_PASSWORDS.user} ` +
        `admin=${DEMO_PASSWORDS.admin}. Set SEED_DEMO_EVENT=0 to stop creating these.`,
    );
  }
}

// Secrets encrypted at rest follow the at-rest secret: after a rotation with
// the old value in SECRETS_AT_REST_KEY_PREVIOUS, one boot moves every blob
// to the new one and says so, and the variable can then be dropped.
if (config.atRestSecretPrevious) {
  const moved = rotateAtRest(
    db,
    { current: config.atRestSecret, previous: config.atRestSecretPrevious },
    [{ table: 'events', column: 'nostr_seckey', purpose: NOSTR_SECKEY }],
  );
  console.log(
    `secrets at rest: re-encrypted ${moved} under the current secret; ` +
      'SECRETS_AT_REST_KEY_PREVIOUS can be removed.',
  );
}

const { express: app, ctx } = createApp(db, config);

// Identities that never became anybody are swept at boot and once a day
// after it (D3 §3). `unref` so the timer never holds the process open.
const sweep = (): void => {
  const removed = sweepIdleIdentities(db);
  if (removed > 0) console.log(`swept ${removed} identities idle for ${IDLE_IDENTITY_DAYS}+ days`);
};
sweep();
setInterval(sweep, 24 * 60 * 60_000).unref();

// Telegram. Nothing here runs on Telegram's side — a bot is a token, not a
// program — so the clock and the commands are both ours.
//
// Started unconditionally, because events bring their own bots: an instance
// with no TELEGRAM_BOT_TOKEN still has to listen for whichever tokens the
// organisers have saved. The pool is empty, and everything below inert, until
// one exists. Reconciling on the same tick is what picks up a token pasted
// while the process is running.
// The announcer lives on the request context, because the routes need it too:
// `added` and `changed` are write-path triggers, announced beside the audit row
// rather than on a timer.
const { announcer } = ctx;
const pollers = new PollerPool(db, config.telegramBotToken, {
  nextSlotText: (event, now) => nextSlotText(db, event, now, config.publicUrl),
});
pollers.reconcile();
setInterval(() => {
  pollers.reconcile();
  void announcer.tick();
}, 60_000).unref();

if (pollers.size > 0) {
  console.log(`telegram: listening as ${pollers.size} bot(s)`);
  if (!config.publicUrl) {
    console.warn('telegram: no PUBLIC_URL, so announcements will carry no links');
  }
}
// Calendar events on the relays follow the database: a loop every ten
// seconds publishes what the write paths marked, and a five-minute sweep
// catches anything a write path missed.
startNostrSync(db, config, ctx.nostrPool);

// 0.0.0.0 so the port is reachable from outside a container.
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`libresesh listening on http://0.0.0.0:${config.port}`);
  console.log(`database: ${config.databasePath}`);
  if (config.cookieSecretOrigin === 'file') {
    console.log(
      `cookie secret: generated and kept beside the database — identities survive a restart. ` +
        'Set COOKIE_SECRET to manage it yourself.',
    );
  }
  if (config.cookieSecretOrigin === 'ephemeral') {
    // The failure this prevents is baffling from the outside: everyone is
    // signed out by a restart, and cannot re-enter under their own name,
    // because the name is still held by the identity they just lost.
    console.warn(
      'WARNING: no COOKIE_SECRET, and none could be stored beside the database. ' +
        'This one was generated in memory, so the next restart signs every visitor out ' +
        'and their display names stay taken. Set COOKIE_SECRET.',
    );
  }
  if (config.demoMode) {
    // Loud on purpose, but precise: only the seeded fixtures are open. Any
    // other event here — including one created through the UI — checks its
    // passwords normally.
    console.warn(
      `WARNING: DEMO_MODE is on. Passwords are NOT checked for ${config.demoEventSlugs.join(', ')} ` +
        '— anyone can take any role there, including organiser. Every other event on this ' +
        'instance keeps its passwords. Never set this on an instance whose demo events matter.',
    );
  }
});

// SSE clients hold sockets open; give them a chance to close cleanly.
server.headersTimeout = 0;
server.requestTimeout = 0;

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  pollers.stop();
  ctx.broker.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
