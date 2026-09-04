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
/** A lightbulb — pitch a session. The board is where an idea goes before it is
 *  a session, so the glyph is the idea rather than the calendar. */
export function PitchIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M8 1.8a4 4 0 0 0-2.4 7.2c.4.3.6.8.6 1.3v.2h3.6v-.2c0-.5.2-1 .6-1.3A4 4 0 0 0 8 1.8Z" />
      <path d="M6.6 12.8h2.8M7.2 14.4h1.6" />
    </Icon>
  );
}

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

/** A cog — the settings behind Manage Event. Eight stubs rather than drawn
 *  teeth: at 16px a real toothed gear silts up into a grey disc, and the stubs
 *  keep the 1.6 stroke the rest of the set is drawn at. */
export function SettingsIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="8" r="3" />
      <path d="M12.5 8H14M8 3.5V2M3.5 8H2M8 12.5V14" />
      <path d="m11.18 4.82 1.06-1.06M4.82 4.82 3.76 3.76M4.82 11.18l-1.06 1.06M11.18 11.18l1.06 1.06" />
    </Icon>
  );
}

/** A chevron down and up — show or hide the rows folded away above. */
export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </Icon>
  );
}

export function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M3.5 10 8 5.5l4.5 4.5" />
    </Icon>
  );
}

/** A month block — the day picker this button puts away and brings back. */
export function CalendarIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.75" />
      <path d="M2.25 6.5h11.5M5.5 2v2.5M10.5 2v2.5" />
    </Icon>
  );
}

/** Three dots stacked — the row's own menu opens from here.
 *
 *  It replaced a "⋯" set as text, which is the same trouble as the glyphs at
 *  the top of this file: the character is a different width and weight in
 *  every fallback font, and it needed a 56-pixel button to look deliberate.
 *  Stacked rather than in a line because the button is now the width of one
 *  glyph, and vertical dots are the shape a table row's menu has everywhere. */
export function MoreIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M8 3.6v.05M8 7.975v.05M8 12.35v.05" />
    </Icon>
  );
}

/** A pane split into columns — which of them the table is showing. */
export function ColumnsIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.75" />
      <path d="M6 3.25v9.5M10 3.25v9.5" />
    </Icon>
  );
}

/** GitHub's Octicat mark, at its own 16×16.
 *
 *  Not one of the `Icon` glyphs above: those are 1.6-stroke line drawings this
 *  app invented and may redraw, and this is somebody else's logo — a filled
 *  shape, reproduced as issued. It takes `currentColor` so it sits in a link
 *  or a button and inherits that element's hover and dark-mode colours, which
 *  is the one liberty the GitHub logo guidelines do allow.
 *
 *  Decorative, like the rest: the accessible name belongs on the link. */
export function GitHubMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
