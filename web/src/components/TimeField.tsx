import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { ChevronDown } from 'lucide-react';
import { fmtMin, minutesOf } from '../lib/format';
import { editTime, segmentAt, segmentSpan, type Span } from '../lib/timeBox';
import { parseTime, timeChoices } from '../lib/timeChoices';
import { ControlShell, TextInput } from './ui';
import { SelectContent, SelectItem } from './ui/select';

const DAY = 24 * 60;
/** The dropdown's grid. Coarser than the 5-minute grid the calendar keeps,
 *  because a list is for the common case and the box is for the rest. */
const LIST_STEP = 15;
/** What an arrow key moves the minutes by: the calendar's own grid. In the
 *  hour segment it moves the hour. */
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
 * picked. So: a text box you type digits into, which settles them onto the
 * five-minute grid when you leave it, and a chevron that opens the
 * quarter-hours for when a glance beats typing. Picking fills the box; typing
 * wins over the list.
 *
 * The box behaves like the segmented widget it replaced, without looking like
 * it: hours and minutes either side of a colon that is typed for you, so
 * `0830` reads `08:30` as it is typed and a phone's numeric keyboard, with no
 * colon key, can type a whole time. A click selects the segment under it, so
 * typing into a time that is already there replaces its hour or its minutes
 * rather than wedging digits into the middle; a finished hour hands the caret
 * to the minutes. Up and Down step whichever segment the caret is in. The
 * model is `editTime` in `lib/timeBox.ts`, where the cases are spelled out.
 *
 * Each keystroke is read after the browser has applied it — what the box
 * showed, what it shows now, where the caret went — and replayed onto the
 * segments, then the caret is put where the model says. Reading the result
 * rather than intercepting the key is what makes it work the same for a
 * keyboard, a phone's, a paste and an autocorrect.
 *
 * The box commits on blur and on Enter, not on every keystroke: committing
 * `1` as `01:00` while someone is halfway through `14:30` would rewrite the
 * box under their fingers. Enter settles the time and then goes on to the
 * form around it, as it does from every other field — the settled value is
 * flushed before the form sees the submit. Something that is not a time reads
 * as invalid while it is in the box and is put back to the last good value on
 * blur, so the field can never hand its caller a value it cannot use.
 *
 * `min`/`max` cap it to the event's day: the list offers only that window,
 * and a typed or nudged time outside it lands on the nearer edge rather than
 * being refused — a person typing `7` on a nine o'clock day meant "as early
 * as it goes", and the server would reject seven anyway. The two fields that
 * *define* the day pass no cap.
 *
 * Value in and out is the `HH:MM` string the old input used, so no caller's
 * state changed shape.
 */
export function TimeField({
  value,
  onChange,
  min = 0,
  max = DAY,
  disabled,
  className = 'w-28',
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Minutes since midnight, inclusive. Defaults to the whole day. */
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(value);
  // Where the caret goes once the text above is in the DOM. A fresh object
  // each edit, so the effect below runs even when the text did not change
  // (an overtyped digit that was already there, a letter that was refused).
  const [caret, setCaret] = useState<Span | null>(null);
  // The list, an arrow key or the caller changed it: show that. Typing is
  // local until it commits, so this never fires mid-word.
  useEffect(() => setText(value), [value]);
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  // The selection as it was before the browser applied the edit now in the
  // box. Read on keydown and, for edits with no key — a paste from a menu, a
  // phone keyboard, autocorrect — on `beforeinput`, which React has no
  // handler for.
  const before = useRef<Span | null>(null);

  useLayoutEffect(() => {
    if (caret) input.current?.setSelectionRange(caret.start, caret.end);
  }, [caret]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const remember = () => {
      before.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
    };
    el.addEventListener('beforeinput', remember);
    return () => el.removeEventListener('beforeinput', remember);
  }, []);

  const invalid = text.trim() !== '' && parseTime(text) === null;
  const choices = timeChoices({
    from: min,
    to: max,
    step: LIST_STEP,
    beyond: null,
    current: value,
  });
  const capped = (minute: number): string =>
    fmtMin(Math.min(Math.min(max, DAY - ARROW_STEP), Math.max(min, minute)));

  const commit = () => {
    const parsed = parseTime(text);
    if (parsed === null) {
      setText(value);
      return;
    }
    const next = capped(minutesOf(parsed));
    setText(next);
    if (next !== value) onChange(next);
  };

  /** Up or Down: the hour if the caret is in the hour, else five minutes.
   *  The segment stays selected, so the next press moves it again. */
  const nudge = (direction: 1 | -1) => {
    const pos = input.current?.selectionStart ?? text.length;
    const segment = segmentAt(text, pos);
    const base = parseTime(text) ?? value;
    const next = capped(minutesOf(base) + direction * (segment === 'hours' ? 60 : ARROW_STEP));
    setText(next);
    setCaret(segmentSpan(next, segment === 'hours' ? 0 : next.length));
    if (next !== value) onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    before.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
    if (e.key === 'Enter') {
      commit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(e.key === 'ArrowUp' ? 1 : -1);
    }
  };

  /** A click lands on a segment and selects it. A drag chose its own. */
  const onMouseUp = (e: MouseEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const span = segmentSpan(el.value, el.selectionStart ?? 0);
    if (span.end > span.start) el.setSelectionRange(span.start, span.end);
  };

  return (
    <div ref={anchor} className={`relative ${className}`}>
      <ControlShell invalid={invalid} disabled={disabled} className="pe-1.5">
        <TextInput
          ref={input}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          inputMode="numeric"
          autoComplete="off"
          placeholder="09:30"
          className="tabular-nums"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const el = e.target;
            const next = editTime(
              text,
              before.current,
              el.value,
              el.selectionStart ?? el.value.length,
            );
            before.current = null;
            setText(next.text);
            setCaret({ start: next.start, end: next.end });
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
          onMouseUp={onMouseUp}
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
