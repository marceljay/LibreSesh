/** API payload types shared by the server and the web client. */

export type Role = 'viewer' | 'user' | 'speaker' | 'admin';
export type SessionType = 'official' | 'open';
export type ContributionKind = 'note' | 'link' | 'question';

export interface Me {
  id: number;
  /** Your "UID": 5 hex chars, the same at every event on this instance.
   *  Shown only to you and to admins — never on a public profile. */
  uid: string;
  /** The name you are offered when entering a new event. Inside an event the
   *  name that counts is `BundleDto.displayName`. */
  displayName: string;
  /** Role held per event slug. Absent slug = no access. */
  roles: Record<string, Role>;
  /** Public-demo instance. Only labels the build as a demo — it does **not**
   *  mean this event's gate is open; see `demoEventSlugs`. */
  demoMode: boolean;
  /** The events whose gate offers roles as buttons instead of asking for a
   *  password. Everything else on a demo instance is a real event with real
   *  passwords. Empty unless the instance is in demo mode. */
  demoEventSlugs: string[];
}

/** A short-lived phrase that lets another device adopt this identity. */
export interface LinkCodeDto {
  phrase: string;
  expiresAt: string;
}

/**
 * Passwords the server invented for roles the creator left blank. Returned
 * once, on creation: they are stored hashed and cannot be read back later.
 */
export interface GeneratedPasswords {
  viewerPassword?: string;
  userPassword?: string;
  adminPassword?: string;
}

/** What one import document put on the grid, repeats already expanded. */
export interface ImportCounts {
  rooms: number;
  tracks: number;
  tags: number;
  breaks: number;
  sessions: number;
  /** Profiles created for speaker names nobody in this event answered to. */
  people: number;
}

/**
 * The answer to an import, and to the dry run that rehearses it. Shared because
 * the screen that shows a rehearsal is the same screen that shows the real
 * thing — only `dryRun` and `eventId` tell them apart.
 */
export interface ImportResult {
  slug: string;
  /** Absent on a dry run: nothing was written, so there is no id to give. */
  eventId: number | null;
  dryRun: boolean;
  counts: ImportCounts;
  /** Things worth a second look that are not reasons to refuse the import. */
  warnings: string[];
  /** Only the passwords this instance invented, shown once. */
  generatedPasswords: GeneratedPasswords;
}

export interface EventSummary {
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  archived: boolean;
}

/** The two ways a schedule can be read: the day as a grid of rooms, or as one
 *  column in time order. */
export type ViewMode = 'cal' | 'list';

export interface EventDto extends EventSummary {
  id: number;
  timezone: string;
  dayStartMin: number;
  /** Longest event that still shows one flat strip of day tabs; above it the
   *  days split into a rail of weeks. */
  weekRailFrom: number;
  dayEndMin: number;
  /** What this event calls its middle role, e.g. "attendee". */
  userRoleLabel: string;
  /** How many audit entries this event keeps; 0 keeps everything. */
  auditKeep: number;
  /** The view a reader who has not picked one gets. The switch still works;
   *  this is only where the schedule opens. */
  defaultView: ViewMode;
}

export interface RoomDto {
  id: number;
  name: string;
  description: string;
  capacity: number | null;
  /** Hex, from the ROOM_COLORS palette by default but free-form. */
  color: string;
  /** Attendees may schedule their own sessions in this room. */
  openBooking: boolean;
  sortOrder: number;
}

export interface TagDto {
  id: number;
  name: string;
  color: string;
}

export interface PersonLink {
  label: string;
  url: string;
}

export interface PersonDto {
  id: number;
  name: string;
  bio: string;
  links: PersonLink[];
  /** True when this profile belongs to the requesting identity. */
  isMine: boolean;
  /** True when some attendee owns it, so only they and organisers may edit. */
  claimed: boolean;
  /**
   * Organisers only — absent for everyone else, who have no business knowing
   * who runs the event. The role held by the identity that claims this
   * profile, or null when nobody claims it.
   */
  role?: Role | null;
  /**
   * Organisers only. The UID of the identity holding this profile — stable
   * across every event on the instance, unlike the profile id, which is per
   * event. Absent for everyone else: printed beside a name in public it would
   * tie one person's names together between events.
   */
  holderUid?: string | null;
  /**
   * Organisers only. True when a speaker code minted for this profile has
   * never been redeemed — the phrase is still sitting in an unread email.
   * `claimed` cannot tell an organiser that, because minting attaches an
   * identity at mint time and so claims the profile immediately.
   */
  codePending?: boolean;
  updatedAt: string;
}

/**
 * One row of the admin attendance list: everyone who has ever passed this
 * event's gate. There is no anonymous read — the whole event router sits
 * behind `requireRole('viewer')`, and both gate paths write a display name
 * and a role before letting anyone in — so this is the complete set of
 * people who have ever seen the event. Logout removes the role but keeps
 * the name row; the list only grows.
 */
export interface AttendeeDto {
  uid: string;
  /** Their display name in this event, or their instance-wide default. */
  name: string;
  role: Role | null;
  /** When they first picked a name or received a role here. */
  joinedAt: string;
  /** Last request from this identity anywhere on the instance, minute-coarse. */
  lastSeenAt: string;
  /** The speaker/host profile they hold in this event, if any. */
  personId: number | null;
  isMe: boolean;
}

export interface PersonDetailDto {
  person: PersonDto;
  sessions: SessionDto[];
}

export interface SessionDto {
  id: number;
  roomId: number;
  /** null when the event has no tracks, or the session is not on one. */
  trackId: number | null;
  type: SessionType;
  /** This session holds the floor: while it runs, attendees may not place an
   *  open session anywhere in the event. Official sessions only, and only an
   *  organiser can set it. Speakers and organisers are not stopped by it —
   *  what they place is badged as competing instead. */
  blocksOpenBooking: boolean;
  title: string;
  description: string;
  /** Resolved from the linked person; empty when the session has no speaker. */
  speaker: string;
  speakerId: number | null;
  /** Watch-along link, http(s). Empty string means there is no stream, which
   *  is the default — the UI hides the field rather than showing it blank. */
  livestreamUrl: string;
  /** UTC ISO-8601. */
  startsAt: string;
  endsAt: string;
  tagIds: number[];
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContributionDto {
  id: number;
  sessionId: number;
  kind: ContributionKind;
  body: string;
  url: string | null;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  hidden: boolean;
}

export interface ProposalDto {
  id: number;
  title: string;
  description: string;
  speaker: string;
  speakerId: number | null;
  tagIds: number[];
  createdBy: number;
  createdByName: string;
  /** Set once an organiser has placed it on the grid. */
  placedSessionId: number | null;
  /** How many people said they would come. */
  interestCount: number;
  /** Whether the requesting identity is one of them. */
  interested: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A thematic strand across rooms and days. One per session at most, because
 *  the schedule can lay tracks out as its columns. */
/** A day that keeps different hours from the track's own. */
export interface TrackWindowDto {
  /** 'YYYY-MM-DD'. */
  date: string;
  startMin: number;
  endMin: number;
}

export interface TrackDto {
  id: number;
  name: string;
  /**
   * What the strand is for, in the organiser's words — the same job a room's
   * description does, for the other kind of column. '' when unset.
   */
  description: string;
  color: string;
  sortOrder: number;
  /**
   * The hours of the day this track accepts sessions in, as local minutes in
   * the event's timezone. Both null — the default — means any hour, and the
   * track behaves as it always has.
   */
  startMin: number | null;
  endMin: number | null;
  /** Days that replace the window above, earliest first. */
  windows: TrackWindowDto[];
}

/**
 * Lunch, dinner, the coffee break. Belongs to the event rather than to a room
 * or a session: it is drawn behind the whole grid, nobody is listed as running
 * it, and it cannot be opened — it is there so the schedule reads honestly and
 * nobody books over it by accident.
 */
export interface BreakDto {
  id: number;
  label: string;
  /** Local minutes since midnight in the event's timezone. */
  startMin: number;
  /** Exclusive. 1440 is midnight closing the day. */
  endMin: number;
  /** 'YYYY-MM-DD' for one day only; null means every day of the event. */
  date: string | null;
}

export interface BundleDto {
  event: EventDto;
  role: Role;
  /** What you go by inside this event. Names are unique per event, not
   *  globally, so this is not necessarily `Me.displayName`. */
  displayName: string;
  rooms: RoomDto[];
  tags: TagDto[];
  /** Empty unless the organiser has defined any. */
  tracks: TrackDto[];
  /** Lunch and friends, ordered by time. Drawn behind the grid on every day
   *  they apply to; `date` null means all of them. */
  breaks: BreakDto[];
  sessions: SessionDto[];
  people: PersonDto[];
  /** Pitches waiting for a slot, plus those already placed. */
  proposals: ProposalDto[];
  /** Sessions this identity has starred for their personal agenda. */
  starredSessionIds: number[];
  /** sessionId -> how many people starred it. An interest signal for
   *  organisers deciding which room a session deserves. */
  starCounts: Record<number, number>;
  /** sessionId -> count of visible contributions. */
  contributionCounts: Record<number, number>;
  /** capability -> roles allowed to use it. Admin is always present. */
  permissions: Record<string, Role[]>;
}

/**
 * The per-event JSON export (`GET /api/e/:slug/export.json`). Its own shape
 * rather than a bag of DTOs: a DTO answers "what does this viewer see now"
 * and changes whenever the UI does, while this is an archive format that has
 * to keep opening in five years. `version` moves when the shape does.
 *
 * Carries no secrets by construction — see `exportEvent` for the list.
 */
export interface EventExport {
  format: 'libresesh.event';
  version: 1;
  exportedAt: string;
  event: {
    slug: string;
    name: string;
    timezone: string;
    startDate: string;
    endDate: string;
    dayStartMin: number;
    dayEndMin: number;
    weekRailFrom: number;
    userRoleLabel: string;
    defaultView: ViewMode;
    archived: boolean;
    createdAt: string;
  };
  rooms: {
    id: number;
    name: string;
    description: string;
    capacity: number | null;
    color: string;
    openBooking: boolean;
    sortOrder: number;
  }[];
  tracks: {
    id: number;
    name: string;
    description: string;
    color: string;
    sortOrder: number;
    /** The hours the track keeps, as local minutes; null means any hour. */
    startMin: number | null;
    endMin: number | null;
    windows: TrackWindowDto[];
  }[];
  tags: { id: number; name: string; color: string }[];
  /** Local minutes of day; `date` null means every day of the event. */
  breaks: { id: number; label: string; startMin: number; endMin: number; date: string | null }[];
  people: {
    id: number;
    name: string;
    bio: string;
    links: PersonLink[];
    /** Whether someone holds this profile — never *who*. */
    claimed: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  sessions: {
    id: number;
    roomId: number;
    trackId: number | null;
    type: SessionType;
    title: string;
    description: string;
    speakerId: number | null;
    speaker: string;
    livestreamUrl: string;
    startsAt: string;
    endsAt: string;
    tagIds: number[];
    createdByName: string;
    createdAt: string;
    updatedAt: string;
    starCount: number;
  }[];
  proposals: {
    id: number;
    title: string;
    description: string;
    speakerId: number | null;
    speaker: string;
    tagIds: number[];
    placedSessionId: number | null;
    createdByName: string;
    createdAt: string;
    updatedAt: string;
    interestCount: number;
  }[];
  contributions: {
    id: number;
    sessionId: number;
    kind: ContributionKind;
    body: string;
    url: string | null;
    createdByName: string;
    createdAt: string;
    hidden: boolean;
  }[];
}

/**
 * One line of the append-only write log. `entityLabel` is the thing's name at
 * read time — resolved for the page being shown rather than stored, because
 * the log records *what happened*, not what things were called then.
 */
export interface AuditEntryDto {
  id: number;
  at: string;
  /** The actor's display name in this event. Empty if the row has no actor. */
  actorName: string;
  /**
   * The actor's UID — the same at every event on this instance, and the only
   * thing about them that never changes. Display names can be edited, and
   * this log is read precisely when someone wants to know who did something,
   * so the name alone is not enough. Admin-only, like the endpoint.
   */
  actorUid: string | null;
  action: string;
  entity: string;
  entityId: number | null;
  /** Title or name, when it could still be looked up; otherwise empty. */
  entityLabel: string;
}

export interface AuditPageDto {
  entries: AuditEntryDto[];
  /** Pass back as `?before=` for the next page. Null at the end of the log. */
  nextCursor: number | null;
}

export interface SessionDetailDto {
  session: SessionDto;
  contributions: ContributionDto[];
}

/** SSE payloads (SPEC §6). */
export type ChangeType =
  | 'session.created'
  | 'session.updated'
  | 'session.deleted'
  | 'contribution.created'
  | 'contribution.deleted'
  | 'contribution.hidden'
  | 'room.created'
  | 'room.updated'
  | 'room.deleted'
  | 'tag.created'
  | 'tag.updated'
  | 'tag.deleted'
  | 'track.created'
  | 'track.updated'
  | 'track.deleted'
  | 'break.created'
  | 'break.updated'
  | 'break.deleted'
  | 'proposal.created'
  | 'proposal.updated'
  | 'proposal.deleted'
  | 'person.created'
  | 'person.updated'
  | 'person.deleted'
  | 'event.updated'
  | 'permissions.updated';

export interface ChangeEvent {
  type: ChangeType;
  /** Full fresh entity, or `{ id }` for deletes. */
  entity: unknown;
}

export interface ApiError {
  error: { code: string; message: string };
}
