import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { ChevronDown } from 'lucide-react';
import { fmtMin, minutesOf } from '../lib/format';
import { parseTime, timeChoices } from '../lib/timeChoices';
import { ControlShell, TextInput } from './ui';
import { SelectContent, SelectItem } from './ui/select';

const DAY = 24 * 60;
/** The dropdown's grid. Coarser than the 5-minute grid the calendar keeps,
 *  because a list is for the common case and the box is for the rest. */
const LIST_STEP = 15;
/** What an arrow key moves the box by: the calendar's own grid. */
const ARROW_STEP = 5;

/**
 * A time of day: a box you type into, with the app's own list beside it.
 *
 * The browser's time input was the last control on the page that looked like
 * the browser rather than the app — segmented digits with the OS's focus
 * highlight, a clock glyph we could only dim or invert, a popup we could not
 * theme — the same reasons every native `<select>` was replaced. But a list
 * alone was the wrong replacement: 288 rows of five-minute steps is a long
 * way to scroll for 09:35, and most times are typed faster than they are
 * picked. So: a text box that takes `9`, `930`, `9:30`, `9.30` or `2pm` and
 * settles it onto the five-minute grid when you leave it, and a chevron that
 * opens the quarter-hours for when a glance beats typing. Picking fills the
 * box; typing wins over the list.
 *
 * The box commits on blur and on Enter, not on every keystroke: committing
 * `1` as `01:00` while someone is halfway through `14:30` would rewrite the
 * box under their fingers. Enter is swallowed so the dialog around it does
 * not save on the same press that settled the time — the second Enter does.
 * Something that is not a time reads as invalid while it is in the box and is
 * put back to the last good value on blur, so the field can never hand its
 * caller a value it cannot use.
 *
 * Value in and out is the `HH:MM` string the old input used, so no caller's
 * state changed shape.
 */
export function TimeField({
  value,
  onChange,
  disabled,
  className = 'w-28',
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(value);
  // The list, an arrow key or the caller changed it: show that. Typing is
  // local until it commits, so this never fires mid-word.
  useEffect(() => setText(value), [value]);
  const anchor = useRef<HTMLDivElement>(null);

  const invalid = text.trim() !== '' && parseTime(text) === null;
  const choices = timeChoices({ from: 0, to: DAY, step: LIST_STEP, beyond: null, current: value });

  const commit = () => {
    const parsed = parseTime(text);
    if (parsed === null) {
      setText(value);
      return;
    }
    setText(parsed);
    if (parsed !== value) onChange(parsed);
  };

  const nudge = (delta: number) => {
    const base = parseTime(text) ?? value;
    const next = Math.min(DAY - ARROW_STEP, Math.max(0, minutesOf(base) + delta));
    onChange(fmtMin(next));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(e.key === 'ArrowUp' ? ARROW_STEP : -ARROW_STEP);
    }
  };

  return (
    <div ref={anchor} className={`relative ${className}`}>
      <ControlShell invalid={invalid} disabled={disabled} className="pe-1.5">
        <TextInput
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          inputMode="numeric"
          autoComplete="off"
          placeholder="09:30"
          className="tabular-nums"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        <BaseSelect.Root
          value={value}
          onValueChange={(v) => {
            if (v != null) onChange(v);
          }}
          disabled={disabled}
        >
          <BaseSelect.Trigger
            aria-label={ariaLabel ? `Pick a time for ${ariaLabel}` : 'Pick a time'}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-stone-500 outline-hidden hover:bg-stone-200 hover:text-stone-700 focus-visible:ring-2 focus-visible:ring-stone-500 disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 dark:focus-visible:ring-stone-400"
          >
            <ChevronDown className="h-4 w-4" />
          </BaseSelect.Trigger>
          {/* Anchored to the whole field and dropped below it, like a menu,
              rather than centred on the chevron with the current row over it
              (Base UI's default, which is right for a select and wrong for a
              list beside a box). */}
          <SelectContent anchor={anchor} alignItemWithTrigger={false} className="tabular-nums">
            {choices.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </BaseSelect.Root>
      </ControlShell>
    </div>
  );
}
