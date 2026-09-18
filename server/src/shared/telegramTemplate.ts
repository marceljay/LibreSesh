/**
 * The line an organiser writes for a session, and the two rules that fill it.
 *
 * Shared because it is rendered three times: into Telegram HTML by the bot,
 * into React by the Example modal, and into React again by the live line under
 * the box an organiser is typing in. Three implementations of one grammar is
 * three places for it to drift, and the whole point of showing somebody their
 * own line is that what they see is what the group gets.
 *
 * What stays out of here: how a part becomes markup. The bot needs an anchor
 * tag and the panel needs a `<span>`, so this resolves the *structure* — which
 * parts survive, in what order, carrying which value — and each side draws it.
 */

/**
 * The names a template may use. Anything else is a typo, refused when the
 * template is saved rather than printed as `{tilte}` at 09:45 on the day.
 */
export const PLACEHOLDERS = [
  'title',
  'room',
  'track',
  'speakers',
  'format',
  'tags',
  'streams',
  'time',
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

/** What an organiser gets if they never touch it. */
export const DEFAULT_TEMPLATE = '{title}[, by {speakers}]';

/**
 * The longest template we will store. A Telegram message caps at 4096 and the
 * template is repeated once per session in a slot, so a long one is a slot that
 * has to be split.
 */
export const MAX_TEMPLATE = 500;

export interface TemplateProblem {
  /** A code the client turns into a sentence; never prose from the server. */
  code: 'unknown_placeholder' | 'unbalanced' | 'too_long';
  /** The offending name, for `unknown_placeholder`. */
  name?: string;
}

/**
 * Whether a template can be stored.
 *
 * Everything knowable early is known early. A template that only breaks on a
 * session with no speakers breaks for the first time in front of a room, which
 * is the failure this whole design exists to avoid.
 */
export function checkTemplate(template: string): TemplateProblem | null {
  if (template.length > MAX_TEMPLATE) return { code: 'too_long' };

  let depth = 0;
  for (const char of template) {
    if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    if (depth < 0) return { code: 'unbalanced' };
  }
  if (depth !== 0) return { code: 'unbalanced' };

  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const name = match[1] ?? '';
    if (!PLACEHOLDERS.includes(name as Placeholder)) return { code: 'unknown_placeholder', name };
  }
  return null;
}

/** One piece of a rendered line: a placeholder's value, or literal text. */
export interface TemplatePart {
  /** The placeholder this came from, or null for the organiser's own words. */
  name: Placeholder | null;
  /** The plain value or the literal text. Neither is escaped — that is the
   *  drawing side's job, and it differs per side. */
  text: string;
}

/** The `]` closing the `[` at `open`. An unbalanced template cannot be saved. */
function matching(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/**
 * Resolve a template against one session's values.
 *
 * `{name}` becomes that value. `[...]` survives only if some placeholder inside
 * it had a value — which is the one thing a plain placeholder string cannot do,
 * and without it `{title}, by {speakers}` leaves "Repair café, by " on a
 * session nobody is credited for.
 *
 * Empty values are dropped rather than emitted, so a caller can join the parts
 * without checking for blanks.
 */
export function templateParts(
  template: string,
  values: Partial<Record<Placeholder, string>>,
): TemplatePart[] {
  const walk = (text: string): { parts: TemplatePart[]; filled: boolean } => {
    const parts: TemplatePart[] = [];
    let filled = false;
    let literal = '';
    let i = 0;
    const flush = (): void => {
      if (literal !== '') parts.push({ name: null, text: literal });
      literal = '';
    };

    while (i < text.length) {
      const char = text[i]!;
      if (char === '[') {
        const close = matching(text, i);
        const inner = walk(text.slice(i + 1, close));
        if (inner.filled) {
          flush();
          parts.push(...inner.parts);
          filled = true;
        }
        i = close + 1;
        continue;
      }
      if (char === '{') {
        const close = text.indexOf('}', i);
        if (close === -1) {
          literal += char;
          i += 1;
          continue;
        }
        const name = text.slice(i + 1, close) as Placeholder;
        const value = values[name] ?? '';
        if (value !== '') {
          flush();
          parts.push({ name, text: value });
          filled = true;
        }
        i = close + 1;
        continue;
      }
      literal += char;
      i += 1;
    }
    flush();
    return { parts, filled };
  };

  return walk(template).parts;
}
