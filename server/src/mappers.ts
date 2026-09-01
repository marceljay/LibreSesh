import type {
  BreakDto,
  ContributionDto,
  Role,
  EventDto,
  EventSummary,
  PersonDto,
  PersonLink,
  PersonRef,
  ProposalDto,
  RoomDto,
  SessionDto,
  TagDto,
  TrackDto,
  TrackWindowDto,
} from './shared/types.js';
import type {
  BreakRow,
  ContributionRow,
  Db,
  EventRow,
  PersonRow,
  ProposalRow,
  RoomRow,
  SessionRow,
  TagRow,
  TrackRow,
} from './db.js';

import { NameResolver } from './eventIdentity.js';

export const toEventSummary = (e: EventRow): EventSummary => ({
  slug: e.slug,
  name: e.name,
  startDate: e.start_date,
  endDate: e.end_date,
  archived: e.archived === 1,
});

export const toEventDto = (e: EventRow): EventDto => ({
  ...toEventSummary(e),
  id: e.id,
  timezone: e.timezone,
  dayStartMin: e.day_start_min,
  weekRailFrom: e.week_rail_from,
  dayEndMin: e.day_end_min,
  userRoleLabel: e.user_role_label,
  auditKeep: e.audit_keep,
  defaultView: e.default_view === 'cal' ? 'cal' : 'list',
});

export const toRoomDto = (r: RoomRow): RoomDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  capacity: r.capacity,
  color: r.color,
  openBooking: r.open_booking === 1,
  sortOrder: r.sort_order,
});

export const toTrackDto = (t: TrackRow, windows: TrackWindowDto[] = []): TrackDto => ({
  id: t.id,
  name: t.name,
  description: t.description,
  color: t.color,
  startMin: t.start_min,
  endMin: t.end_min,
  windows,
  sortOrder: t.sort_order,
});

export const toBreakDto = (b: BreakRow): BreakDto => ({
  id: b.id,
  label: b.label,
  startMin: b.start_min,
  endMin: b.end_min,
  date: b.date,
});

export const toTagDto = (t: TagRow): TagDto => ({ id: t.id, name: t.name, color: t.color });

/** Links are stored as a JSON string; a malformed row must not break the page. */
export function parseLinks(raw: string): PersonLink[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is PersonLink =>
        typeof l === 'object' &&
        l !== null &&
        typeof (l as PersonLink).label === 'string' &&
        typeof (l as PersonLink).url === 'string',
    );
  } catch {
    return [];
  }
}

/** Extra columns only organisers are shown; see `PersonDto`. */
export interface PersonRosterFacts {
  role: Role | null;
  holderUid: string | null;
  codePending: boolean;
}

export const toPersonDto = (
  row: PersonRow,
  viewerIdentityId: number,
  facts?: PersonRosterFacts,
): PersonDto => ({
  id: row.id,
  name: row.name,
  bio: row.bio,
  links: parseLinks(row.links),
  isMine: row.identity_id !== null && row.identity_id === viewerIdentityId,
  claimed: row.identity_id !== null,
  ...(facts === undefined
    ? {}
    : { role: facts.role, holderUid: facts.holderUid, codePending: facts.codePending }),
  updatedAt: row.updated_at,
});

/**
 * Who holds each profile, and whether the phrase they were sent has ever been
 * used.
 *
 * `codePending` reads the code itself — a `link_codes` row for this person with
 * no `used_at`. The tempting signal, `identities.last_seen_at`, does not work:
 * the identity middleware throttles that write to once a minute, so a speaker
 * who redeems their code and starts reading straight away still looks as though
 * they never arrived.
 *
 * Re-minting a code for someone who already has a device sets this again, and
 * that is right — the new phrase is outstanding until it is used.
 */
export function personRosterFacts(db: Db, eventId: number): Map<number, PersonRosterFacts> {
  const rows = db
    .prepare<[number, number], {
      id: number;
      role: Role | null;
      holder_uid: string | null;
      code_pending: number;
    }>(
      // `link_codes.person_id` is unique where set, so this joins at most one
      // code per person.
      `SELECT p.id AS id,
              r.role AS role,
              i.public_id AS holder_uid,
              CASE WHEN lc.id IS NOT NULL AND lc.used_at IS NULL THEN 1 ELSE 0 END AS code_pending
         FROM people p
    LEFT JOIN identities i ON i.id = p.identity_id
    LEFT JOIN roles r ON r.identity_id = p.identity_id AND r.event_id = ?
    LEFT JOIN link_codes lc ON lc.person_id = p.id
        WHERE p.event_id = ? AND p.deleted_at IS NULL`,
    )
    .all(eventId, eventId);
  return new Map(
    rows.map((r) => [
      r.id,
      { role: r.role, holderUid: r.holder_uid, codePending: r.code_pending === 1 },
    ]),
  );
}

export function tagIdsBySession(db: Db, sessionIds: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (sessionIds.length === 0) return out;
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = db
    .prepare<number[], { session_id: number; tag_id: number }>(
      `SELECT session_id, tag_id FROM session_tags WHERE session_id IN (${placeholders})`,
    )
    .all(...sessionIds);
  for (const row of rows) {
    const list = out.get(row.session_id);
    if (list) list.push(row.tag_id);
    else out.set(row.session_id, [row.tag_id]);
  }
  return out;
}

export function toSessionDto(
  row: SessionRow,
  tagIds: number[],
  authorName: string,
  speakers: PersonRef[],
): SessionDto {
  return {
    id: row.id,
    roomId: row.room_id,
    trackId: row.track_id,
    type: row.type,
    blocksOpenBooking: row.blocks_open_booking === 1,
    title: row.title,
    description: row.description,
    speakers,
    livestreamUrl: row.livestream_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    tagIds,
    createdBy: row.created_by,
    createdByName: authorName,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Everyone speaking at each of `sessionIds`, in billing order, in one query.
 * Sessions with nobody credited are simply absent from the map.
 */
export function speakersBySession(db: Db, sessionIds: number[]): Map<number, PersonRef[]> {
  const out = new Map<number, PersonRef[]>();
  if (sessionIds.length === 0) return out;
  const rows = db
    .prepare<number[], { session_id: number; id: number; name: string }>(
      `SELECT ss.session_id, p.id, p.name
         FROM session_speakers ss
         JOIN people p ON p.id = ss.person_id
        WHERE ss.session_id IN (${sessionIds.map(() => '?').join(',')})
          AND p.deleted_at IS NULL
        ORDER BY ss.session_id, ss.sort_order, p.id`,
    )
    .all(...sessionIds);
  for (const row of rows) {
    const list = out.get(row.session_id);
    if (list) list.push({ id: row.id, name: row.name });
    else out.set(row.session_id, [{ id: row.id, name: row.name }]);
  }
  return out;
}

/** Speaker names for a set of proposals, resolved in one query. */
export function speakerNames(db: Db, eventId: number): Map<number, string> {
  const rows = db
    .prepare<[number], { id: number; name: string }>(
      'SELECT id, name FROM people WHERE event_id = ? AND deleted_at IS NULL',
    )
    .all(eventId);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Load one session as a DTO (tags, author and speakers resolved). */
export function loadSessionDto(db: Db, row: SessionRow): SessionDto {
  const tagIds = tagIdsBySession(db, [row.id]).get(row.id) ?? [];
  const names = new NameResolver(db, row.event_id);
  const speakers = speakersBySession(db, [row.id]).get(row.id) ?? [];
  return toSessionDto(row, tagIds, names.get(row.created_by), speakers);
}

/** Proposal DTOs need per-viewer interest, so they are built with the viewer. */
export function loadProposalDtos(
  db: Db,
  eventId: number,
  viewerIdentityId: number,
): ProposalDto[] {
  const rows = db
    .prepare<[number], ProposalRow>(
      'SELECT * FROM proposals WHERE event_id = ? AND deleted_at IS NULL ORDER BY created_at',
    )
    .all(eventId);
  if (rows.length === 0) return [];

  const names = new NameResolver(db, eventId);
  const speakers = speakerNames(db, eventId);

  const tags = new Map<number, number[]>();
  for (const row of db
    .prepare<[number], { proposal_id: number; tag_id: number }>(
      `SELECT pt.proposal_id, pt.tag_id FROM proposal_tags pt
         JOIN proposals p ON p.id = pt.proposal_id WHERE p.event_id = ?`,
    )
    .all(eventId)) {
    const list = tags.get(row.proposal_id);
    if (list) list.push(row.tag_id);
    else tags.set(row.proposal_id, [row.tag_id]);
  }

  const counts = new Map(
    db
      .prepare<[number], { proposal_id: number; n: number }>(
        `SELECT pi.proposal_id, COUNT(*) AS n FROM proposal_interest pi
           JOIN proposals p ON p.id = pi.proposal_id WHERE p.event_id = ?
          GROUP BY pi.proposal_id`,
      )
      .all(eventId)
      .map((r) => [r.proposal_id, r.n]),
  );
  const mine = new Set(
    db
      .prepare<[number, number], { proposal_id: number }>(
        `SELECT pi.proposal_id FROM proposal_interest pi
           JOIN proposals p ON p.id = pi.proposal_id
          WHERE p.event_id = ? AND pi.identity_id = ?`,
      )
      .all(eventId, viewerIdentityId)
      .map((r) => r.proposal_id),
  );

  return rows.map((row) => toProposalDto(row, {
    tagIds: tags.get(row.id) ?? [],
    authorName: names.get(row.created_by),
    speakerName: row.speaker_id === null ? '' : (speakers.get(row.speaker_id) ?? ''),
    interestCount: counts.get(row.id) ?? 0,
    interested: mine.has(row.id),
  }));
}

export function toProposalDto(
  row: ProposalRow,
  extra: {
    tagIds: number[];
    authorName: string;
    speakerName: string;
    interestCount: number;
    interested: boolean;
  },
): ProposalDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    speaker: extra.speakerName,
    speakerId: row.speaker_id,
    tagIds: extra.tagIds,
    createdBy: row.created_by,
    createdByName: extra.authorName,
    placedSessionId: row.placed_session_id,
    interestCount: extra.interestCount,
    interested: extra.interested,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toContributionDto(row: ContributionRow, authorName: string): ContributionDto {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    body: row.body,
    url: row.url,
    createdBy: row.created_by,
    createdByName: authorName,
    createdAt: row.created_at,
    hidden: row.hidden === 1,
  };
}
