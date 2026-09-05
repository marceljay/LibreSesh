import type {
  BreakDto,
  AuditPageDto,
  BundleDto,
  ContributionDto,
  ContributionKind,
  EventDto,
  EventSummary,
  GateDto,
  GeneratedPasswords,
  ImportResult,
  LinkCodeDto,
  Me,
  PersonDetailDto,
  PersonDto,
  LabelledLink,
  ProfileClaimDto,
  ProposalDto,
  Role,
  RoomDto,
  SessionDetailDto,
  SessionDto,
  TagDto,
  FormatDto,
  TrackDto,
  TrackWindowDto,
  ViewMode,
} from '@shared/types';
import type { Repeat } from '@shared/repeat';
import type { ExportPart } from '@shared/exportParts';

/** Error carrying the server's machine-readable code, so callers can react to
 *  `stale`, `overlap` or `rate_limited` specifically. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
    /** Facts the server attached for the client to act on — the gate's
     *  `profile_exists` names the profile it found. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const err = payload as
      | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
      | undefined;
    const retryAfter = Number(res.headers.get('Retry-After')) || undefined;
    throw new ApiError(
      res.status,
      err?.error?.code ?? 'unknown',
      err?.error?.message ?? 'Something went wrong',
      retryAfter,
      err?.error?.details,
    );
  }
  return payload as T;
}

const encode = encodeURIComponent;

export const api = {
  me: () => request<Me>('GET', '/me'),
  /** Mint a phrase this device shows so another device can become this identity. */
  mintLinkCode: () => request<LinkCodeDto>('POST', '/me/link-code'),
  /** Redeem a phrase from another device — the cookie switches to that identity. */
  linkDevice: (phrase: string) => request<Me>('POST', '/me/link', { phrase }),

  listEvents: () => request<EventSummary[]>('GET', '/events'),
  createEvent: (
    instanceKey: string,
    body: {
      name: string;
      slug: string;
      timezone: string;
      startDate: string;
      endDate: string;
      // Omit one and the server generates it, returning it in
      // `generatedPasswords` — the only time it is ever readable.
      viewerPassword?: string;
      userPassword?: string;
      adminPassword?: string;
      userRoleLabel?: string;
    },
  ) =>
    request<EventSummary & { generatedPasswords: GeneratedPasswords }>(
      'POST',
      '/events',
      body,
      { 'X-Instance-Key': instanceKey },
    ),
  /**
   * Build a whole event from one JSON document. `dryRun` validates and reports
   * without writing — the same code path, rolled back at the end, which is the
   * only way to find out whether a transcription is right.
   */
  importEvent: (instanceKey: string, doc: unknown, { dryRun = false } = {}) =>
    request<ImportResult>('POST', `/events/import${dryRun ? '?dryRun=1' : ''}`, doc, {
      'X-Instance-Key': instanceKey,
    }),
  cloneEvent: (
    slug: string,
    body: {
      newSlug: string;
      newName: string;
      startDate: string;
      endDate: string;
      viewerPassword: string;
      userPassword: string;
      adminPassword: string;
    },
    instanceKey?: string,
  ) =>
    request<EventSummary>(
      'POST',
      `/events/${encode(slug)}/clone`,
      body,
      instanceKey ? { 'X-Instance-Key': instanceKey } : {},
    ),

  /** `displayName` is claimed inside the event, where names are unique. A 409
   *  means someone here already has it — nothing is granted, so the gate can
   *  ask again. */
  /** The username this device already holds here, before it is in. */
  gate: (slug: string) => request<GateDto>('GET', `/e/${encode(slug)}/gate`),
  authenticate: (slug: string, password: string, displayName?: string, claimProfile?: boolean) =>
    request<{ role: Role }>('POST', `/e/${encode(slug)}/auth`, {
      password,
      displayName,
      claimProfile,
    }),
  /** Demo instances only: the gate picks a role instead of checking a password. */
  authenticateAsRole: (slug: string, role: Role, displayName?: string, claimProfile?: boolean) =>
    request<{ role: Role }>('POST', `/e/${encode(slug)}/auth`, { role, displayName, claimProfile }),
  /** Which role a password grants, without granting it — admin only. The
   *  invite-QR panel asks before drawing a code, because the server holds only
   *  bcrypt hashes and cannot check the organiser's typing any other way. */
  passwordRole: (slug: string, password: string) =>
    request<{ role: Role }>('POST', `/e/${encode(slug)}/password-role`, { password }),
  /** Rename yourself inside one event. 409 if the name is taken there. */
  renameInEvent: (slug: string, displayName: string) =>
    request<{ displayName: string }>('PATCH', `/e/${encode(slug)}/me`, { displayName }),
  logout: (slug: string) => request<void>('POST', `/e/${encode(slug)}/logout`),

  bundle: (slug: string) => request<BundleDto>('GET', `/e/${encode(slug)}/bundle`),
  updatePermissions: (slug: string, body: Record<string, Role[]>) =>
    request<Record<string, Role[]>>('PATCH', `/e/${encode(slug)}/permissions`, body),
  session: (slug: string, id: number) =>
    request<SessionDetailDto>('GET', `/e/${encode(slug)}/sessions/${id}`),

  createRoom: (slug: string, body: Partial<RoomDto> & { name: string }) =>
    request<RoomDto>('POST', `/e/${encode(slug)}/rooms`, body),
  updateRoom: (slug: string, id: number, body: Partial<RoomDto>) =>
    request<RoomDto>('PATCH', `/e/${encode(slug)}/rooms/${id}`, body),
  deleteRoom: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/rooms/${id}`),

  createTag: (slug: string, body: { name: string; color?: string }) =>
    request<TagDto>('POST', `/e/${encode(slug)}/tags`, body),
  updateTag: (slug: string, id: number, body: Partial<TagDto>) =>
    request<TagDto>('PATCH', `/e/${encode(slug)}/tags/${id}`, body),
  deleteTag: (slug: string, id: number) => request<void>('DELETE', `/e/${encode(slug)}/tags/${id}`),

  // Formats — what kind of thing a session is. Managed like tags; the list is
  // whatever this event runs.
  createFormat: (slug: string, body: { name: string; color?: string }) =>
    request<FormatDto>('POST', `/e/${encode(slug)}/formats`, body),
  updateFormat: (slug: string, id: number, body: Partial<Omit<FormatDto, 'id'>>) =>
    request<FormatDto>('PATCH', `/e/${encode(slug)}/formats/${id}`, body),
  deleteFormat: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/formats/${id}`),

  // Tracks — thematic strands the schedule can use as columns instead of rooms.
  createTrack: (slug: string, body: TrackWrite & { name: string }) =>
    request<TrackDto>('POST', `/e/${encode(slug)}/tracks`, body),
  updateTrack: (slug: string, id: number, body: TrackWrite) =>
    request<TrackDto>('PATCH', `/e/${encode(slug)}/tracks/${id}`, body),
  reorderTracks: (slug: string, ids: number[]) =>
    request<TrackDto[]>('PATCH', `/e/${encode(slug)}/tracks`, { ids }),
  deleteTrack: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/tracks/${id}`),

  // Breaks — lunch, dinner, coffee. Event furniture, so organisers only, and
  // there is nothing to read back on its own: the bundle carries them all.
  createBreak: (slug: string, body: BreakWrite) =>
    request<BreakDto>('POST', `/e/${encode(slug)}/breaks`, body),
  updateBreak: (slug: string, id: number, body: BreakWrite) =>
    request<BreakDto>('PATCH', `/e/${encode(slug)}/breaks/${id}`, body),
  deleteBreak: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/breaks/${id}`),

  person: (slug: string, id: number) =>
    request<PersonDetailDto>('GET', `/e/${encode(slug)}/people/${id}`),
  createPerson: (slug: string, body: PersonWrite) =>
    request<PersonDto>('POST', `/e/${encode(slug)}/people`, body),
  updatePerson: (slug: string, id: number, body: Partial<PersonWrite>) =>
    request<PersonDto>('PATCH', `/e/${encode(slug)}/people/${id}`, body),
  // No `deletePerson`. Nothing in the app deletes a profile any more:
  // archiving does the tidying up and Merge does the de-duplicating, and both
  // keep the sessions the profile is credited on. The server route is still
  // there for an operator with the API, but nothing in here reaches for it.
  /** Mint (or replace) a person's speaker code; the phrase is shown only once. */
  mintSpeakerCode: (slug: string, id: number) =>
    request<{ phrase: string }>('POST', `/e/${encode(slug)}/people/${id}/speaker-code`),
  revokeSpeakerCode: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/people/${id}/speaker-code`),
  /** Fold profile `from` into `id`: sessions/pitches repoint, `from` disappears. */
  /** "That profile is me." Returns the claims the caller may see. */
  claimPerson: (slug: string, id: number) =>
    request<ProfileClaimDto[]>('POST', `/e/${encode(slug)}/people/${id}/claim`),
  approveClaim: (slug: string, id: number) =>
    request<ProfileClaimDto[]>('POST', `/e/${encode(slug)}/claims/${id}/approve`),
  declineClaim: (slug: string, id: number) =>
    request<ProfileClaimDto[]>('POST', `/e/${encode(slug)}/claims/${id}/decline`),
  /** Withdraw your own request, or clear one you were refused. */
  withdrawClaim: (slug: string, id: number) =>
    request<ProfileClaimDto[]>('DELETE', `/e/${encode(slug)}/claims/${id}`),

  /**
   * Tidy a profile out of the organiser's lists without deleting it: it keeps
   * its sessions, its role and its holder.
   */
  archivePerson: (slug: string, id: number) =>
    request<PersonDto>('POST', `/e/${encode(slug)}/people/${id}/archive`),
  /** Out again — an organiser's doing, or the holder's own. */
  unarchivePerson: (slug: string, id: number) =>
    request<PersonDto>('DELETE', `/e/${encode(slug)}/people/${id}/archive`),

  /** Hand the holder of a profile a different role at this event. */
  setPersonRole: (slug: string, id: number, role: Role) =>
    request<PersonDto>('PUT', `/e/${encode(slug)}/people/${id}/role`, { role }),
  mergePerson: (slug: string, id: number, from: number) =>
    request<PersonDto>('POST', `/e/${encode(slug)}/people/${id}/merge`, { from }),
  // 201 when it creates your profile, 200 when it updates it — the caller only
  // needs the person back either way.
  updateMyProfile: (slug: string, body: Partial<PersonWrite>) =>
    request<PersonDto>('PATCH', `/e/${encode(slug)}/me/profile`, body),

  createSession: (slug: string, body: SessionWrite) =>
    request<SessionDto>('POST', `/e/${encode(slug)}/sessions`, body),
  /** The same session on every day of a run. Organisers only; see `repeat.ts`.
   *  `link` keeps the run as a series so a later edit can apply to the rest. */
  createSessionRepeat: (slug: string, body: SessionWrite & { repeat: Repeat; link?: boolean }) =>
    request<{ sessions: SessionDto[] }>('POST', `/e/${encode(slug)}/sessions/repeat`, body),
  /** `applyTo` reaches the rest of a linked series: 'later' or 'all'. The reply
   *  carries `seriesApply` counts when it did. */
  updateSession: (
    slug: string,
    id: number,
    body: Partial<SessionWrite> & {
      expectedUpdatedAt?: string;
      applyTo?: 'one' | 'later' | 'all';
    },
  ) =>
    request<SessionDto & { seriesApply?: { applied: number; considered: number } }>(
      'PATCH',
      `/e/${encode(slug)}/sessions/${id}`,
      body,
    ),
  deleteSession: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/sessions/${id}`),

  /** Sessions the signed-in user could link to `id`: same title, theirs. */
  sessionLinkCandidates: (slug: string, id: number) =>
    request<{ candidates: SessionDto[] }>(
      'GET',
      `/e/${encode(slug)}/sessions/${id}/link-candidates`,
    ),
  /** Link a chosen set of sessions into one series. */
  linkSessions: (slug: string, sessionIds: number[]) =>
    request<{ seriesId: string; sessions: SessionDto[] }>(
      'POST',
      `/e/${encode(slug)}/sessions/link`,
      { sessionIds },
    ),
  /** Drop one session out of its series. */
  unlinkSession: (slug: string, sessionId: number) =>
    request<{ sessions: SessionDto[] }>('POST', `/e/${encode(slug)}/sessions/unlink`, {
      sessionId,
    }),

  addContribution: (
    slug: string,
    sessionId: number,
    body: { kind: 'note' | 'link' | 'question'; body: string; url?: string },
  ) => request<ContributionDto>('POST', `/e/${encode(slug)}/sessions/${sessionId}/contributions`, body),
  deleteContribution: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/contributions/${id}`),
  setContributionHidden: (slug: string, id: number, hidden: boolean) =>
    request<ContributionDto>('PATCH', `/e/${encode(slug)}/contributions/${id}/hidden`, { hidden }),

  /** Proves the caller knows the organiser password. Grants nothing. */
  confirmAdmin: (slug: string, password: string) =>
    request<void>('POST', `/e/${encode(slug)}/confirm-admin`, { password }),
  updateSettings: (slug: string, body: SettingsWrite) =>
    request<EventDto>('PATCH', `/e/${encode(slug)}/settings`, body),

  // Proposal pool — the unconference pitch board (SPEC §8).
  createProposal: (slug: string, body: ProposalWrite) =>
    request<ProposalDto>('POST', `/e/${encode(slug)}/proposals`, body),
  updateProposal: (slug: string, id: number, body: ProposalWrite) =>
    request<ProposalDto>('PATCH', `/e/${encode(slug)}/proposals/${id}`, body),
  deleteProposal: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/proposals/${id}`),
  addProposalInterest: (slug: string, id: number) =>
    request<void>('PUT', `/e/${encode(slug)}/proposals/${id}/interest`),
  removeProposalInterest: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/proposals/${id}/interest`),
  placeProposal: (slug: string, id: number, body: PlaceWrite) =>
    request<{ session: SessionDto; proposalId: number }>(
      'POST',
      `/e/${encode(slug)}/proposals/${id}/place`,
      body,
    ),

  // Restore-from-trash — admin undo for soft deletes (SPEC §8).
  trash: (slug: string) => request<TrashDto>('GET', `/e/${encode(slug)}/trash`),
  restoreSession: (slug: string, id: number) =>
    request<SessionDto>('POST', `/e/${encode(slug)}/sessions/${id}/restore`),
  restoreContribution: (slug: string, id: number) =>
    request<ContributionDto>('POST', `/e/${encode(slug)}/contributions/${id}/restore`),

  /** The write log, newest first. `before` is the previous page's
   *  `nextCursor` — keyset paging, because the log grows at the head. */
  audit: (slug: string, before?: number) =>
    request<AuditPageDto>(
      'GET',
      `/e/${encode(slug)}/audit${before === undefined ? '' : `?before=${before}`}`,
    ),

  /** Everyone who has ever picked a name or held a role at this event —
   *  admin-only, the other half of the profile roster. */

  /** The per-event JSON export is a plain authenticated GET, so the link in
   *  Manage Event downloads it directly — no fetch, no blob, no wrapper.
   *  `parts` is what to include besides the frame; omit it for everything. */
  exportUrl: (slug: string, parts?: readonly ExportPart[]) =>
    `/api/e/${encode(slug)}/export.json${
      parts === undefined ? '' : `?include=${parts.join(',')}`
    }`,

  /**
   * Encrypted whole-instance backup. Outside `request` deliberately: the
   * response is binary, and the passphrase must go in a POST body rather than
   * a URL that would land in an access log.
   */
  downloadBackup: async (
    instanceKey: string,
    passphrase: string,
  ): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch('/api/backup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Instance-Key': instanceKey },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => undefined)) as
        | { error?: { code?: string; message?: string } }
        | undefined;
      throw new ApiError(
        res.status,
        payload?.error?.code ?? 'unknown',
        payload?.error?.message ?? 'The backup could not be made',
        Number(res.headers.get('Retry-After')) || undefined,
      );
    }
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const named = /filename="([^"]+)"/.exec(disposition);
    return { blob: await res.blob(), filename: named?.[1] ?? 'libresesh-backup.lsbk' };
  },

  // Personal agenda. Both calls are idempotent server-side and stay allowed on
  // archived events — a bookmark is not event content — so there is no SSE echo.
  starSession: (slug: string, id: number) =>
    request<void>('PUT', `/e/${encode(slug)}/sessions/${id}/star`),
  unstarSession: (slug: string, id: number) =>
    request<void>('DELETE', `/e/${encode(slug)}/sessions/${id}/star`),
  /** Mints once, then returns the same token on every later call. */
  calendarToken: (slug: string) =>
    request<{ token: string }>('POST', `/e/${encode(slug)}/calendar-token`),
};

export interface SessionWrite {
  roomId: number;
  type?: 'official' | 'open';
  /** Organisers only, official sessions only: while this runs, attendees may
   *  place nothing anywhere in the event. */
  blocksOpenBooking?: boolean;
  title: string;
  description?: string;
  /**
   * Everyone giving it, in billing order: a number for somebody already on the
   * roster, a name for somebody new — a name that matches nobody creates a
   * person. Omit to leave the billing alone; `[]` clears it.
   */
  speakers?: (number | string)[];
  /** Watch-along links, http(s). `[]` clears them. */
  livestreams?: LabelledLink[];
  startsAt: string;
  endsAt: string;
  tagIds?: number[];
  /** `null` clears the track; omitting the key leaves it as it was. */
  trackId?: number | null;
  /** What kind of session it is. `null` clears it; omitting the key leaves it
   *  as it was. */
  formatId?: number | null;
}

export interface TrackWrite {
  name?: string;
  /** '' clears it; omitting it leaves the stored one alone. */
  description?: string;
  color?: string;
  /**
   * The hours the track accepts sessions in, as local minutes on the 5-minute
   * grid. Send both or neither: `null` for the pair lifts the limit, and
   * omitting them leaves the stored window alone.
   */
  startMin?: number | null;
  endMin?: number | null;
  /** Days that keep different hours. The whole list, every time — what is sent
   *  replaces what is stored. */
  windows?: TrackWindowDto[];
}

export interface BreakWrite {
  label: string;
  /** Local minutes since midnight, on the 5-minute grid. */
  startMin: number;
  endMin: number;
  /** One day only; null or omitted means every day of the event. */
  date?: string | null;
}

export interface ProposalWrite {
  title: string;
  description?: string;
  /** Link to an existing person, or `null` to detach. */
  speakerId?: number | null;
  /** A name that matches nobody creates a person. Used instead of `speakerId`. */
  speakerName?: string;
  tagIds?: number[];
}

export interface PlaceWrite {
  roomId: number;
  startsAt: string;
  endsAt: string;
  type?: 'official' | 'open';
}

/** The two soft-deleted kinds an organiser can bring back. `deletedByName` on a
 *  session is the pitch/creator name the server records against the row. */
export interface TrashDto {
  sessions: { id: number; title: string; deletedAt: string; deletedByName: string }[];
  contributions: {
    id: number;
    sessionId: number;
    kind: ContributionKind;
    body: string;
    deletedAt: string;
    createdByName: string;
  }[];
}

export interface PersonWrite {
  name: string;
  bio?: string;
  links?: LabelledLink[];
}

export interface SettingsWrite {
  name?: string;
  /** Moves the event to a new address; the old one keeps resolving. */
  slug?: string;
  startDate?: string;
  endDate?: string;
  weekRailFrom?: number;
  dayStartMin?: number;
  dayEndMin?: number;
  viewerPassword?: string;
  userPassword?: string;
  adminPassword?: string;
  userRoleLabel?: string;
  auditKeep?: number;
  /** Where the schedule opens for a reader who has not picked a view. */
  defaultView?: ViewMode;
  /** Whether the grid and the list badge an official session. */
  showOfficialBadge?: boolean;
  /** Whether this event runs a pitch board. Off hides it; nothing is deleted. */
  pitchesEnabled?: boolean;
  archived?: boolean;
}
