import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { timeChoices } from '../lib/timeChoices';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

/**
 * A time of day, picked from the app's own list rather than typed into the
 * browser's clock widget.
 *
 * The browser's own time input was the last control on the page that looked
 * like the browser rather than the app: segmented hh:mm fields with the OS's
 * own focus highlight, a clock glyph we could only dim or invert, and a popup
 * we could not theme at all — the same reasons every native `<select>` was
 * replaced. This is that replacement for time, on the same `Select`, so it
 * wears the field's border, height, fill and ring and opens the same menu.
 *
 * The list is the day in 5-minute steps (`timeChoices`), which is the only
 * grid the calendar and the server accept anyway — the native field's
 * `step={300}` was advisory and some browsers ignored it. Base UI's Select
 * opens with the current value under the pointer and jumps on typeahead, so
 * "14" lands on 14:00 without scrolling.
 *
 * Value in and out is the `HH:MM` string the old input used, so no caller's
 * state changed shape.
 */
export function TimeSelect({
  value,
  onChange,
  from,
  to,
  step,
  beyond,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The fine-grained window, minutes since midnight, inclusive. */
  from: number;
  to: number;
  step?: number;
  /** Step outside the window, or `null` to offer nothing there. */
  beyond?: number | null;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const choices = useMemo(
    () => timeChoices({ from, to, step, beyond, current: value }),
    [from, to, step, beyond, value],
  );
  return (
    <Select value={value} onValueChange={(v) => v != null && onChange(v)} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className={cn('tabular-nums', className)}>
        <SelectValue>{(v: string | null) => v ?? ''}</SelectValue>
      </SelectTrigger>
      <SelectContent className="tabular-nums">
        {choices.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
