import { Router } from 'express';
import { requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { Role } from '../shared/types.js';
import type { SessionRow } from '../db.js';
import { badRequest, forbidden } from '../errors.js';
import { loadSessionDto } from '../mappers.js';
import { can, getPermissions, requireCapability } from '../permissions.js';
import { limit } from '../ratelimit.js';
import {
    assertMayBlock,
  assertMayMutate,
  assertMayPlace,
  assertNoOverlap,
  assertNotBlocked,
  assertNotStale,
  assertFormatBelongs,
  assertTagsBelong,
  assertTrackBelongs,
  assertValidTimes,
  assertWithinEventWindow,
  assertWithinTrackHours,
  getRoom,
  getSession,
} from '../sessionRules.js';
import { MAX_REPEAT_DAYS, repeatDays, repeatSchema } from '../repeat.js';
import { addDays, dateToUtcMs, DAY_MS } from '../shared/repeat.js';
import { localDate, localMinuteOfDay, zonedTimeToUtc } from '../shared/time.js';
import { resolveSpeakers, setSessionSpeakers, speaksFor, type Actor } from '../speakers.js';
import {
  canMutate,
  linkCandidates,
  linkSessions,
  seriesMembers,
  seriesTitleKey,
  unlinkSession,
} from '../series.js';


import {
  parse,
  sessionLinkSchema,
  sessionPatchSchema,
  sessionSchema,
  sessionUnlinkSchema,
} from '../validation.js';

/** The session form's fields, plus the run of days to put them on. */
const sessionRepeatSchema = sessionSchema.extend({ repeat: repeatSchema });

function setTags(ctx: Ctx, sessionId: number, tagIds: number[]): void {
  ctx.db.prepare('DELETE FROM session_tags WHERE session_id = ?').run(sessionId);
  const insert = ctx.db.prepare(
    'INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)',
  );
  for (const tagId of new Set(tagIds)) insert.run(sessionId, tagId);
}

export function sessionRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  /** Who is crediting: organisers may name anyone; everyone else is held to
   *  who may be credited, and — without `session.credit_others` — to
   *  themselves plus whoever is already on the session being edited. */
  const actor = (
    req: { event: { id: number }; identity: { id: number }; role: Role },
    existing?: SessionRow,
  ): Actor => ({
    identityId: req.identity.id,
    role: req.role,
    creditOthers: can(getPermissions(ctx.db, req.event.id), req.role, 'session.credit_others'),
    alreadyCredited: existing
      ? ctx.db
          .prepare<[number], { person_id: number }>(
            'SELECT person_id FROM session_speakers WHERE session_id = ?',
          )
          .all(existing.id)
          .map((r) => r.person_id)
      : [],
  });
  const userWrite = [
    requireCapability(ctx.db, 'session.create_open'),
    requireWritable,
    limit(ctx.limiter, 'session'),
  ];
  /**
   * Editing and deleting are *not* gated on the capability to create, which is
   * a different permission and was the second half of the same bug: an event
   * that stops attendees putting sessions up — a curated conference, the
   * ordinary case — would otherwise stop a speaker fixing a typo in the talk
   * an organiser scheduled for them. Who may change what is decided per
   * session by `assertMayMutate`, which consults `session.edit_own` and the
   * billing.
   */
  const userEdit = [requireWritable, limit(ctx.limiter, 'session')];

  router.post('/sessions', ...userWrite, (req, res) => {
    const body = parse(sessionSchema, req.body);
    const room = getRoom(ctx.db, req.event.id, body.roomId);
    // Only admins choose the type; anyone else is placing an open session.
    const type = req.role === 'admin' ? (body.type ?? 'official') : 'open';
    assertMayPlace(getPermissions(ctx.db, req.event.id), req.role, room, type);
    const blocks = req.role === 'admin' && assertMayBlock(type, body.blocksOpenBooking);

    const window = { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) };
    assertValidTimes(req.event, window);
    if (req.role !== 'admin') {
      assertWithinEventWindow(req.event, window);
      assertNoOverlap(ctx.db, req.event.id, room.id, window);
      assertNotBlocked(ctx.db, req.event.id, req.role, window);
    }
    const tagIds = body.tagIds ?? [];
    assertTagsBelong(ctx.db, req.event.id, tagIds);
    const trackId = body.trackId ?? null;
    assertTrackBelongs(ctx.db, req.event.id, trackId);
    assertWithinTrackHours(ctx.db, req.event, req.role, trackId, window);
    const formatId = body.formatId ?? null;
    assertFormatBelongs(ctx.db, req.event.id, formatId);

    const now = new Date().toISOString();
    const id = ctx.db.transaction((): number => {
      const speakerIds = resolveSpeakers(ctx.db, req.event.id, body.speakers ?? [], actor(req));
      const info = ctx.db
        .prepare(
          `INSERT INTO sessions
            (event_id, room_id, track_id, format_id, type, blocks_open_booking, title,
             description, speaker, livestreams, starts_at, ends_at,
             created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          req.event.id,
          room.id,
          trackId,
          formatId,
          type,
          blocks ? 1 : 0,
          body.title,
          body.description ?? '',
          JSON.stringify(body.livestreams ?? []),
          window.startsAt.toISOString(),
          window.endsAt.toISOString(),
          req.identity.id,
          now,
          now,
        );
      const newId = Number(info.lastInsertRowid);
      setTags(ctx, newId, tagIds);
      setSessionSpeakers(ctx.db, newId, speakerIds);
      return newId;
    })();

    const dto = loadSessionDto(ctx.db, getSession(ctx.db, req.event.id, id));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'create',
      entity: 'session',
      entityId: id,
    });
    ctx.broker.publish(req.event.slug, 'session.created', dto);
    res.status(201).json(dto);
  });

  /**
   * Create the same session on every day of a run — "every weekday until the
   * 20th" — in one request.
   *
   * What lands is **ordinary sessions**. There is no series, no series id and
   * no link between them: each one can be dragged, retimed, retitled or
   * deleted on its own, which is what a programme whose sessions drift from
   * their planned times actually needs. The rule is spent here and forgotten.
   * `repeat.ts` holds it, so a run the JSON importer refuses is refused here
   * too.
   *
   * Organisers only. Placing sixty sessions is programme-building, and the
   * `session.create_open` capability is for an attendee putting one session on
   * a board.
   */
  router.post(
    '/sessions/repeat',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'session'),
    (req, res) => {
      const body = parse(sessionRepeatSchema, req.body);
      const room = getRoom(ctx.db, req.event.id, body.roomId);
      const type = body.type ?? 'official';
      assertMayPlace(getPermissions(ctx.db, req.event.id), req.role, room, type);
      // A plenary that happens every morning is a run like any other; the flag
      // rides along so each occurrence holds its own day.
      const blocks = assertMayBlock(type, body.blocksOpenBooking);

      const first = { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) };
      assertValidTimes(req.event, first);
      const tagIds = body.tagIds ?? [];
      assertTagsBelong(ctx.db, req.event.id, tagIds);
      const trackId = body.trackId ?? null;
      assertTrackBelongs(ctx.db, req.event.id, trackId);
      // Every occurrence is the same kind of thing as the first one.
      const formatId = body.formatId ?? null;
      assertFormatBelongs(ctx.db, req.event.id, formatId);

      // The run is a claim about the printed clock, so it is the wall-clock
      // start and end that repeat, not the instants. Each day is resolved
      // through the event's timezone separately, which is what keeps 14:00 at
      // 14:00 when the clocks change partway through a long programme.
      const tz = req.event.timezone;
      const firstDate = localDate(first.startsAt, tz);
      const startMin = localMinuteOfDay(first.startsAt, tz);
      const endMin = localMinuteOfDay(first.endsAt, tz);
      // A session ending at or past local midnight belongs to the next date;
      // every occurrence keeps that same offset.
      const endOffset =
        (dateToUtcMs(localDate(first.endsAt, tz)) - dateToUtcMs(firstDate)) / DAY_MS;

      const { dates } = repeatDays(firstDate, body.repeat, {
        eventEndDate: req.event.end_date,
        max: MAX_REPEAT_DAYS,
      });

      const windows = dates.map((date) => {
        const window = {
          startsAt: zonedTimeToUtc(date, startMin, tz),
          endsAt: zonedTimeToUtc(addDays(date, endOffset), endMin, tz),
        };
        // Checked per day rather than once: a wall-clock span that is 90
        // minutes most days is 30 on the day the clocks go forward, and a
        // session that quietly changed length is worse than a refusal.
        try {
          assertValidTimes(req.event, window);
        } catch (err) {
          throw badRequest(`${date}: ${(err as Error).message}`);
        }
        return window;
      });

      const now = new Date().toISOString();
      const ids = ctx.db.transaction((): number[] => {
        const speakerIds = resolveSpeakers(ctx.db, req.event.id, body.speakers ?? [], actor(req));
        const insert = ctx.db.prepare(
          `INSERT INTO sessions
            (event_id, room_id, track_id, format_id, type, blocks_open_booking, title,
             description, speaker, livestreams, starts_at, ends_at,
             created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
        );
        return windows.map((window) => {
          const newId = Number(
            insert.run(
              req.event.id,
              room.id,
              trackId,
              formatId,
              type,
              blocks ? 1 : 0,
              body.title,
              body.description ?? '',
              JSON.stringify(body.livestreams ?? []),
              window.startsAt.toISOString(),
              window.endsAt.toISOString(),
              req.identity.id,
              now,
              now,
            ).lastInsertRowid,
          );
          setTags(ctx, newId, tagIds);
          // Each repeat is its own session from the moment it exists, billing
          // included — the same people, written once per row.
          setSessionSpeakers(ctx.db, newId, speakerIds);
          return newId;
        });
      })();

      // One audit row and one broadcast each: they are separate sessions from
      // the moment they exist, and every later edit or deletion will name one.
      const dtos = ids.map((id) => loadSessionDto(ctx.db, getSession(ctx.db, req.event.id, id)));
      for (const dto of dtos) {
        audit(ctx.db, {
          identityId: req.identity.id,
          eventId: req.event.id,
          action: 'create',
          entity: 'session',
          entityId: dto.id,
        });
        ctx.broker.publish(req.event.slug, 'session.created', dto);
      }
      res.status(201).json({ sessions: dtos });
    },
  );

  router.patch('/sessions/:id', ...userEdit, (req, res) => {
    const existing = getSession(ctx.db, req.event.id, Number(req.params.id));
    const matrix = getPermissions(ctx.db, req.event.id);
    const speaksHere = speaksFor(ctx.db, req.identity.id, existing);
    assertMayMutate(matrix, req.role, req.identity.id, existing, speaksHere);

    const body = parse(sessionPatchSchema, req.body);
    assertNotStale(existing, body.expectedUpdatedAt);

    /**
     * Every placement rule below asks *what changed*, never *which keys
     * arrived*. The session form posts the whole session on every save — room,
     * type, start and end included and untouched — so presence checks refused
     * a speaker fixing a typo in their own description and told them only
     * organisers can move official sessions, about a save that moved nothing.
     *
     * Instants are compared normalised: `2026-06-01T08:00:00Z` and
     * `2026-06-01T08:00:00.000Z` are the same moment and only one of them is
     * the string the row holds.
     */
    const sameInstant = (sent: string | undefined, stored: string): boolean =>
      sent === undefined || new Date(sent).toISOString() === stored;
    const roomChanged = body.roomId !== undefined && body.roomId !== existing.room_id;
    const typeChanged = body.type !== undefined && body.type !== existing.type;
    const timeChanged =
      !sameInstant(body.startsAt, existing.starts_at) ||
      !sameInstant(body.endsAt, existing.ends_at);

    // A speaker may rewrite their talk's words, not its slot: placement of an
    // official session stays with organisers.
    if (
      req.role !== 'admin' &&
      existing.type === 'official' &&
      (roomChanged || typeChanged || timeChanged)
    ) {
      throw forbidden('Only organisers can move official sessions');
    }

    const room = getRoom(ctx.db, req.event.id, body.roomId ?? existing.room_id);
    const type = req.role === 'admin' ? (body.type ?? existing.type) : existing.type;
    if (roomChanged || typeChanged) {
      assertMayPlace(getPermissions(ctx.db, req.event.id), req.role, room, type);
    }
    // A patch that would leave the hold on an open session is refused, not
    // quietly fixed — same as the create path. Lifting the hold and opening
    // the session are two separate decisions, and an organiser who meant both
    // sends both; the form does exactly that when the type chip changes.
    const blocks =
      req.role === 'admin'
        ? assertMayBlock(type, body.blocksOpenBooking ?? existing.blocks_open_booking === 1)
        : existing.blocks_open_booking === 1;

    const window = {
      startsAt: new Date(body.startsAt ?? existing.starts_at),
      endsAt: new Date(body.endsAt ?? existing.ends_at),
    };
    assertValidTimes(req.event, window);
    if (req.role !== 'admin') {
      assertWithinEventWindow(req.event, window);
      assertNoOverlap(ctx.db, req.event.id, room.id, window, existing.id);
      // Only a session that actually moves is re-checked. A plenary announced
      // after someone had already booked that hour leaves their session where
      // it is — badged as competing — and refusing to let them fix a typo in
      // it afterwards would punish them for the organiser's later decision.
      const retimed =
        window.startsAt.toISOString() !== existing.starts_at ||
        window.endsAt.toISOString() !== existing.ends_at;
      if (retimed) assertNotBlocked(ctx.db, req.event.id, req.role, window, existing.id);
    }
    if (body.tagIds) assertTagsBelong(ctx.db, req.event.id, body.tagIds);
    // `undefined` leaves the track alone; an explicit `null` clears it.
    const nextTrackId = body.trackId === undefined ? existing.track_id : body.trackId;
    assertTrackBelongs(ctx.db, req.event.id, nextTrackId);
    // Only a placement that actually changes is held to the track's hours.
    // Narrowing a window leaves the sessions already inside it alone, so the
    // one thing that must keep working is editing them: a title fixed on a
    // session that predates the window is not a booking being made.
    const replaced =
      nextTrackId !== existing.track_id ||
      window.startsAt.toISOString() !== existing.starts_at ||
      window.endsAt.toISOString() !== existing.ends_at;
    if (replaced) {
      assertWithinTrackHours(ctx.db, req.event, req.role, nextTrackId, window);
    }
    // `undefined` leaves the format alone; an explicit `null` clears it. It is
    // a description of the session rather than a claim on the grid, so anyone
    // who may edit the session may change it — no placement rule applies.
    const nextFormatId = body.formatId === undefined ? existing.format_id : body.formatId;
    assertFormatBelongs(ctx.db, req.event.id, nextFormatId);

    const now = new Date().toISOString();
    const nextTitle = body.title ?? existing.title;
    const nextDescription = body.description ?? existing.description;
    const nextLivestreams =
      body.livestreams === undefined ? existing.livestreams : JSON.stringify(body.livestreams);
    const scope = body.applyTo ?? 'one';

    /**
     * Apply the edit to a linked sibling — **content only, never its slot**.
     * Each occurrence keeps its own `starts_at`/`ends_at`; moving Tuesday does
     * not move the rest even when the actor asked to apply to all. A sibling the
     * actor may not edit, or one where the new room clashes at *its* time, is
     * skipped and reported rather than failing the whole save. Returns whether
     * it was written.
     */
    const applyToSibling = (t: SessionRow): boolean => {
      if (!canMutate(ctx.db, matrix, req.role, req.identity.id, t)) return false;
      const roomMoves = room.id !== t.room_id;
      const typeMoves = type !== t.type;
      const tWindow = { startsAt: new Date(t.starts_at), endsAt: new Date(t.ends_at) };
      try {
        // A non-organiser may rewrite an official session's words but not its
        // slot, and a propagated room or type is the slot — the same line the
        // anchor is held to.
        if (req.role !== 'admin' && t.type === 'official' && (roomMoves || typeMoves)) return false;
        if (roomMoves || typeMoves) assertMayPlace(matrix, req.role, room, type);
        if (req.role !== 'admin') {
          if (roomMoves) assertNoOverlap(ctx.db, req.event.id, room.id, tWindow, t.id);
          if (nextTrackId !== t.track_id) {
            assertWithinTrackHours(ctx.db, req.event, req.role, nextTrackId, tWindow);
          }
        }
      } catch {
        return false;
      }
      ctx.db
        .prepare(
          `UPDATE sessions SET room_id = ?, track_id = ?, format_id = ?, type = ?,
                  blocks_open_booking = ?, title = ?, description = ?,
                  livestreams = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(room.id, nextTrackId, nextFormatId, type, blocks ? 1 : 0, nextTitle, nextDescription, nextLivestreams, now, t.id);
      if (body.tagIds) setTags(ctx, t.id, body.tagIds);
      return true;
    };

    const outcome = ctx.db.transaction((): { touched: number[]; considered: number } => {
      // Resolve the billing once — it can mint people — and reuse it for every
      // session the edit touches, so a name typed once lands the same everywhere.
      const speakerIds =
        body.speakers !== undefined
          ? resolveSpeakers(ctx.db, req.event.id, body.speakers, actor(req, existing))
          : null;
      ctx.db
        .prepare(
          `UPDATE sessions SET room_id = ?, track_id = ?, format_id = ?, type = ?,
                  blocks_open_booking = ?, title = ?, description = ?,
                  livestreams = ?, starts_at = ?, ends_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          room.id,
          nextTrackId,
          nextFormatId,
          type,
          blocks ? 1 : 0,
          nextTitle,
          nextDescription,
          nextLivestreams,
          window.startsAt.toISOString(),
          window.endsAt.toISOString(),
          now,
          existing.id,
        );
      if (body.tagIds) setTags(ctx, existing.id, body.tagIds);
      // Absent means "leave the billing alone"; an empty array means "nobody",
      // which is a thing an organiser is allowed to say.
      if (speakerIds !== null) setSessionSpeakers(ctx.db, existing.id, speakerIds);

      const touched = [existing.id];
      let considered = 1;
      if (scope !== 'one' && existing.series_id) {
        const siblings = seriesMembers(ctx.db, existing.series_id).filter(
          (m) => m.id !== existing.id,
        );
        // "This and later" is from the anchor's own day onward; "all" is the
        // whole series. Instants sort lexically, so a string compare is enough.
        const targets =
          scope === 'all'
            ? siblings
            : siblings.filter((m) => m.starts_at >= existing.starts_at);
        considered += targets.length;
        for (const t of targets) {
          if (applyToSibling(t)) {
            if (speakerIds !== null) setSessionSpeakers(ctx.db, t.id, speakerIds);
            touched.push(t.id);
          }
        }
      }
      return { touched, considered };
    })();

    // One audit row and one broadcast per session the edit actually changed.
    const dtos = outcome.touched.map((id) => {
      const d = loadSessionDto(ctx.db, getSession(ctx.db, req.event.id, id));
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'update',
        entity: 'session',
        entityId: id,
      });
      ctx.broker.publish(req.event.slug, 'session.updated', d);
      return d;
    });

    const dto = dtos[0];
    // A series edit reports how far it reached, so the form can say "applied to
    // four of five — one wasn't yours to change" rather than claim all of them.
    if (scope !== 'one' && existing.series_id) {
      res.json({
        ...dto,
        seriesApply: { applied: outcome.touched.length, considered: outcome.considered },
      });
    } else {
      res.json(dto);
    }
  });

  router.delete('/sessions/:id', ...userEdit, (req, res) => {
    const existing: SessionRow = getSession(ctx.db, req.event.id, Number(req.params.id));
    assertMayMutate(getPermissions(ctx.db, req.event.id), req.role, req.identity.id, existing);
    ctx.db
      .prepare('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), existing.id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'delete',
      entity: 'session',
      entityId: existing.id,
    });
    ctx.broker.publish(req.event.slug, 'session.deleted', { id: existing.id });
    res.status(204).end();
  });

  /** Broadcast and audit an edit to each of `ids`, and answer with their DTOs. */
  const announceUpdates = (
    req: { event: { id: number; slug: string }; identity: { id: number } },
    ids: number[],
    action: string,
  ): ReturnType<typeof loadSessionDto>[] =>
    ids.map((id) => {
      const dto = loadSessionDto(ctx.db, getSession(ctx.db, req.event.id, id));
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action,
        entity: 'session',
        entityId: id,
      });
      ctx.broker.publish(req.event.slug, 'session.updated', dto);
      return dto;
    });

  /**
   * The sessions the actor could link to this one: same title, theirs to edit,
   * excluding this one. Exactly the set `/sessions/link` will accept, so the
   * form's checklist never offers a link the server then refuses.
   */
  router.get('/sessions/:id/link-candidates', ...userEdit, (req, res) => {
    const anchor = getSession(ctx.db, req.event.id, Number(req.params.id));
    const matrix = getPermissions(ctx.db, req.event.id);
    assertMayMutate(
      matrix,
      req.role,
      req.identity.id,
      anchor,
      speaksFor(ctx.db, req.identity.id, anchor),
    );
    const rows = linkCandidates(ctx.db, req.event.id, req.identity.id, req.role, matrix, anchor);
    res.json({ candidates: rows.map((r) => loadSessionDto(ctx.db, r)) });
  });

  /**
   * Link a chosen set of sessions into one series. Every one must be the actor's
   * to edit — the security invariant is that linking grants no edit right they
   * did not already have — and they must share a title, the same rule the
   * candidate list is built on.
   */
  router.post('/sessions/link', ...userEdit, (req, res) => {
    const body = parse(sessionLinkSchema, req.body);
    const matrix = getPermissions(ctx.db, req.event.id);
    const sessions = [...new Set(body.sessionIds)].map((id) =>
      getSession(ctx.db, req.event.id, id),
    );
    for (const s of sessions) {
      assertMayMutate(matrix, req.role, req.identity.id, s, speaksFor(ctx.db, req.identity.id, s));
    }
    if (new Set(sessions.map((s) => seriesTitleKey(s.title))).size > 1) {
      throw badRequest('Linked sessions must share a title');
    }
    const now = new Date().toISOString();
    const seriesId = ctx.db.transaction(() => linkSessions(ctx.db, sessions, now))();
    // Announce every current member, not only the ones just added: merging into
    // an existing series leaves its other members' membership unchanged but the
    // form still wants their fresh DTOs.
    const dtos = announceUpdates(
      req,
      seriesMembers(ctx.db, seriesId).map((s) => s.id),
      'series_link',
    );
    res.json({ seriesId, sessions: dtos });
  });

  /** Drop one session out of its series (collapsing a leftover single). */
  router.post('/sessions/unlink', ...userEdit, (req, res) => {
    const body = parse(sessionUnlinkSchema, req.body);
    const existing = getSession(ctx.db, req.event.id, body.sessionId);
    assertMayMutate(
      getPermissions(ctx.db, req.event.id),
      req.role,
      req.identity.id,
      existing,
      speaksFor(ctx.db, req.identity.id, existing),
    );
    const now = new Date().toISOString();
    const affected = ctx.db.transaction(() => unlinkSession(ctx.db, existing, now))();
    const dtos = announceUpdates(req, affected, 'series_unlink');
    res.json({ sessions: dtos });
  });

  return router;
}
