import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonDto } from '@shared/types';
import { ControlShell, TextInput } from './ui';
import { useListbox } from './useListbox';

/**
 * One name the form will submit: a number for somebody already on the roster,
 * a string for somebody new. Exactly the shape the API's `speakers` takes, so
 * the form hands its list over without translating it.
 */
export type SpeakerChoice = number | string;

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Search-first speaker picker (identity spec, B1), for as many people as are
 * giving the session. Typing filters the roster case- and
 * whitespace-insensitively; creating a person is a deliberate row you pick,
 * never the silent result of free text — that silent default is exactly what
 * bred the "A. Lovelace" / "Ada Lovelace" twins.
 *
 * The chips are in billing order, which is the order they were added: the
 * first name is the one a cramped grid block truncates to. To reorder, remove
 * and add again — a drag handle for a list that is almost always one or two
 * names long would cost more than it is worth.
 */
export function SpeakerCombobox({
  people,
  value,
  onChange,
  max,
  isAdmin = false,
  onlySelf = false,
}: {
  people: PersonDto[];
  value: SpeakerChoice[];
  onChange: (v: SpeakerChoice[]) => void;
  /** How many names this thing can carry. A pitch names one person — whoever
   *  would give it — so the board passes 1 and the field disappears once it
   *  has that one. Sessions leave it open. */
  max?: number;
  /** Organisers may credit anyone. Everyone else sees only the people who
   *  may be credited (`PersonDto.creditable`) — a viewer's person is not on
   *  offer, though a viewer still sees themselves. */
  isAdmin?: boolean;
  /** The matrix has `session.credit_others` off for this role: the field
   *  offers you and nobody else, and no free text. */
  onlySelf?: boolean;
}) {
  // null = not searching. The input is always empty otherwise: what has been
  // chosen lives in the chips, not in the field.
  const [query, setQuery] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const open = query !== null;
  const personOf = (choice: SpeakerChoice): PersonDto | undefined =>
    typeof choice === 'number' ? people.find((p) => p.id === choice) : undefined;
  const nameOf = (choice: SpeakerChoice): string =>
    typeof choice === 'number' ? (personOf(choice)?.name ?? 'Unknown') : choice;
  const taken = useMemo(
    () => new Set(value.map((c) => (typeof c === 'number' ? String(c) : normalize(c)))),
    [value],
  );

  /**
   * Who is on offer: everyone an organiser may credit, otherwise the
   * creditable and yourself. Your own row is pinned first — crediting
   * yourself is the common case at an unconference, and the newcomer this
   * exists for should not have to search for their own name.
   *
   * Archived profiles are not offered, which is most of the point of
   * archiving: the test profiles and the walk-ins who never came back are
   * exactly what clutters this list when you are trying to find a real
   * person. One already on the session stays on it — this filters the
   * suggestions, not the bill — and typing the name in full still finds
   * them, because the server matches an archived profile rather than
   * spawning a twin of it.
   */
  const offered = useMemo(() => {
    const rows = people.filter(
      (p) => p.archivedAt === null && (p.isMine || (!onlySelf && (isAdmin || p.creditable))),
    );
    return [...rows.filter((p) => p.isMine), ...rows.filter((p) => !p.isMine)];
  }, [people, isAdmin, onlySelf]);

  const matches = useMemo(() => {
    const q = normalize(query ?? '');
    return offered.filter(
      (p) =>
        !taken.has(String(p.id)) &&
        !taken.has(normalize(p.name)) &&
        (q === '' || normalize(p.name).includes(q) || (p.username ?? '').toLowerCase().includes(q)),
    );
  }, [offered, query, taken]);

  // Offer creation only for a name nobody already has, and nobody on the bill.
  const q = normalize(query ?? '');
  const creatable =
    !onlySelf && q !== '' && !people.some((p) => normalize(p.name) === q) && !taken.has(q)
      ? (query ?? '').trim().replace(/\s+/g, ' ')
      : null;
  const rowCount = matches.length + (creatable ? 1 : 0);
  const room = max === undefined || value.length < max;

  // A press outside abandons the search; the chips are already committed.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setQuery(null);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const add = (index: number) => {
    if (index < matches.length) {
      const person = matches[index];
      if (person) onChange([...value, person.id]);
    } else if (creatable) {
      onChange([...value, creatable]);
    }
    // Closed, not just cleared. This used to stay open on the theory that
    // adding a second name was the next thing you would do — but almost every
    // session has one host, so for almost everybody the list was hanging open
    // over the rest of the form with nothing left to pick. Adding another is a
    // keystroke away: the input keeps focus, and typing reopens the list.
    setQuery(null);
  };

  const listOpen = open && rowCount > 0 && room;
  const list = useListbox({
    open: listOpen,
    count: rowCount,
    resetOn: query,
    onPick: add,
    onEscape: () => setQuery(null),
  });
  const active = list.active;

  return (
    <div className="relative" ref={wrap}>
      {/*
       * The chosen names sit *inside* the field, not in a row above it: the
       * bordered box is the control, and what you have picked belongs in it —
       * which is the whole reason `ControlShell` is a wrapping flex row rather
       * than a skin on the input. Chips and the input share it, so the box
       * grows to a second line when a session bills several speakers, and a
       * press on the box's own padding focuses the input (ControlShell's job).
       *
       * The box is rendered even at `max`, when the input is gone: a field
       * that vanishes once it is full reads as a bug, and the chips still need
       * somewhere to live.
       */}
      <ControlShell>
        {value.map((choice, i) => (
          <span
            key={typeof choice === 'number' ? `p${choice}` : `n${choice}`}
            className="flex shrink-0 items-center gap-1 rounded-full bg-stone-100 py-1 ps-2.5 pe-1 text-xs font-medium dark:bg-stone-800"
          >
            {nameOf(choice)}
            {typeof choice === 'string' && (
              <span className="text-stone-400 dark:text-stone-500">· new</span>
            )}
            {personOf(choice)?.isMine && (
              <span className="text-stone-400 dark:text-stone-500">· you</span>
            )}
            <button
              type="button"
              aria-label={`Remove ${nameOf(choice)}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="grid h-4 w-4 place-items-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}

        {room && (
        <TextInput
          value={query ?? ''}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setQuery(query ?? '')}
          onKeyDown={(e) => {
            // Closed, Enter is the dialog's: it saves the session. Open, every
            // key below is the list's first.
            if (!open) return;
            if (list.onKeyDown(e)) return;
            if (e.key === 'Backspace' && (query ?? '') === '' && value.length > 0) {
              // The chip-field convention: backspace on an empty field takes the
              // last one off, so a mistyped name is one key away from gone.
              onChange(value.slice(0, -1));
            }
          }}
          {...list.comboboxProps}
          maxLength={120}
          placeholder={
            onlySelf
              ? 'Only you can be credited here'
              : value.length === 0
                ? 'Search people or type a new name'
                : 'Add another'
          }
        />
        )}
      </ControlShell>

      {listOpen && (
        <ul
          {...list.listboxProps}
          className="absolute z-40 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          {matches.map((person, i) => (
            <li key={person.id}>
              <button
                type="button"
                {...list.optionProps(i)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => add(i)}
                className={`flex w-full items-baseline gap-1.5 px-3 py-2 text-start text-xs font-medium text-stone-700 dark:text-stone-200 ${
                  i === active ? 'bg-stone-100 dark:bg-stone-800' : ''
                }`}
              >
                <span className="truncate">{person.name}</span>
                {person.username !== null && person.username !== person.name && (
                  <span className="shrink-0 font-normal text-stone-400 dark:text-stone-500">
                    @{person.username}
                  </span>
                )}
                {person.isMine && (
                  <span className="shrink-0 font-normal text-stone-400 dark:text-stone-500">
                    · you
                  </span>
                )}
              </button>
            </li>
          ))}
          {creatable && (
            <li>
              <button
                type="button"
                {...list.optionProps(matches.length)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => add(matches.length)}
                className={`block w-full px-3 py-2 text-start text-xs font-medium text-blue-700 dark:text-blue-400 ${
                  active === matches.length ? 'bg-stone-100 dark:bg-stone-800' : ''
                }`}
              >
                + Add “{creatable}” as someone new
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
