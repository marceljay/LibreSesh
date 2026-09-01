/** Line icons, drawn rather than set as text.
 *
 *  The glyphs these replaced (⤢ U+2922 in particular) are missing from most UI
 *  font stacks, so each browser fell back to whatever it had: different sizes,
 *  different weights, and off the baseline next to their neighbours. Drawing
 *  them keeps one optical size and inherits `currentColor`, so a button's hover
 *  and disabled states carry the icon with them.
 *
 *  All are 16×16 with a 1.6 stroke, sized by the caller through `className`
 *  (default `h-4 w-4`). They are decorative: the accessible name belongs on the
 *  button, as an `aria-label`.
 */

function Icon({ className = 'h-4 w-4', children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Arrows out of two corners — open this in the larger view. */
export function ExpandIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M10 2.5h3.5V6M13.5 2.5 9 7" />
      <path d="M6 13.5H2.5V10M2.5 13.5 7 9" />
    </Icon>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </Icon>
  );
}

/** Open eye — the item is visible, and the button hides it. */
export function HideIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </Icon>
  );
}

/** Struck-through eye — the item is already hidden, and the button restores it. */
export function UnhideIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M6.4 4A6.6 6.6 0 0 1 8 3.8c4 0 6.5 4.2 6.5 4.2a12 12 0 0 1-2.2 2.6" />
      <path d="M3.9 5.3A11.9 11.9 0 0 0 1.5 8s2.5 4.2 6.5 4.2a6.8 6.8 0 0 0 2.2-.36" />
      <path d="M6.75 6.75a1.75 1.75 0 0 0 2.5 2.5" />
      <path d="m2.5 2.5 11 11" />
    </Icon>
  );
}

/** Waste basket — this removes the item for everyone, not just from view. */
export function RemoveIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M2.5 4.5h11M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5" />
      <path d="M4 4.5 4.6 13a.5.5 0 0 0 .5.5h5.8a.5.5 0 0 0 .5-.5l.6-8.5" />
      <path d="M6.75 7v4M9.25 7v4" />
    </Icon>
  );
}

/** Pencil — put this into edit. */
export function EditIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M11.1 2.4a1.4 1.4 0 0 1 2 2L5.6 11.9l-2.7.8.8-2.7 7.4-7.6Z" />
      <path d="M10 3.5 12.5 6" />
    </Icon>
  );
}

/** Magnifier — find a session anywhere in the programme. */
export function SearchIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.4 10.4 3.1 3.1" />
    </Icon>
  );
}

/** Funnel — narrow what the grid is showing. */
export function FilterIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M2.5 3.5h11L9.25 8.4v4.1l-2.5 1.2V8.4L2.5 3.5Z" />
    </Icon>
  );
}

/** Arrow to the right — go on to the full list. */
export function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </Icon>
  );
}

/** A circled "i" — there is more about this than the card has room for. */
export function InfoIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.75" />
      <path d="M8 5.1v.05" />
    </Icon>
  );
}

/** A chevron each way — the rail continues past this edge. */
export function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </Icon>
  );
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Icon>
  );
}
