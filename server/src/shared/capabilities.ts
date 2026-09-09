import type { Role } from './types.js';

/**
 * The things an organiser can hand out or withhold, and what they are called
 * in the admin UI. Shared so the client can render the matrix and gate its own
 * controls from the same list the server enforces.
 *
 * Everything not listed is fixed: managing rooms, tags, people, settings and
 * the trash is always admin-only, because those are how an event is
 * administered at all.
 */
export const CAPABILITIES = [
  {
    id: 'contribution.create',
    label: 'Add notes, links and questions',
    defaults: ['user', 'speaker', 'admin'],
  },
  {
    id: 'contribution.delete_own',
    label: 'Delete their own contributions',
    defaults: ['user', 'speaker', 'admin'],
  },
  {
    id: 'contribution.moderate',
    label: 'Hide anyone’s contribution',
    defaults: ['admin'],
  },
  {
    id: 'session.create_open',
    label: 'Create sessions in rooms that allow booking',
    defaults: ['user', 'speaker', 'admin'],
  },
  {
    id: 'session.edit_own',
    label: 'Edit and delete their own sessions',
    defaults: ['user', 'speaker', 'admin'],
  },
  {
    // Open by default: the app leans towards rooms where people trust each
    // other and invite co-hosts. Off, and a person can credit only
    // themselves — the field is a toggle between "me" and "nobody".
    id: 'session.credit_others',
    label: 'Credit other people as speakers on sessions and pitches',
    defaults: ['user', 'speaker', 'admin'],
  },
  {
    id: 'proposal.create',
    label: 'Pitch a session to the proposal board',
    defaults: ['user', 'speaker', 'admin'],
  },
  {
    id: 'proposal.vote',
    label: 'Register interest in a pitch',
    defaults: ['viewer', 'user', 'speaker', 'admin'],
  },
  {
    id: 'session.star',
    label: 'Star sessions and build a personal agenda',
    defaults: ['viewer', 'user', 'speaker', 'admin'],
  },
  {
    id: 'person.edit_own',
    label: 'Edit their own profile',
    defaults: ['viewer', 'user', 'speaker', 'admin'],
  },
] as const satisfies readonly { id: string; label: string; defaults: readonly Role[] }[];

export type Capability = (typeof CAPABILITIES)[number]['id'];

export const CAPABILITY_IDS = CAPABILITIES.map((c) => c.id) as Capability[];

/** capability -> the roles allowed to use it. */
export type PermissionMatrix = Record<Capability, Role[]>;

export const isCapability = (value: string): value is Capability =>
  (CAPABILITY_IDS as string[]).includes(value);

/** Admin can always do everything, whatever the matrix says. */
export const can = (
  matrix: Partial<PermissionMatrix>,
  role: Role,
  capability: Capability,
): boolean => role === 'admin' || (matrix[capability]?.includes(role) ?? false);
