/**
 * Delivery: somewhere a mention lands that survives a closed tab.
 *
 * The design decisions behind this are in
 * `_planning/specs/mentions-and-notifications.md` §Settled. In short: four
 * kinds, each one a switch its holder owns; the recipient is an identity so a
 * rename or a merge cannot orphan an inbox; retention is 30 days once read and
 * 90 unread; and nothing leaves by mail.
 */
import type { Db } from './db.js';
import { tokenizeMentions } from './shared/mentions.js';
import type { NotificationDto, NotificationKind } from './shared/types.js';

/** Every kind, and what a person is turning off when they mute it. The order
 *  is the order Settings lists them: the ones addressed *to you* first. */
export const NOTIFICATION_KINDS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: 'mention', label: 'Mentions', hint: 'Someone writes @you in a comment' },
  {
    kind: 'session_changed',
    label: 'Your sessions',
    hint: 'A session you speak at is moved or cancelled',
  },
  {
    kind: 'starred_changed',
    label: 'Starred sessions',
    hint: 'A session you starred is moved or cancelled',
  },
  { kind: 'pitch_scheduled', label: 'Your pitches', hint: 'A pitch of yours is given a slot' },
  {
    kind: 'pitch_posted',
    label: 'New pitches',
    hint: 'Someone pitches a session — organisers only',
  },
];

const KINDS = new Set(NOTIFICATION_KINDS.map((k) => k.kind));

/** Read at 30 days, unread at 90 — long enough that a mention survives someone
 *  missing a whole conference and coming back to it. */
const READ_DAYS = 30;
const UNREAD_DAYS = 90;

/** Sweep on write, like `pruneAudit`: no scheduler to own, and the table is
 *  only ever touched when something is being added to it anyway. One in this
 *  many inserts pays for the sweep. */
const PRUNE_EVERY = 200;
let sinceLastPrune = 0;

export interface NewNotification {
  eventId: number;
  /** Who it is for. Nothing is written when this equals `actorId`. */
  identityId: number;
  kind: NotificationKind;
  subjectType: 'session' | 'contribution' | 'proposal';
  subjectId: number;
  title: string;
  body?: string;
  actorId?: number | null;
}

/** The kinds this person has switched off in this event. */
export function mutedKinds(db: Db, eventId: number, identityId: number): NotificationKind[] {
  return db
    .prepare<[number, number], { kind: string }>(
      'SELECT kind FROM notification_mutes WHERE event_id = ? AND identity_id = ?',
    )
    .all(eventId, identityId)
    .map((r) => r.kind)
    .filter((k): k is NotificationKind => KINDS.has(k as NotificationKind));
}

/** Turn one kind on or off. Absence is "on", so switching on is a delete —
 *  which is what keeps the table empty for everyone who never opens Settings. */
export function setMuted(
  db: Db,
  eventId: number,
  identityId: number,
  kind: NotificationKind,
  muted: boolean,
): void {
  if (muted) {
    db.prepare(
      `INSERT INTO notification_mutes (event_id, identity_id, kind, muted_at)
       VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    ).run(eventId, identityId, kind, new Date().toISOString());
    return;
  }
  db.prepare(
    'DELETE FROM notification_mutes WHERE event_id = ? AND identity_id = ? AND kind = ?',
  ).run(eventId, identityId, kind);
}

/**
 * Write one, unless it should not exist: a notification to yourself about your
 * own action is noise, and a muted kind is a decision already taken.
 *
 * Returns the row id, or `null` when nothing was written — callers use that to
 * decide whether to nudge the recipient's open tabs.
 */
export function notify(db: Db, n: NewNotification): number | null {
  if (n.actorId != null && n.actorId === n.identityId) return null;
  if (mutedKinds(db, n.eventId, n.identityId).includes(n.kind)) return null;

  const info = db
    .prepare(
      `INSERT INTO notifications
         (event_id, identity_id, kind, subject_type, subject_id, title, body, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      n.eventId,
      n.identityId,
      n.kind,
      n.subjectType,
      n.subjectId,
      n.title,
      n.body ?? '',
      n.actorId ?? null,
      new Date().toISOString(),
    );

  if (++sinceLastPrune >= PRUNE_EVERY) {
    sinceLastPrune = 0;
    pruneNotifications(db);
  }
  return Number(info.lastInsertRowid);
}

/**
 * Everyone named by `@username` in `text`, as identity ids.
 *
 * The parse is the same tokenizer the comment renders through, run here so the
 * stored mention and the rendered link cannot disagree about what a mention
 * is — the reason `shared/mentions.ts` was written framework-free.
 */
export function mentionedIdentities(db: Db, eventId: number, text: string): number[] {
  const directory = db
    .prepare<[number], { identity_id: number; display_name: string }>(
      'SELECT identity_id, display_name FROM event_identities WHERE event_id = ?',
    )
    .all(eventId);
  if (directory.length === 0) return [];

  const byName = new Map(directory.map((r) => [r.display_name.toLowerCase(), r.identity_id]));
  const ids = new Set<number>();
  for (const seg of tokenizeMentions(text, byName.keys())) {
    if (seg.type !== 'mention') continue;
    const id = byName.get(seg.name.toLowerCase());
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

/** Who speaks at this session, as identity ids — only the claimed profiles,
 *  since an unclaimed one has nobody behind it to tell. */
export function speakerIdentities(db: Db, sessionId: number): number[] {
  return db
    .prepare<[number], { identity_id: number }>(
      `SELECT DISTINCT p.identity_id FROM session_speakers ss
         JOIN people p ON p.id = ss.person_id
        WHERE ss.session_id = ? AND p.identity_id IS NOT NULL AND p.deleted_at IS NULL`,
    )
    .all(sessionId)
    .map((r) => r.identity_id);
}

/** Who starred this session. */
export function starrerIdentities(db: Db, sessionId: number): number[] {
  return db
    .prepare<[number], { identity_id: number }>('SELECT identity_id FROM stars WHERE session_id = ?')
    .all(sessionId)
    .map((r) => r.identity_id);
}

/** Every organiser of this event, for the one kind addressed to a role. */
export function organiserIdentities(db: Db, eventId: number): number[] {
  return db
    .prepare<[number], { identity_id: number }>(
      "SELECT identity_id FROM roles WHERE event_id = ? AND role = 'admin'",
    )
    .all(eventId)
    .map((r) => r.identity_id);
}

interface NotificationRow {
  id: number;
  kind: string;
  subject_type: string;
  subject_id: number;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  actor_name: string | null;
}

const toDto = (r: NotificationRow): NotificationDto => ({
  id: r.id,
  kind: r.kind as NotificationKind,
  subjectType: r.subject_type as NotificationDto['subjectType'],
  subjectId: r.subject_id,
  title: r.title,
  body: r.body,
  actorName: r.actor_name,
  createdAt: r.created_at,
  readAt: r.read_at,
});

/** This person's inbox for this event, newest first. */
export function listNotifications(
  db: Db,
  eventId: number,
  identityId: number,
  max = 50,
): NotificationDto[] {
  return db
    .prepare<[number, number, number, number], NotificationRow>(
      `SELECT n.id, n.kind, n.subject_type, n.subject_id, n.title, n.body,
              n.created_at, n.read_at,
              (SELECT ei.display_name FROM event_identities ei
                WHERE ei.identity_id = n.actor_id AND ei.event_id = ?) AS actor_name
         FROM notifications n
        WHERE n.identity_id = ? AND n.event_id = ?
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ?`,
    )
    .all(eventId, identityId, eventId, max)
    .map(toDto);
}

export function unreadCount(db: Db, eventId: number, identityId: number): number {
  return (
    db
      .prepare<[number, number], { c: number }>(
        'SELECT COUNT(*) c FROM notifications WHERE identity_id = ? AND event_id = ? AND read_at IS NULL',
      )
      .get(identityId, eventId)?.c ?? 0
  );
}

/** Opening the panel is the read. There is no separate "mark all read": a
 *  second control for the thing the first one already did is a control nobody
 *  presses, and an inbox you have looked at is one you have read. */
export function markAllRead(db: Db, eventId: number, identityId: number): number {
  return db
    .prepare('UPDATE notifications SET read_at = ? WHERE identity_id = ? AND event_id = ? AND read_at IS NULL')
    .run(new Date().toISOString(), identityId, eventId).changes;
}

/** Drop what is past its age. Returns how many went, so a deliberate call can
 *  report it — `pruneAudit`'s shape, for the same reason. */
export function pruneNotifications(db: Db, now = new Date()): number {
  const cutoff = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  return db
    .prepare(
      `DELETE FROM notifications
        WHERE (read_at IS NOT NULL AND created_at < ?)
           OR (read_at IS NULL AND created_at < ?)`,
    )
    .run(cutoff(READ_DAYS), cutoff(UNREAD_DAYS)).changes;
}

/** Test seam: the prune counter is per process, not per database. */
export function resetNotificationPruneCounter(): void {
  sinceLastPrune = 0;
}

/**
 * Tell the people attached to a session that it moved or went away.
 *
 * Two audiences, two switches: whoever speaks at it gets `session_changed`,
 * whoever starred it gets `starred_changed`. Speaking wins when someone is
 * both — a speaker who also starred their own talk should hear about it once,
 * and as its speaker.
 *
 * `nudge` is called for each recipient that actually got a row, so the caller
 * can wake that person's open tabs without this module knowing about SSE.
 */
export function notifySessionAudience(
  db: Db,
  args: {
    eventId: number;
    sessionId: number;
    actorId: number;
    title: string;
    body?: string;
  },
  nudge: (identityId: number) => void,
): void {
  const speakers = new Set(speakerIdentities(db, args.sessionId));
  const starrers = starrerIdentities(db, args.sessionId).filter((id) => !speakers.has(id));

  const send = (identityId: number, kind: NotificationKind) => {
    const id = notify(db, {
      eventId: args.eventId,
      identityId,
      kind,
      subjectType: 'session',
      subjectId: args.sessionId,
      title: args.title,
      body: args.body,
      actorId: args.actorId,
    });
    if (id !== null) nudge(identityId);
  };

  for (const identityId of speakers) send(identityId, 'session_changed');
  for (const identityId of starrers) send(identityId, 'starred_changed');
}

/** Did this edit actually move the session? A retitle is not a move, and
 *  telling a roomful of starrers that a typo was fixed is how a bell gets
 *  switched off for good. */
export function isAMove(
  before: { starts_at: string; ends_at: string; room_id: number },
  after: { starts_at: string; ends_at: string; room_id: number },
): boolean {
  return (
    before.starts_at !== after.starts_at ||
    before.ends_at !== after.ends_at ||
    before.room_id !== after.room_id
  );
}
