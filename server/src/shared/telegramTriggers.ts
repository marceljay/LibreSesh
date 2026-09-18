/**
 * The triggers a Telegram announcement can fire on, and the presets over them.
 *
 * Shared because the presets are read three times: by the route that stores
 * one, by the panel that names them, and by the Example that draws a bubble
 * per trigger a preset fires. The Example kept its own copy for a while and
 * drew a message for a rung whose trigger was unwritten — the failure this
 * file exists to make impossible, because one list cannot disagree with
 * itself.
 */

export type Trigger = 'up_next' | 'digest' | 'added' | 'changed' | 'placed';

export const TRIGGERS: readonly Trigger[] = ['up_next', 'digest', 'added', 'changed', 'placed'];

/**
 * Modes are **presets over the trigger set**, not a stored value of their own.
 * Storing both would let the label disagree with the behaviour; deriving it
 * means a set matching no preset reports "custom", which is the truth.
 *
 * Every rung has a trigger behind it that actually fires — that is the rule the
 * ladder is held to, and for a while it had only two rungs because `digest`,
 * `added` and `changed` were named and unwritten. Light sending nothing while
 * calling itself "one message each morning" is the failure this guards.
 *
 * **Light is `up_next`, not `digest`.** `announcements.md` fixes only that
 * Medium carries the digest; which rung is quietest is ours to choose. Putting
 * the per-slot message at the bottom makes migration 023's stored default —
 * `["up_next"]` — a preset with a name, so no event opens its panel on
 * "Custom", a state nobody picked and no control could return to.
 */
export const MODES: Record<string, Trigger[]> = {
  off: [],
  light: ['up_next'],
  medium: ['digest', 'up_next', 'placed'],
  heavy: ['digest', 'up_next', 'placed', 'added', 'changed'],
};

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Which preset this trigger set is, or 'custom' when it is none of them. */
export function modeOf(triggers: readonly Trigger[]): string {
  for (const [name, set] of Object.entries(MODES)) if (sameSet(triggers, set)) return name;
  return 'custom';
}

/** Stored as JSON; anything unrecognised is dropped rather than trusted. */
export function parseTriggers(raw: string | null): Trigger[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is Trigger => TRIGGERS.includes(t as Trigger));
  } catch {
    return [];
  }
}
