/** API payload types shared by the server and the web client. */

export type Role = 'viewer' | 'user' | 'speaker' | 'admin';
export type SessionType = 'official' | 'open';
export type ContributionKind = 'note' | 'link' | 'question';
/** Where a profile's speaker code stands: never minted (or revoked), minted
 *  and still unused, or redeemed at the gate. */
export type CodeState = 'none' | 'pending' | 'used';

/** What the gate needs before anyone is in: the username this device already
 *  holds here, if it has entered before. */
export interface GateDto {
  heldName: string | null;
}

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
  formats: number;
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
  /** Whether the grid and the list badge an official session. Off by default —
   *  on an event where everything is official the badge says nothing, and on
   *  an unconference it is noise. The session's own panel always says. */
  showOfficialBadge: boolean;
  /** The view a reader who has not picked one gets. The switch still works;
   *  this is only where the schedule opens. */
  defaultView: ViewMode;
  /**
   * Whether this event runs a pitch board. On by default; an event with a fixed
   * programme turns it off and the link, the route and the pitch form all go.
   * Off is a hide, not a delete — whatever is already on the board stays, and
   * turning it back on brings it back untouched.
   */
  pitchesEnabled: boolean;
}

/** A person as they appear on somebody else's record: id and name, nothing
 *  more. The full profile is `PersonDto`. */
export interface PersonRef {
  id: number;
  name: string;
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

/**
 * What kind of session this is: a talk, a workshop, a panel. Defined per event
 * in Manage Event, so the list is whatever this event runs — the app ships
 * suggestions (`shared/formats.ts`), not a fixed set.
 *
 * Deliberately not `SessionType`, which is `official | open` and says who
 * placed the session rather than what it is.
 */
export interface FormatDto {
  id: number;
  name: string;
  color: string;
}

/** A label and an http(s) link. Profiles have carried a few since §4;
 *  sessions carry their streams the same way rather than in a second shape. */
export interface LabelledLink {
  label: string;
  url: string;
}

export interface PersonDto {
  id: number;
  name: string;
  bio: string;
  links: LabelledLink[];
  /** True when this profile belongs to the requesting identity. */
  isMine: boolean;
  /** True when some attendee owns it, so only they and organisers may edit. */
  claimed: boolean;
  /** The holder's username in this event — what the room calls them — or
   *  null for a profile nobody has claimed. Public: it is on everything
   *  they post already. */
  username: string | null;
  /**
   * When an organiser tidied this profile out of the way, or null for a live
   * one. An archived profile is not a deleted one: it keeps its sessions, its
   * bio, its role and whoever holds it, and drops out of the People list and
   * the speaker picker only.
   *
   * Public, unlike the organiser-only facts below, because the one person who
   * most needs to know is the holder — they are the way back out, and they
   * cannot ask for it if their own profile does not say so. It discloses
   * nothing about who runs the event.
   */
  archivedAt: string | null;
  /**
   * Whether this person may be credited as a speaker by someone who is not
   * an organiser: true for an unclaimed profile and for a holder with the
   * attendee role or above, false for a viewer's — a livestream audience
   * did not come to give a talk. One boolean, not the role, so nothing
   * else about who runs the event is disclosed. Organisers may credit
   * anyone.
   */
  creditable: boolean;
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
   * Organisers only. Whether a speaker code exists for this profile and, if
   * so, whether it has been used: `pending` is a phrase still sitting in an
   * unread email, `used` one that has been typed at the gate at least once,
   * `none` a profile that was never sent one (or whose code was revoked).
   *
   * Three states rather than a `codePending` boolean because an organiser
   * looking at a profile asks two different questions — "did I ever send
   * this person a phrase?" and "are they still waiting to use it?" — and a
   * boolean answers only the second. `claimed` answers neither: minting
   * attaches an identity at mint time, so it claims the profile immediately.
   */
  codeState?: CodeState;
  /** Organisers only. Last request from this person's device anywhere on the
   *  instance, minute-coarse; null for a profile nobody holds. */
  lastSeenAt?: string | null;
  /** Organisers only. When they first took a username here; null for a
   *  profile nobody holds. */
  joinedAt?: string | null;
  /** Organisers only. Live sessions this person is credited on. */
  sessionCount?: number;
  updatedAt: string;
}

/**
 * Somebody asking for the profile an organiser left for them, waiting on an
 * organiser to agree. Organisers see every open request; everyone else sees
 * only their own, including one that was turned down, so a request does not
 * simply vanish without an answer.
 */
export interface ProfileClaimDto {
  id: number;
  /** The profile being asked for. */
  personId: number;
  personName: string;
  /** Who is asking, as this event knows them. */
  username: string;
  /** Organisers only: the identity behind the request. */
  requesterUid?: string;
  /** Organisers only: the profile they hold now, which approving folds in. */
  requesterPersonId?: number | null;
  requestedAt: string;
  /** Set when an organiser turned it down. */
  declinedAt: string | null;
  isMine: boolean;
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
  /** What kind of session it is, or null when the event defines no formats or
   *  nobody picked one. Independent of `type`: an open session can be a
   *  workshop, and an official one can be a jam. */
  formatId: number | null;
  /** This session holds the floor: while it runs, attendees may not place an
   *  open session anywhere in the event. Official sessions only, and only an
   *  organiser can set it. Speakers and organisers are not stopped by it —
   *  what they place is badged as competing instead. */
  blocksOpenBooking: boolean;
  title: string;
  description: string;
  /**
   * Everyone giving this session, in credit order — the first name is the one
   * a cramped block truncates to. Empty when nobody is credited.
   */
  speakers: PersonRef[];
  /**
   * Watch-along links, http(s). Usually empty, sometimes one, occasionally
   * several: a main camera, a room's own feed, an interpreted channel. The
   * UI hides the row entirely rather than showing it blank.
   */
  livestreams: LabelledLink[];
  /** UTC ISO-8601. */
  startsAt: string;
  endsAt: string;
  tagIds: number[];
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  /** Opaque id shared by sessions linked into one series, or null when this
   *  one stands alone. The form shows the link controls only when it is set
   *  and there is more than one member — see the linked-sessions spec. */
  seriesId: string | null;
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
  /** In the organiser's running order, not alphabetical. Empty until the
   *  organiser defines some, which is the state most events start in. */
  formats: FormatDto[];
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
  /** Open requests to hold a profile: all of them for an organiser, your own
   *  for everyone else. */
  claims: ProfileClaimDto[];
}

/**
 * The per-event JSON export (`GET /api/e/:slug/export.json`). Its own shape
 * rather than a bag of DTOs: a DTO answers "what does this viewer see now"
 * and changes whenever the UI does, while this is an archive format that has
 * to keep opening in five years. `version` moves when the shape does.
 *
 * Carries no secrets by construction — see `exportEvent` for the list.
 *
 * `sessions`, `people`, `proposals` and `contributions` are each **absent**
 * when the export was asked to leave them out (`?include=`, or the checkboxes
 * in Manage Event → Backup) and `[]` when the event simply has none — a reader
 * must not confuse the two. The rest is always present: it is the frame the
 * four hang off, and there is no reason to withhold it.
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
  /** What kinds of session this event runs, in the organiser's order. */
  formats: { id: number; name: string; color: string }[];
  /** Local minutes of day; `date` null means every day of the event. */
  breaks: { id: number; label: string; startMin: number; endMin: number; date: string | null }[];
  people?: {
    id: number;
    name: string;
    bio: string;
    links: LabelledLink[];
    /** Whether someone holds this profile — never *who*. */
    claimed: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  sessions?: {
    id: number;
    roomId: number;
    trackId: number | null;
    formatId: number | null;
    type: SessionType;
    title: string;
    description: string;
    /** Everyone giving it, in credit order. `speaker` is the first of them,
     *  kept because a document is read by people as often as by programs and
     *  most sessions have exactly one. */
    speakers: string[];
    speaker: string;
    livestreams: LabelledLink[];
    startsAt: string;
    endsAt: string;
    tagIds: number[];
    createdByName: string;
    createdAt: string;
    updatedAt: string;
    starCount: number;
  }[];
  proposals?: {
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
  contributions?: {
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

/**
 * One line in the log: usually one row, sometimes a whole bulk action.
 *
 * A repeat placed across five days, or an edit applied to a series, writes one
 * row per session — each is a session with its own id, and every later edit
 * will name exactly one of them — but reads as a single line that expands.
 */
export interface AuditItemDto extends AuditEntryDto {
  /**
   * Every row the action wrote, newest first, and only when there is more than
   * one. The first member is this entry itself. Absent for an ordinary line,
   * so "is this a batch" is `members !== undefined` and never a count of one.
   */
  members?: AuditEntryDto[];
}

export interface AuditPageDto {
  /** A page of *actions*, not of rows: a batch counts as one. */
  entries: AuditItemDto[];
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
  | 'format.created'
  | 'format.updated'
  | 'format.deleted'
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
