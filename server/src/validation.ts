import { z } from 'zod';
import { badRequest } from './errors.js';
import { isValidTimezone } from './shared/time.js';

/** Trimmed string that must still have content after trimming. */
export const trimmed = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max));

export const optionalTrimmed = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(max));

export const displayNameSchema = trimmed(40);
/** Day count at which the schedule switches to a week rail. One would mean
 *  every event gets one; beyond a quarter the rail is unusable either way. */
export const weekRailFromSchema = z.coerce.number().int().min(1).max(90);
/**
 * Audit entries kept per event. 0 means keep everything; anything else has a
 * floor, because a cap of five would make the log a rolling toy rather than a
 * record — and the point of the setting is storage, not forgetting on demand.
 */
export const auditKeepSchema = z.coerce
  .number()
  .int()
  .refine((n) => n === 0 || (n >= 100 && n <= 1_000_000), {
    message: 'Keep 0 (everything) or between 100 and 1,000,000 entries',
  });

/** What an event calls its middle role. Shown as a chip, so keep it short. */
export const roleLabelSchema = trimmed(24);
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9-]{3,40}$/, 'Slug must be 3–40 characters of a–z, 0–9 or -');
export const passwordSchema = z.string().min(6, 'Passwords must be at least 6 characters');

/**
 * The three event passwords are the only thing telling the roles apart, and
 * `roleForPassword` checks admin, then user, then viewer — so two roles sharing
 * a password silently grants the *higher* one. An organiser who sets the same
 * word for viewer and admin has not made one password for everybody; they have
 * made everybody an admin. Reject it at the door rather than explain it later.
 */
type PasswordTrio = {
  viewerPassword?: string | undefined;
  userPassword?: string | undefined;
  adminPassword?: string | undefined;
};

const ROLE_OF_FIELD = {
  viewerPassword: 'viewer',
  userPassword: 'attendee',
  adminPassword: 'organiser',
} as const;

/** Names the first colliding pair, or undefined when they are all distinct. */
export function collidingPasswords(v: PasswordTrio): [keyof typeof ROLE_OF_FIELD, keyof typeof ROLE_OF_FIELD] | undefined {
  const fields = ['viewerPassword', 'userPassword', 'adminPassword'] as const;
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      const a = v[fields[i]];
      const b = v[fields[j]];
      if (a !== undefined && b !== undefined && a === b) return [fields[i], fields[j]];
    }
  }
  return undefined;
}

export function distinctPasswordsRefinement(v: PasswordTrio, ctx: z.RefinementCtx): void {
  const clash = collidingPasswords(v);
  if (!clash) return;
  const [first, second] = clash;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [second],
    message: `The ${ROLE_OF_FIELD[second]} and ${ROLE_OF_FIELD[first]} passwords must be different — a shared password grants whichever role is higher`,
  });
}
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const timezoneSchema = z
  .string()
  .refine(isValidTimezone, 'Unknown timezone — use an IANA name like Europe/Berlin');
export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #6B7280');
/** Minute-of-day, on the 5-minute grid the calendar snaps to. */
export const minuteOfDaySchema = z.number().int().min(0).max(1440);

export const isoInstantSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Expected an ISO-8601 timestamp');

export const renameSchema = z.object({ displayName: displayNameSchema });

export const linkPhraseSchema = z.object({ phrase: z.string().min(1).max(120) });

/** Merge duplicate people: `from` is folded into the profile in the URL. */
export const mergePersonSchema = z.object({ from: z.number().int().positive() });

export const createEventSchema = z
  .object({
    name: trimmed(120),
    slug: slugSchema,
    timezone: timezoneSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    dayStartMin: minuteOfDaySchema.optional(),
    dayEndMin: minuteOfDaySchema.optional(),
    // Optional: a blank field is filled in by resolveEventPasswords rather
    // than rejected, so nobody has to invent three passwords on the spot.
    viewerPassword: passwordSchema.optional(),
    userPassword: passwordSchema.optional(),
    adminPassword: passwordSchema.optional(),
    userRoleLabel: roleLabelSchema.optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'End date must not be before the start date',
    path: ['endDate'],
  })
  .refine((v) => (v.dayEndMin ?? 1320) > (v.dayStartMin ?? 480), {
    message: 'Day end must be after day start',
    path: ['dayEndMin'],
  })
  .superRefine(distinctPasswordsRefinement);

export const cloneEventSchema = z
  .object({
    newSlug: slugSchema,
    newName: trimmed(120),
    startDate: dateSchema,
    endDate: dateSchema,
    viewerPassword: passwordSchema,
    userPassword: passwordSchema,
    adminPassword: passwordSchema,
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'End date must not be before the start date',
    path: ['endDate'],
  })
  .superRefine(distinctPasswordsRefinement);

/** Demo instances hand out a role on a click; there is no password to check. */
export const demoAuthSchema = z.object({
  role: z.enum(['viewer', 'user', 'admin']),
  displayName: displayNameSchema.optional(),
});

export const authSchema = z.object({
  password: z.string().min(1).max(200),
  /** The name to go by inside this event. Optional: without one you keep the
   *  name you already claimed here, or are seeded from your global default. */
  displayName: displayNameSchema.optional(),
});

/** One day keeping different hours from its track's. */
const trackWindowSchema = z.object({
  date: dateSchema,
  startMin: minuteOfDaySchema,
  endMin: minuteOfDaySchema,
});

/**
 * The hours half of a track, shared by POST and PATCH. `startMin`/`endMin` go
 * together or not at all — a half-set window has no meaning, and storing one
 * would leave the rule reading a null it cannot act on. Sending null for both
 * is how an organiser takes the limit off again.
 */
const trackHoursShape = {
  startMin: minuteOfDaySchema.nullable().optional(),
  endMin: minuteOfDaySchema.nullable().optional(),
  /** The whole list, every time: what is sent replaces what is stored. */
  windows: z.array(trackWindowSchema).max(60).optional(),
};

const checkTrackHours = (
  v: { startMin?: number | null; endMin?: number | null; windows?: z.infer<typeof trackWindowSchema>[] },
  ctx: z.RefinementCtx,
): void => {
  const half =
    (v.startMin === null || v.startMin === undefined) !==
    (v.endMin === null || v.endMin === undefined);
  if (half) {
    ctx.addIssue({
      code: 'custom',
      path: ['endMin'],
      message: 'Give both ends of the window, or neither',
    });
  }
  const spans: [string, number, number][] = [];
  if (typeof v.startMin === 'number' && typeof v.endMin === 'number') {
    spans.push(['endMin', v.startMin, v.endMin]);
  }
  for (const [i, w] of (v.windows ?? []).entries()) {
    spans.push([`windows.${i}.endMin`, w.startMin, w.endMin]);
  }
  for (const [path, startMin, endMin] of spans) {
    if (startMin % 5 !== 0 || endMin % 5 !== 0) {
      ctx.addIssue({ code: 'custom', path: [path], message: 'Times land on a 5-minute step' });
    }
    if (endMin <= startMin) {
      ctx.addIssue({ code: 'custom', path: [path], message: 'A window must end after it starts' });
    }
  }
  const dates = (v.windows ?? []).map((w) => w.date);
  if (new Set(dates).size !== dates.length) {
    ctx.addIssue({ code: 'custom', path: ['windows'], message: 'One window per day' });
  }
};

export const trackSchema = z
  .object({
    name: trimmed(60),
    description: optionalTrimmed(500).optional(),
    color: colorSchema.optional(),
    ...trackHoursShape,
  })
  .superRefine(checkTrackHours);
export const trackPatchSchema = z
  .object({
    name: trimmed(60).optional(),
    description: optionalTrimmed(500).optional(),
    color: colorSchema.optional(),
    ...trackHoursShape,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .superRefine(checkTrackHours);
export const trackOrderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(60),
});

export const roomSchema = z.object({
  name: trimmed(80),
  description: optionalTrimmed(500).optional(),
  capacity: z.number().int().min(0).max(100000).nullable().optional(),
  color: colorSchema.optional(),
  openBooking: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
export const roomPatchSchema = roomSchema.partial();

export const tagSchema = z.object({
  name: trimmed(40),
  color: colorSchema.optional(),
});
export const tagPatchSchema = tagSchema.partial();

/** An optional http(s) URL. '' is allowed and means "not set" — that is how a
 *  livestream link is cleared. Same protocol rules as contribution links. */
const optionalHttpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((raw) => {
    if (raw === '') return true;
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Only http and https links');

/**
 * A break — lunch, dinner, coffee. Local minutes of day rather than instants,
 * because "every day at noon" is the thing being said; and on the same
 * 5-minute grid the calendar snaps sessions to, so the band lines up with the
 * blocks around it.
 */
export const breakSchema = z
  .object({
    label: trimmed(60),
    startMin: minuteOfDaySchema,
    endMin: minuteOfDaySchema,
    /** Omit or send null for "every day of the event". */
    date: dateSchema.nullish(),
  })
  .superRefine((v, ctx) => {
    for (const field of ['startMin', 'endMin'] as const) {
      if (v[field] % 5 !== 0) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Times land on a 5-minute step' });
      }
    }
    if (v.endMin <= v.startMin) {
      ctx.addIssue({ code: 'custom', path: ['endMin'], message: 'A break must end after it starts' });
    }
  });

/** PATCH sends the whole break — there are only four fields, and a partial
 *  update would still have to re-check end-after-start against the stored row. */
export const breakPatchSchema = breakSchema;

export const sessionSchema = z.object({
  roomId: z.number().int().positive(),
  type: z.enum(['official', 'open']).optional(),
  /** Organisers only; refused on an open session. */
  blocksOpenBooking: z.boolean().optional(),
  title: trimmed(120),
  description: optionalTrimmed(5000).optional(),
  speakerId: z.number().int().positive().nullable().optional(),
  /** Convenience for the session form: names an existing person or creates one. */
  speakerName: optionalTrimmed(120).optional(),
  livestreamUrl: optionalHttpUrl.optional(),
  startsAt: isoInstantSchema,
  endsAt: isoInstantSchema,
  tagIds: z.array(z.number().int().positive()).max(20).optional(),
  trackId: z.number().int().positive().nullable().optional(),
});
export const sessionPatchSchema = sessionSchema.partial().extend({
  expectedUpdatedAt: isoInstantSchema.optional(),
});

export const contributionSchema = z
  .object({
    kind: z.enum(['note', 'link', 'question']),
    body: trimmed(2000),
    url: z.string().max(2000).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'link') {
      if (!v.url) {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'Links need a URL' });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(v.url);
      } catch {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'That is not a valid URL' });
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'Only http and https links' });
      }
    } else if (v.url) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Only links may carry a URL' });
    }
  });

export const hiddenSchema = z.object({ hidden: z.boolean() });

/** A partial permission matrix: capability -> the roles allowed to use it. */
export const permissionsSchema = z.record(
  z.string().max(64),
  z.array(z.enum(['viewer', 'user', 'speaker', 'admin'])).max(4),
);

/** A pitch: everything a session has except a room and a time. */
export const proposalSchema = z.object({
  title: trimmed(120),
  description: optionalTrimmed(5000).optional(),
  speakerId: z.number().int().positive().nullable().optional(),
  speakerName: optionalTrimmed(120).optional(),
  tagIds: z.array(z.number().int().positive()).max(20).optional(),
});
export const proposalPatchSchema = proposalSchema.partial();

/** Placing a pitch onto the grid. */
export const placeSchema = z.object({
  roomId: z.number().int().positive(),
  startsAt: isoInstantSchema,
  endsAt: isoInstantSchema,
  type: z.enum(['official', 'open']).optional(),
});

/** Profile links reuse the contribution URL rules: http(s) only. */
const linkSchema = z.object({
  label: trimmed(60),
  url: z
    .string()
    .max(2000)
    .refine((raw) => {
      try {
        const parsed = new URL(raw);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Only http and https links'),
});

export const personSchema = z.object({
  name: trimmed(120),
  bio: optionalTrimmed(2000).optional(),
  links: z.array(linkSchema).max(10).optional(),
});
export const personPatchSchema = personSchema.partial();

/** Editing your own profile cannot reassign who owns it. */
export const myProfileSchema = z.object({
  name: trimmed(120).optional(),
  bio: optionalTrimmed(2000).optional(),
  links: z.array(linkSchema).max(10).optional(),
});

export const settingsSchema = z
  .object({
    name: trimmed(120).optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    dayStartMin: minuteOfDaySchema.optional(),
    dayEndMin: minuteOfDaySchema.optional(),
    weekRailFrom: weekRailFromSchema.optional(),
    viewerPassword: passwordSchema.optional(),
    userPassword: passwordSchema.optional(),
    adminPassword: passwordSchema.optional(),
    userRoleLabel: roleLabelSchema.optional(),
    auditKeep: auditKeepSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  // Only the passwords actually being changed are visible here; a new password
  // colliding with one that is staying put is caught in the settings route,
  // which can compare against the stored hashes.
  .superRefine(distinctPasswordsRefinement);

/** Parse with a schema, converting a zod failure into a 400 with a readable message. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.');
    throw badRequest(path ? `${path}: ${issue?.message}` : (issue?.message ?? 'Invalid input'));
  }
  return result.data;
}
