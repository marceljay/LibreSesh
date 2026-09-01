import { Router } from 'express';
import type { BundleDto, SessionDetailDto } from '../shared/types.js';
import { atLeast } from '../auth.js';
import type { Ctx } from '../context.js';
import type {
  BreakRow,
  ContributionRow,
  PersonRow,
  RoomRow,
  SessionRow,
  TagRow,
  TrackRow,
} from '../db.js';
import { NameResolver, eventDisplayName } from '../eventIdentity.js';
import {
  speakersBySession,
  tagIdsBySession,
  toBreakDto,
  toContributionDto,
  toEventDto,
  toPersonDto,
  personRosterFacts,
  toRoomDto,
  toSessionDto,
  toTagDto,
  toTrackDto,
  loadSessionDto,
  loadProposalDtos,
} from '../mappers.js';
import { getPermissions } from '../permissions.js';
import { limit } from '../ratelimit.js';
import { trackWindowsFor } from '../trackHours.js';
import { getSession } from '../sessionRules.js';

const UNCLAIMED = { role: null, holderUid: null, codePending: false } as const;

/** Read endpoints. The whole event fits comfortably in one JSON payload, so the
 *  client fetches a bundle once and patches it from the SSE stream. */
export function bundleRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  router.get('/bundle', limit(ctx.limiter, 'read'), (req, res) => {
    const eventId = req.event.id;
    const rooms = ctx.db
      .prepare<[number], RoomRow>(
        'SELECT * FROM rooms WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
      )
      .all(eventId);
    const tags = ctx.db
      .prepare<[number], TagRow>(
        'SELECT * FROM tags WHERE event_id = ? AND deleted_at IS NULL ORDER BY name',
      )
      .all(eventId);
    const tracks = ctx.db
      .prepare<[number], TrackRow>(
        'SELECT * FROM tracks WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
      )
      .all(eventId);
    // Ordered by clock, and every-day rows first within a minute: the grid
    // draws them in this order, so the one that applies to more days is the
    // one that ends up underneath.
    const breaks = ctx.db
      .prepare<[number], BreakRow>(
        'SELECT * FROM breaks WHERE event_id = ? ORDER BY start_min, date IS NOT NULL, id',
      )
      .all(eventId);
    const trackWindowRows = trackWindowsFor(
      ctx.db,
      tracks.map((t) => t.id),
    );
    const sessions = ctx.db
      .prepare<[number], SessionRow>(
        'SELECT * FROM sessions WHERE event_id = ? AND deleted_at IS NULL ORDER BY starts_at',
      )
      .all(eventId);

    const people = ctx.db
      .prepare<[number], PersonRow>(
        'SELECT * FROM people WHERE event_id = ? AND deleted_at IS NULL ORDER BY name',
      )
      .all(eventId);

    const tagMap = tagIdsBySession(
      ctx.db,
      sessions.map((s) => s.id),
    );
    const names = new NameResolver(ctx.db, eventId);
    const speakers = speakersBySession(
      ctx.db,
      sessions.map((s) => s.id),
    );
    const roster = req.role === 'admin' ? personRosterFacts(ctx.db, eventId) : undefined;

    // Admins see hidden contributions in the count; everyone else does not.
    const counts = ctx.db
      .prepare<[number, number], { session_id: number; n: number }>(
        `SELECT c.session_id AS session_id, COUNT(*) AS n
           FROM contributions c JOIN sessions s ON s.id = c.session_id
          WHERE s.event_id = ? AND c.deleted_at IS NULL AND s.deleted_at IS NULL
            AND (? = 1 OR c.hidden = 0)
          GROUP BY c.session_id`,
      )
      .all(eventId, req.role === 'admin' ? 1 : 0);

    const bundle: BundleDto = {
      event: toEventDto(req.event),
      role: req.role,
      displayName:
        eventDisplayName(ctx.db, eventId, req.identity.id) ?? req.identity.display_name,
      rooms: rooms.map(toRoomDto),
      tags: tags.map(toTagDto),
      tracks: tracks.map((t) => toTrackDto(t, trackWindowRows.get(t.id) ?? [])),
      breaks: breaks.map(toBreakDto),
      sessions: sessions.map((s) =>
        toSessionDto(
          s,
          tagMap.get(s.id) ?? [],
          names.get(s.created_by),
          speakers.get(s.id) ?? [],
        ),
      ),
      // Who holds each profile, and whether they have ever used it, is for
      // organisers: an attendee has no business being handed a list of who
      // runs the event. `roster` is undefined for everyone else, and the
      // fields are then absent rather than null — "not disclosed to you", not
      // "nobody holds this". A person the query missed simply has no identity.
      people: people.map((p) =>
        roster === undefined
          ? toPersonDto(p, req.identity.id)
          : toPersonDto(p, req.identity.id, roster.get(p.id) ?? UNCLAIMED),
      ),
      proposals: loadProposalDtos(ctx.db, eventId, req.identity.id),
      starredSessionIds: ctx.db
        .prepare<[number, number], { session_id: number }>(
          `SELECT st.session_id FROM stars st
             JOIN sessions s ON s.id = st.session_id
            WHERE st.identity_id = ? AND s.event_id = ? AND s.deleted_at IS NULL`,
        )
        .all(req.identity.id, eventId)
        .map((r) => r.session_id),
      starCounts: Object.fromEntries(
        ctx.db
          .prepare<[number], { session_id: number; n: number }>(
            `SELECT st.session_id AS session_id, COUNT(*) AS n
               FROM stars st JOIN sessions s ON s.id = st.session_id
              WHERE s.event_id = ? AND s.deleted_at IS NULL
              GROUP BY st.session_id`,
          )
          .all(eventId)
          .map((r) => [r.session_id, r.n]),
      ),
      contributionCounts: Object.fromEntries(counts.map((c) => [c.session_id, c.n])),
      permissions: getPermissions(ctx.db, eventId),
    };
    res.json(bundle);
  });

  router.get('/sessions/:id', limit(ctx.limiter, 'read'), (req, res) => {
    const session = getSession(ctx.db, req.event.id, Number(req.params.id));
    const names = new NameResolver(ctx.db, req.event.id);
    const isAdmin = atLeast(req.role, 'admin');
    const contributions = ctx.db
      .prepare<[number, number], ContributionRow>(
        `SELECT * FROM contributions
          WHERE session_id = ? AND deleted_at IS NULL AND (? = 1 OR hidden = 0)
          ORDER BY created_at`,
      )
      .all(session.id, isAdmin ? 1 : 0);

    const detail: SessionDetailDto = {
      session: loadSessionDto(ctx.db, session),
      contributions: contributions.map((c) => toContributionDto(c, names.get(c.created_by))),
    };
    res.json(detail);
  });

  return router;
}
