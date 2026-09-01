import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonDto } from '@shared/types';
import { inputClass } from './ui';

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
}: {
  people: PersonDto[];
  value: SpeakerChoice[];
  onChange: (v: SpeakerChoice[]) => void;
  /** How many names this thing can carry. A pitch names one person — whoever
   *  would give it — so the board passes 1 and the field disappears once it
   *  has that one. Sessions leave it open. */
  max?: number;
}) {
  // null = not searching. The input is always empty otherwise: what has been
  // chosen lives in the chips, not in the field.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  const open = query !== null;
  const nameOf = (choice: SpeakerChoice): string =>
    typeof choice === 'number' ? (people.find((p) => p.id === choice)?.name ?? 'Unknown') : choice;
  const taken = useMemo(
    () => new Set(value.map((c) => (typeof c === 'number' ? String(c) : normalize(c)))),
    [value],
  );

  const matches = useMemo(() => {
    const q = normalize(query ?? '');
    return people.filter(
      (p) => !taken.has(String(p.id)) && !taken.has(normalize(p.name)) && (q === '' || normalize(p.name).includes(q)),
    );
  }, [people, query, taken]);

  // Offer creation only for a name nobody already has, and nobody on the bill.
  const q = normalize(query ?? '');
  const creatable =
    q !== '' && !people.some((p) => normalize(p.name) === q) && !taken.has(q)
      ? (query ?? '').trim().replace(/\s+/g, ' ')
      : null;
  const rowCount = matches.length + (creatable ? 1 : 0);

  useEffect(() => setActive(0), [query]);

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
    // Cleared, not closed: adding a second name is the next thing you do.
    setQuery('');
  };

  return (
    <div className="relative" ref={wrap}>
      {value.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((choice, i) => (
            <li
              key={typeof choice === 'number' ? `p${choice}` : `n${choice}`}
              className="flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-2.5 pr-1 text-xs font-medium dark:bg-stone-800"
            >
              {nameOf(choice)}
              {typeof choice === 'string' && (
                <span className="text-stone-400 dark:text-stone-500">· new</span>
              )}
              <button
                type="button"
                aria-label={`Remove ${nameOf(choice)}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="grid h-4 w-4 place-items-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(max === undefined || value.length < max) && (
      <input
        value={query ?? ''}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setQuery(query ?? '')}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (rowCount > 0)
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + rowCount) % rowCount);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (rowCount > 0) add(active);
          } else if (e.key === 'Backspace' && (query ?? '') === '' && value.length > 0) {
            // The chip-field convention: backspace on an empty field takes the
            // last one off, so a mistyped name is one key away from gone.
            onChange(value.slice(0, -1));
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setQuery(null);
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        maxLength={120}
        placeholder={value.length === 0 ? 'Search people or type a new name' : 'Add another'}
        className={inputClass}
      />
      )}

      {open && rowCount > 0 && (max === undefined || value.length < max) && (
        <ul
          role="listbox"
          className="absolute z-40 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          {matches.map((person, i) => (
            <li key={person.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => add(i)}
                className={`block w-full px-3 py-2 text-left text-xs font-medium text-stone-700 dark:text-stone-200 ${
                  i === active ? 'bg-stone-100 dark:bg-stone-800' : ''
                }`}
              >
                {person.name}
              </button>
            </li>
          ))}
          {creatable && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={active === matches.length}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => add(matches.length)}
                className={`block w-full px-3 py-2 text-left text-xs font-medium text-blue-700 dark:text-blue-400 ${
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
