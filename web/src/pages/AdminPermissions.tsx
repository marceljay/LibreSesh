import { useEffect, useState } from 'react';
import type { Role } from '@shared/types';
import { CAPABILITIES, type Capability, type PermissionMatrix } from '@shared/capabilities';
import {
  ControlShell,
  Field,
  FormRow,
  PrimaryButton,
  SecondaryButton,
  Section,
  TextInput,
  Toggle,
} from '../components/ui';

const ROLES: Role[] = ['viewer', 'user', 'speaker', 'admin'];

/**
 * Order-insensitive on purpose. The server hands a capability back in
 * `ROLE_ORDER` once it has stored an override, but in the capability's own
 * declared order while it still sits at its defaults — so a switch flipped
 * back to default returns the same set in a different order, and comparing
 * position would leave the optimistic value stranded on top of it forever.
 */
const sameRoles = (a: Role[], b: Role[]): boolean =>
  a.length === b.length && a.every((r) => b.includes(r));

/**
 * The saved matrix with any still-unconfirmed switch laid over it, in canonical
 * role order.
 *
 * A switch has to move the instant it is clicked — a checkbox paints itself on
 * click and React puts it straight back on the next render, so with nothing
 * held locally the switch visibly flicks back and then flicks forward again a
 * round trip later. The overlay is what it is drawn from until the saved value
 * catches up.
 */
export function overlay(
  saved: Partial<PermissionMatrix>,
  optimistic: Partial<PermissionMatrix>,
  capability: Capability,
): Role[] {
  return optimistic[capability] ?? saved[capability] ?? [];
}

/**
 * Drop every optimistic entry the saved matrix has caught up with, keeping the
 * object identity when nothing changed so this can run on each render pass.
 */
export function settled(
  saved: Partial<PermissionMatrix>,
  optimistic: Partial<PermissionMatrix>,
): Partial<PermissionMatrix> {
  const entries = Object.entries(optimistic) as [Capability, Role[]][];
  const unsettled = entries.filter(([cap, roles]) => !sameRoles(roles, saved[cap] ?? []));
  return unsettled.length === entries.length
    ? optimistic
    : (Object.fromEntries(unsettled) as Partial<PermissionMatrix>);
}

export interface AdminPermissionsProps {
  permissions: Partial<PermissionMatrix>;
  userRoleLabel: string;
  onChange: (next: Partial<PermissionMatrix>) => Promise<void>;
  /** Resolves true when the organiser password was right. */
  onUnlock: (password: string) => Promise<boolean>;
}

/**
 * Who may do what, per event. The admin column is rendered but locked on:
 * switching admin off for, say, moderation would produce an event nobody can
 * moderate and nobody can repair. Viewer and attendee are where the actual
 * policy decisions live.
 */
export function AdminPermissions({
  permissions,
  userRoleLabel,
  onChange,
  onUnlock,
}: AdminPermissionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  // Switches that have been clicked but whose save has not come back yet.
  const [optimistic, setOptimistic] = useState<Partial<PermissionMatrix>>({});
  // Each toggle saves the instant it is clicked and there is no undo, so the
  // matrix opens read-only. Nothing here is reversible by a second glance:
  // switching moderation off for organisers-but-one is invisible until someone
  // needs it.
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);

  const unlock = async () => {
    if (!password.trim() || checking) return;
    setChecking(true);
    try {
      if (await onUnlock(password.trim())) {
        setUnlocked(true);
        setPassword('');
      }
    } finally {
      setChecking(false);
    }
  };

  const heading = (role: Role) =>
    role === 'user'
      ? userRoleLabel.trim() || 'Attendee'
      : { viewer: 'Viewer', speaker: 'Speaker', admin: 'Organiser' }[role as Exclude<Role, 'user'>];

  // The saved matrix arrives from two directions — the save's own response and
  // the server's SSE echo of it — and either may land first. Retiring an
  // optimistic entry by comparing it with the saved value, rather than when the
  // request resolves, means neither order can leave the switch out of step.
  useEffect(() => {
    setOptimistic((current) => settled(permissions, current));
  }, [permissions]);

  const toggle = async (capability: Capability, role: Role, next: boolean) => {
    if (busy) return;
    const current = overlay(permissions, optimistic, capability);
    const updated = next ? [...current, role] : current.filter((r) => r !== role);
    const canonical = ROLES.filter((r) => updated.includes(r));
    setOptimistic((o) => ({ ...o, [capability]: canonical }));
    setBusy(`${capability}:${role}`);
    try {
      await onChange({ [capability]: canonical });
    } catch {
      // Put the switch back where the server still has it; `onChange` has
      // already reported why.
      setOptimistic(({ [capability]: _rejected, ...rest }) => rest);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Permissions"
      description="What each role may do at this event. Organisers always keep every capability — an event nobody can moderate has no way back."
      actions={
        unlocked ? (
          <SecondaryButton className="shrink-0 py-1.5" onClick={() => setUnlocked(false)}>
            Lock
          </SecondaryButton>
        ) : undefined
      }
    >
      {!unlocked && (
        <div className="mb-4 rounded-lg border border-stone-200 bg-stone-100 p-3 dark:border-stone-700 dark:bg-stone-800">
          {/* The button lives *inside* the Field, so the label sits above the
              whole row and the hint below it. Put it outside and `items-end`
              aligns it to the bottom of the hint — two lines lower than the
              box it belongs to. See `FormRow` in ui.tsx. */}
          <Field
            label="Unlock with the organiser password"
            hint="Every switch here saves the moment you click it, and there is no undo."
          >
            <FormRow>
              <ControlShell className="min-w-40 flex-1">
                <TextInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void unlock()}
                  autoComplete="off"
                />
              </ControlShell>
              <PrimaryButton onClick={() => void unlock()} disabled={!password.trim() || checking}>
                {checking ? 'Checking…' : 'Unlock'}
              </PrimaryButton>
            </FormRow>
          </Field>
        </div>
      )}

      <div
        className={`overflow-x-auto ${unlocked ? '' : 'select-none opacity-50'}`}
        aria-disabled={!unlocked}
      >
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 dark:border-stone-700">
              <th className="py-2 pe-3 text-start text-xs font-semibold text-stone-500 dark:text-stone-400">
                Capability
              </th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  className="w-20 py-2 text-center text-xs font-semibold capitalize text-stone-500 dark:text-stone-400"
                >
                  {heading(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((cap) => {
              const allowed = overlay(permissions, optimistic, cap.id);
              return (
                <tr
                  key={cap.id}
                  className="border-b border-stone-100 last:border-0 dark:border-stone-800"
                >
                  <td className="py-2 pe-3 text-stone-700 dark:text-stone-300">{cap.label}</td>
                  {ROLES.map((role) => (
                    <td key={role} className="py-2 text-center">
                      <span className="inline-flex justify-center">
                        <Toggle
                          checked={role === 'admin' || allowed.includes(role)}
                          disabled={!unlocked || role === 'admin' || busy !== null}
                          title={
                            role === 'admin'
                              ? 'Organisers always keep every capability'
                              : !unlocked
                                ? 'Unlock with the organiser password to change this'
                                : undefined
                          }
                          onChange={(next) => void toggle(cap.id, role, next)}
                          label={<span className="sr-only">{`${heading(role)}: ${cap.label}`}</span>}
                        />
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
