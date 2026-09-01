import type { Db, EventRow } from './db.js';
import type {
  BreakRow,
  ContributionRow,
  PersonRow,
  ProposalRow,
  RoomRow,
  SessionRow,
  TagRow,
  TrackRow,
} from './db.js';
import { NameResolver } from './eventIdentity.js';
import {
  parseLinks,
  speakerNames,
  speakersBySession,
  tagIdsBySession,
} from './mappers.js';
import { trackWindowsFor } from './trackHours.js';
import type { EventExport } from './shared/types.js';

/**
 * One event as a self-contained JSON document.
 *
 * What it deliberately leaves behind is the point: no password hashes, no
 * identity tokens, no calendar tokens, no link- or speaker-code hashes, no
 * audit trail, and no record of *who* starred or backed what. That is what
 * makes this safe to hand to an organiser, rather than something only the
 * person holding the instance password may ever touch — authorship survives
 * as the display name the event already shows on the session.
 *
 * Soft-deleted rows are left out too: this is the event as it stands, not its
 * undo history, which lives in Manage Event → Trash.
 */
export function exportEvent(db: Db, event: EventRow): EventExport {
  const eventId = event.id;
  const names = new NameResolver(db, eventId);
  const speakers = speakerNames(db, eventId);
  const sessionSpeakers = speakersBySession(
    db,
    db
      .prepare<[number], { id: number }>(
        'SELECT id FROM sessions WHERE event_id = ? AND deleted_at IS NULL',
      )
      .all(eventId)
      .map((r) => r.id),
  );
  const speakerName = (id: number | null): string =>
    id === null ? '' : (speakers.get(id) ?? '');

  const rooms = db
    .prepare<[number], RoomRow>(
      'SELECT * FROM rooms WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
    )
    .all(eventId);
  const breaks = db
    .prepare<[number], BreakRow>(
      'SELECT * FROM breaks WHERE event_id = ? ORDER BY start_min, date IS NOT NULL, id',
    )
    .all(eventId);
  const tracks = db
    .prepare<[number], TrackRow>(
      'SELECT * FROM tracks WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
    )
    .all(eventId);
  const trackWindows = trackWindowsFor(
    db,
    tracks.map((t) => t.id),
  );
  const tags = db
    .prepare<[number], TagRow>(
      'SELECT * FROM tags WHERE event_id = ? AND deleted_at IS NULL ORDER BY name',
    )
    .all(eventId);
  const people = db
    .prepare<[number], PersonRow>(
      'SELECT * FROM people WHERE event_id = ? AND deleted_at IS NULL ORDER BY name',
    )
    .all(eventId);
  const sessions = db
    .prepare<[number], SessionRow>(
      'SELECT * FROM sessions WHERE event_id = ? AND deleted_at IS NULL ORDER BY starts_at, id',
    )
    .all(eventId);
  const proposals = db
    .prepare<[number], ProposalRow>(
      'SELECT * FROM proposals WHERE event_id = ? AND deleted_at IS NULL ORDER BY created_at, id',
    )
    .all(eventId);
  const contributions = db
    .prepare<[number], ContributionRow>(
      `SELECT c.* FROM contributions c JOIN sessions s ON s.id = c.session_id
        WHERE s.event_id = ? AND c.deleted_at IS NULL AND s.deleted_at IS NULL
        ORDER BY c.session_id, c.created_at, c.id`,
    )
    .all(eventId);

  const sessionTags = tagIdsBySession(
    db,
    sessions.map((s) => s.id),
  );
  const proposalTags = new Map<number, number[]>();
  for (const row of db
    .prepare<[number], { proposal_id: number; tag_id: number }>(
      `SELECT pt.proposal_id, pt.tag_id FROM proposal_tags pt
         JOIN proposals p ON p.id = pt.proposal_id
        WHERE p.event_id = ?`,
    )
    .all(eventId)) {
    const list = proposalTags.get(row.proposal_id);
    if (list) list.push(row.tag_id);
    else proposalTags.set(row.proposal_id, [row.tag_id]);
  }

  // Aggregates only. How many people starred a session is part of the record
  // an organiser wants; which of them did is not theirs to export.
  const starCounts = new Map(
    db
      .prepare<[number], { session_id: number; n: number }>(
        `SELECT st.session_id AS session_id, COUNT(*) AS n
           FROM stars st JOIN sessions s ON s.id = st.session_id
          WHERE s.event_id = ? AND s.deleted_at IS NULL
          GROUP BY st.session_id`,
      )
      .all(eventId)
      .map((r) => [r.session_id, r.n] as const),
  );
  const interestCounts = new Map(
    db
      .prepare<[number], { proposal_id: number; n: number }>(
        `SELECT pi.proposal_id AS proposal_id, COUNT(*) AS n
           FROM proposal_interest pi JOIN proposals p ON p.id = pi.proposal_id
          WHERE p.event_id = ? AND p.deleted_at IS NULL
          GROUP BY pi.proposal_id`,
      )
      .all(eventId)
      .map((r) => [r.proposal_id, r.n] as const),
  );

  return {
    format: 'libresesh.event',
    version: 1,
    exportedAt: new Date().toISOString(),
    event: {
      slug: event.slug,
      name: event.name,
      timezone: event.timezone,
      startDate: event.start_date,
      endDate: event.end_date,
      dayStartMin: event.day_start_min,
      dayEndMin: event.day_end_min,
      weekRailFrom: event.week_rail_from,
      userRoleLabel: event.user_role_label,
      defaultView: event.default_view === 'cal' ? 'cal' : 'list',
      archived: event.archived === 1,
      createdAt: event.created_at,
    },
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      capacity: r.capacity,
      color: r.color,
      openBooking: r.open_booking === 1,
      sortOrder: r.sort_order,
    })),
    tracks: tracks.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      color: t.color,
      sortOrder: t.sort_order,
      startMin: t.start_min,
      endMin: t.end_min,
      windows: trackWindows.get(t.id) ?? [],
    })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    breaks: breaks.map((b) => ({
      id: b.id,
      label: b.label,
      startMin: b.start_min,
      endMin: b.end_min,
      date: b.date,
    })),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      bio: p.bio,
      links: parseLinks(p.links),
      claimed: p.identity_id !== null,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      roomId: s.room_id,
      trackId: s.track_id,
      type: s.type,
      blocksOpenBooking: s.blocks_open_booking === 1,
      title: s.title,
      description: s.description,
      speakers: (sessionSpeakers.get(s.id) ?? []).map((p) => p.name),
      speaker: (sessionSpeakers.get(s.id) ?? [])[0]?.name ?? '',
      livestreamUrl: s.livestream_url,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      tagIds: sessionTags.get(s.id) ?? [],
      createdByName: names.get(s.created_by),
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      starCount: starCounts.get(s.id) ?? 0,
    })),
    proposals: proposals.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      speakerId: p.speaker_id,
      speaker: speakerName(p.speaker_id),
      tagIds: proposalTags.get(p.id) ?? [],
      placedSessionId: p.placed_session_id,
      createdByName: names.get(p.created_by),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      interestCount: interestCounts.get(p.id) ?? 0,
    })),
    contributions: contributions.map((c) => ({
      id: c.id,
      sessionId: c.session_id,
      kind: c.kind,
      body: c.body,
      url: c.url,
      createdByName: names.get(c.created_by),
      createdAt: c.created_at,
      hidden: c.hidden === 1,
    })),
  };
}
