import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react';
import type { PersonDto } from '@shared/types';
import { findMentionQuery, matchMentionNames, type MentionQuery } from '@shared/mentions';
import { TextArea } from './ui';

/** Six fits above a two-row composer without covering the thing being replied
 *  to, and a list longer than that is a directory, not a suggestion. */
const MAX_SUGGESTIONS = 6;

/**
 * A `TextArea` that offers the event's people as you type `@`, and inserts the
 * name it resolved rather than leaving you to spell it — the composer half of
 * `MentionText`, which renders the result.
 *
 * Three choices keep it from being flaky, all of them deliberate:
 *
 * - **The menu is anchored to the field, not the caret.** Following the caret
 *   inside a textarea means mirroring its text into a hidden div to measure
 *   where the caret landed, and that mirror drifts with wrapping, fonts, zoom
 *   and scroll. Slack anchors to the composer for the same reason. Nothing
 *   here measures text.
 * - **Open is derived, never toggled.** Every keystroke recomputes the query
 *   from the caret and the candidates from the query; the menu is open exactly
 *   when there are candidates. So it cannot be left open over stale text, and
 *   typing prose past a stray `@` closes it by running out of matches —
 *   backspacing brings it back with no state to resync. The one piece of
 *   remembered state is an Escape, and it is remembered against the offset of
 *   that `@`, so a different `@` is unaffected.
 * - **Only input opens it.** Moving the caret into an existing `@ada` with a
 *   click or an arrow key does not, because a menu nobody asked for, over text
 *   already written, is the surprise this feature is most likely to be
 *   resented for.
 *
 * What it inserts is the directory's own casing plus a trailing space, which is
 * exactly what `tokenizeMentions` needs to read it back as a mention: the point
 * of picking from a menu is that the mention cannot then fail to resolve.
 */
export function MentionTextArea({
  people,
  value,
  onValueChange,
  ...props
}: {
  /** Everyone in the event; only those with a username can be mentioned. */
  people: PersonDto[];
  value: string;
  onValueChange: (value: string) => void;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [active, setActive] = useState<MentionQuery | null>(null);
  const [highlight, setHighlight] = useState(0);
  /** The offset of an `@` whose menu was dismissed with Escape. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  /** Where to put the caret after an insertion — applied once the new value has
   *  rendered, since setting it before would be overwritten by React. */
  const [caretTo, setCaretTo] = useState<number | null>(null);

  const usernames = useMemo(
    () => people.map((p) => p.username).filter((u): u is string => u !== null),
    [people],
  );
  const suggestions = useMemo(
    () =>
      active && active.start !== dismissed
        ? matchMentionNames(active.query, usernames, MAX_SUGGESTIONS)
        : [],
    [active, dismissed, usernames],
  );
  const open = suggestions.length > 0;
  // The list can shrink under the cursor as the query narrows; clamping here
  // rather than resetting keeps the selection where the eye left it.
  const index = Math.min(highlight, suggestions.length - 1);

  useEffect(() => {
    if (caretTo === null) return;
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(caretTo, caretTo);
    }
    setCaretTo(null);
  }, [caretTo]);

  const personFor = (username: string) =>
    people.find((p) => p.username !== null && p.username.toLowerCase() === username.toLowerCase());

  const insert = (name: string) => {
    if (!active) return;
    const caret = ref.current?.selectionStart ?? active.start + 1 + active.query.length;
    const before = value.slice(0, active.start);
    const after = value.slice(caret);
    // The tokenizer requires a word boundary after the name, and a space is
    // what would be typed next anyway — but don't double one that is there.
    const inserted = `@${name}${after.startsWith(' ') ? '' : ' '}`;
    onValueChange(before + inserted + after);
    setCaretTo(before.length + inserted.length);
    setActive(null);
  };

  return (
    <div className="relative">
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People you can mention"
          className="absolute bottom-full start-0 end-0 z-20 mb-1 max-h-56 overflow-y-auto rounded-lg border border-stone-300 bg-white py-1 shadow-lg dark:border-stone-600 dark:bg-stone-900"
        >
          {suggestions.map((name, i) => {
            const person = personFor(name);
            return (
              <li key={name}>
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === index}
                  // Pointer-down, not click: a click would blur the textarea
                  // first, taking the caret with it. Preventing the default
                  // keeps focus and the selection exactly where they were.
                  onPointerDown={(e) => {
                    e.preventDefault();
                    insert(name);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  ref={i === index ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-start text-sm ${
                    i === index ? 'bg-stone-100 dark:bg-stone-800' : ''
                  }`}
                >
                  <span className="font-medium text-stone-900 dark:text-stone-100">@{name}</span>
                  {person && person.name !== name && (
                    <span className="truncate text-xs text-stone-500 dark:text-stone-400">
                      {person.name}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <TextArea
        {...props}
        ref={ref}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${index}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          const el = e.currentTarget;
          onValueChange(el.value);
          const found = findMentionQuery(el.value, el.selectionStart ?? el.value.length);
          setActive(found);
          // Leaving the mention forgets the Escape, so the same `@` typed
          // afresh is offered again.
          if (!found) setDismissed(null);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          props.onKeyDown?.(e);
          if (!open || e.defaultPrevented) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((index + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((index - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            insert(suggestions[index]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            // Stop the dialog or panel around the composer closing too: the
            // first Escape belongs to the menu.
            e.stopPropagation();
            setDismissed(active?.start ?? null);
          }
        }}
        onBlur={(e) => {
          props.onBlur?.(e);
          setActive(null);
        }}
      />
    </div>
  );
}
