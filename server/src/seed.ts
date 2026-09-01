/**
 * The demo event fixture — "DemoConf 2026", a two-day programme with rooms,
 * tags, speakers, sessions and contributions.
 *
 * This lives under server/src rather than scripts/ so it is compiled into
 * server/dist and therefore exists in the production image, where `scripts/`
 * and `tsx` are both pruned away. `npm run seed` is a thin wrapper over it;
 * the server also seeds it at boot unless SEED_DEMO_EVENT=0.
 *
 * Days start today so the now-line and "happening now" filters have something
 * to point at.
 */
import { hashPassword } from './auth.js';
import type { Db } from './db.js';
import { ROOM_COLORS } from './shared/roomColors.js';
import { newDisplayName, newIdentityToken, newPublicId } from './identity.js';
import { localDate, zonedTimeToUtc } from './shared/time.js';

export const DEMO_SLUG = 'democonf-2026';
export const DEMO_NAME = 'DemoConf 2026';

/**
 * The second fixture: a fortnight rather than two days, which is what brings
 * tracks, the week rail and empty weekend days into play. A demo instance
 * seeds both, because the two shapes exercise genuinely different screens.
 * Kept in step with the `seed:long` script in package.json.
 */
export const LONG_DEMO = { slug: 'longconf-2026', name: 'LongConf 2026', days: 14 } as const;

/** Published in the README — the demo is a demo, not a secret. */
export const DEMO_PASSWORDS = { viewer: 'viewer2026', user: 'user2026', admin: 'admin2026' };

export interface DemoSeedOptions {
  slug?: string;
  name?: string;
  days?: number;
  startDate?: string;
  /**
   * Wipe and recreate the event if the slug already exists. The CLI passes
   * this; boot seeding never does, so a redeploy cannot erase what people
   * added to the demo.
   */
  replace?: boolean;
}

export interface DemoSeedResult {
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  sessionCount: number;
}

const TIMEZONE = 'Europe/Berlin';

/** Small deterministic PRNG so a reseed produces the same demo schedule. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260101);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;

const ROOMS = [
  { name: 'Main Hall', description: 'Keynotes and plenaries', capacity: 300, openBooking: 0 },
  { name: 'Workshop A', description: 'Hands-on, bring a laptop', capacity: 60, openBooking: 0 },
  { name: 'Workshop B', description: 'Hands-on, bring a laptop', capacity: 60, openBooking: 0 },
  { name: 'Unconf Room', description: 'Grab a slot — anyone may schedule here', capacity: 40, openBooking: 1 },
];

const TAGS = [
  { name: 'AI', color: '#7C6FF0' },
  { name: 'Community', color: '#3AA981' },
  { name: 'Web', color: '#E2703A' },
  { name: 'Hardware', color: '#4A90D9' },
  { name: 'Beginner', color: '#C25FA3' },
  { name: 'Governance', color: '#8A8A5C' },
];

/** Only seeded for a long event: a two-day unconference has no strands to
 *  speak of, and with no tracks the schedule never mentions them. */
const TRACKS = [
  {
    name: 'Build',
    color: '#BFD7E8',
    description: 'Writing the thing. Code, schemas and the arguments behind them.',
  },
  {
    name: 'Community',
    color: '#CFE3CE',
    description: 'Governance, contributors and the people around the project.',
  },
  {
    name: 'Operations',
    color: '#EDE2C6',
    description: 'Running it for other people: deploys, backups, the pager.',
  },
];

const OFFICIAL_TITLES = [
  'Opening keynote: schedules as commons',
  'What pretalx taught us about complexity',
  'Running an unconference without a spreadsheet',
  'SQLite in production, honestly',
  'Server-sent events beat websockets here',
  'Designing for a hallway on a phone',
  'Moderation without accounts',
  'The five-minute grid',
  'Accessible colour for tag systems',
  'Rate limiting a friendly crowd',
  'Backups you will actually test',
  'Deploying to one small VPS',
  'Anonymous identity, real names',
  'Drag and drop that respects the data',
  'Timezones: the short painful version',
  'Open tracks and who owns them',
  'Markdown, sanitised',
  'A schedule that survives a lost signal',
  'Consent and contribution',
  'What to log when nobody signs in',
  'Lightning talks: infrastructure',
  'Lightning talks: community',
  'Closing circle',
  'Post-conference notes, together',
  'Retrospective: what we would cut',
];

const OPEN_TITLES = [
  'Rust for people who like Python',
  'Repair café: bring broken things',
  'Quiet room: silent co-working',
  'Board game protocols',
  'How do we fund this?',
  'Cold brew and cold takes',
];

/** Speakers are real records now, so the demo gives them profiles worth reading. */
const SPEAKERS = [
  {
    name: 'Ada Lovelace',
    bio: 'Works on the analytical side of things. Happy to talk through **anything** on the notes below.',
    links: [{ label: 'Notes', url: 'https://example.org/ada' }],
  },
  {
    name: 'Grace Hopper',
    bio: 'Compilers, plain language, and a low tolerance for "we have always done it this way".',
    links: [{ label: 'Talks', url: 'https://example.org/grace' }],
  },
  { name: 'Alan Kay', bio: 'Interested in what the medium makes thinkable.', links: [] },
  {
    name: 'Barbara Liskov',
    bio: 'Abstraction, substitution, and why the interface is the promise.',
    links: [{ label: 'Papers', url: 'https://example.org/liskov' }],
  },
  { name: 'Radia Perlman', bio: 'Networks that heal themselves.', links: [] },
  { name: 'Jean Bartik', bio: 'Programmed the room-sized ones.', links: [] },
  { name: 'Karen Spärck Jones', bio: 'On weighting what matters in a pile of text.', links: [] },
  { name: 'Ken Thompson', bio: 'Small tools, composed.', links: [] },
];

const NOTES = [
  'Slides are up already, link below.',
  'Great point about the 5-minute grid — that is why drag feels calm.',
  'Room is warm, prop the door open.',
  'Recording is not happening, take notes.',
  'Follow-up session tomorrow in the Unconf Room.',
  'Someone asked about backups — VACUUM INTO is the answer.',
];

const QUESTIONS = [
  'How does this handle two people editing the same session?',
  'Is there an export?',
  'What happens when the wifi drops mid-talk?',
  'Can attendees rename themselves after the fact?',
  'Why no accounts?',
];

const LINKS = [
  { body: 'Slides', url: 'https://example.org/slides' },
  { body: 'Repository', url: 'https://example.org/repo' },
  { body: 'Notes doc', url: 'https://example.org/notes' },
  { body: 'Related talk', url: 'https://example.org/talk' },
];

function createIdentity(db: Db, name?: string): number {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      'INSERT INTO identities (public_id, token, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(newPublicId(db), newIdentityToken(), name ?? newDisplayName(), now, now);
  return Number(info.lastInsertRowid);
}

/**
 * Creates the demo event. Idempotent per slug: without `replace` an existing
 * event of that slug is left exactly as it is and `null` comes back.
 */
export function seedDemoEvent(db: Db, options: DemoSeedOptions = {}): DemoSeedResult | null {
  const SLUG = options.slug ?? DEMO_SLUG;
  const NAME = options.name ?? DEMO_NAME;
  /** Two days unless asked otherwise. Clamped: the grid is per-day, not per-year. */
  const DAY_COUNT = Math.min(Math.max(options.days ?? 2, 1), 90);
  const now = new Date().toISOString();

  const existing = db
    .prepare<[string], { id: number }>('SELECT id FROM events WHERE slug = ?')
    .get(SLUG);
  if (existing && !options.replace) return null;

  const startDate = options.startDate ?? localDate(new Date(), TIMEZONE);
  const dayList = Array.from({ length: DAY_COUNT }, (_, i) => {
    const d = new Date(`${startDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const endDate = dayList[dayList.length - 1] as string;
  let sessionCount = 0;

  db.transaction(() => {
    // Wipe any previous demo event, leaving other events untouched.
    const prior = db.prepare<[string], { id: number }>('SELECT id FROM events WHERE slug = ?').get(SLUG);
    if (prior) {
      // Children first. `people`, `proposals` and `event_identities` were
      // missing here, so every reseed left rows pointing at a deleted event.
      db.prepare('DELETE FROM session_tags WHERE session_id IN (SELECT id FROM sessions WHERE event_id = ?)').run(prior.id);
      db.prepare('DELETE FROM stars WHERE session_id IN (SELECT id FROM sessions WHERE event_id = ?)').run(prior.id);
      db.prepare('DELETE FROM contributions WHERE session_id IN (SELECT id FROM sessions WHERE event_id = ?)').run(prior.id);
      db.prepare('DELETE FROM proposal_interest WHERE proposal_id IN (SELECT id FROM proposals WHERE event_id = ?)').run(prior.id);
      db.prepare('DELETE FROM proposals WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM sessions WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM people WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM rooms WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM tags WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM tracks WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM breaks WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM event_permissions WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM event_identities WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM roles WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM audit WHERE event_id = ?').run(prior.id);
      db.prepare('DELETE FROM events WHERE id = ?').run(prior.id);
    }

    const eventId = Number(
      db
        .prepare(
          `INSERT INTO events
            (slug, name, timezone, start_date, end_date, day_start_min, day_end_min,
             viewer_pw_hash, user_pw_hash, admin_pw_hash, archived, created_at)
           VALUES (?, ?, ?, ?, ?, 480, 1320, ?, ?, ?, 0, ?)`,
        )
        .run(
          SLUG,
          NAME,
          TIMEZONE,
          startDate,
          endDate,
          hashPassword(DEMO_PASSWORDS.viewer),
          hashPassword(DEMO_PASSWORDS.user),
          hashPassword(DEMO_PASSWORDS.admin),
          now,
        ).lastInsertRowid,
    );

    const roomIds = ROOMS.map((room, i) =>
      Number(
        db
          .prepare(
            'INSERT INTO rooms (event_id, name, description, capacity, color, open_booking, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            eventId,
            room.name,
            room.description,
            room.capacity,
            ROOM_COLORS[i % ROOM_COLORS.length],
            room.openBooking,
            i,
          ).lastInsertRowid,
      ),
    );
    const openRoomId = roomIds[ROOMS.findIndex((r) => r.openBooking === 1)] as number;

    const tagIds = TAGS.map((tag) =>
      Number(
        db
          .prepare('INSERT INTO tags (event_id, name, color) VALUES (?, ?, ?)')
          .run(eventId, tag.name, tag.color).lastInsertRowid,
      ),
    );

    // Lunch every day, and one dinner on the opening evening: the two shapes a
    // break comes in, so the demo shows both.
    const insertBreak = db.prepare(
      `INSERT INTO breaks (event_id, label, start_min, end_min, date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertBreak.run(eventId, 'Lunch', 12 * 60, 13 * 60 + 30, null, now);
    insertBreak.run(eventId, 'Dinner', 19 * 60, 21 * 60, dayList[0] as string, now);

    const insertPerson = db.prepare(
      `INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    );
    const personIds = SPEAKERS.map((speaker) =>
      Number(
        insertPerson.run(
          eventId,
          speaker.name,
          speaker.bio,
          JSON.stringify(speaker.links),
          now,
          now,
        ).lastInsertRowid,
      ),
    );
    // A couple of sessions deliberately have no speaker at all.
    const speakerChoices: (number | null)[] = [...personIds, null, null];

    const organiser = createIdentity(db, 'programme_team');
    const attendees = [organiser, ...Array.from({ length: 5 }, () => createIdentity(db))];
    db.prepare(
      'INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (?, ?, ?, ?)',
    ).run(organiser, eventId, 'admin', now);

    const days = dayList;
    // A fortnight does not run at conference intensity throughout: weekends
    // stay clear, which is realistic and gives the day navigator the empty
    // days it has to represent. A one- or two-day event is left exactly as it
    // was — every day full, titles used once.
    const long = days.length > 2;
    const isWeekend = (iso: string): boolean => {
      const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
      return wd === 0 || wd === 6;
    };
    // The first and last day always run, whatever weekday they land on — an
    // event that opens onto an empty grid is a poor demo, and arrival and
    // closing days are real anyway.
    const programmeDays = long
      ? days.filter((d, i) => i === 0 || i === days.length - 1 || !isWeekend(d))
      : days;
    const trackIds = long
      ? TRACKS.map((track, i) =>
          Number(
            db
              .prepare(
                `INSERT INTO tracks (event_id, name, description, color, sort_order)
                 VALUES (?, ?, ?, ?, ?)`,
              )
              .run(eventId, track.name, track.description, track.color, i).lastInsertRowid,
          ),
        )
      : [];

    const insertSession = db.prepare(
      `INSERT INTO sessions
        (event_id, room_id, track_id, type, title, description, speaker, speaker_id,
         starts_at, ends_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
    );
    const insertSessionTag = db.prepare(
      'INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)',
    );

    const sessionIds: number[] = [];

    // Official sessions: fill the three fixed rooms on a tidy grid.
    const officialRooms = roomIds.filter((id) => id !== openRoomId);
    let titleIndex = 0;
    for (const day of programmeDays) {
      for (const roomId of officialRooms) {
        let minute = 9 * 60;
        while (minute < 17 * 60 && (long || titleIndex < OFFICIAL_TITLES.length)) {
          const durationMin = pick([45, 60, 60, 90]);
          const startsAt = zonedTimeToUtc(day, minute, TIMEZONE);
          const endsAt = zonedTimeToUtc(day, minute + durationMin, TIMEZONE);
          const id = Number(
            insertSession.run(
              eventId,
              roomId,
              // A sixth are left off a track, so the "Unassigned" column has
              // something to hold.
              trackIds.length && rand() > 0.17 ? pick(trackIds) : null,
              'official',
              OFFICIAL_TITLES[titleIndex % OFFICIAL_TITLES.length],
              'A short description of the session. Written in **markdown**, rendered safely.',
              pick(speakerChoices),
              startsAt.toISOString(),
              endsAt.toISOString(),
              organiser,
              now,
              now,
            ).lastInsertRowid,
          );
          sessionIds.push(id);
          titleIndex++;
          for (const tagId of new Set([pick(tagIds), pick(tagIds)])) insertSessionTag.run(id, tagId);
          // A break between sessions, rounded to the 5-minute grid.
          minute += durationMin + pick([15, 30]);
        }
      }
    }

    // Open sessions: attendee-created, in the open-booking room only.
    OPEN_TITLES.forEach((title, i) => {
      const day = days[i % days.length] as string;
      // Over many days the pitches spread one per day, so the slot has to
      // count rounds rather than titles or it walks off the end of the grid.
      const minute = 10 * 60 + (long ? Math.floor(i / days.length) : i) * 75;
      const startsAt = zonedTimeToUtc(day, minute, TIMEZONE);
      const endsAt = zonedTimeToUtc(day, minute + 45, TIMEZONE);
      const author = attendees[1 + (i % (attendees.length - 1))] as number;
      const id = Number(
        insertSession.run(
          eventId,
          openRoomId,
          null,
          'open',
          title,
          'Proposed on the day. Turn up, or do not.',
          null,
          startsAt.toISOString(),
          endsAt.toISOString(),
          author,
          now,
          now,
        ).lastInsertRowid,
      );
      sessionIds.push(id);
      insertSessionTag.run(id, pick(tagIds));
      db.prepare(
        `INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(identity_id, event_id) DO NOTHING`,
      ).run(author, eventId, 'user', now);
    });

    const insertContribution = db.prepare(
      `INSERT INTO contributions (session_id, kind, body, url, created_by, created_at, hidden)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    );
    for (let i = 0; i < 30; i++) {
      const sessionId = pick(sessionIds);
      const author = pick(attendees);
      const roll = rand();
      if (roll < 0.45) {
        insertContribution.run(sessionId, 'note', pick(NOTES), null, author, now);
      } else if (roll < 0.8) {
        insertContribution.run(sessionId, 'question', pick(QUESTIONS), null, author, now);
      } else {
        const link = pick(LINKS);
        insertContribution.run(sessionId, 'link', link.body, link.url, author, now);
      }
    }

    sessionCount = sessionIds.length;
  })();

  return { slug: SLUG, name: NAME, startDate, endDate, sessionCount };
}
