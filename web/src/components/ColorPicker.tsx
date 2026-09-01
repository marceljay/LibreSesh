/**
 * One way to pick a colour, everywhere a colour is picked.
 *
 * Rooms had a row of round swatches with a native `<input type="color">` on the
 * end; tags and tracks had the bare native input and nothing else. The native
 * control is a rectangle the browser draws to its own taste — a grey-bordered
 * box on one platform, a flat slab on another — and next to a row of round
 * swatches it reads as a different kind of thing entirely, which is the one
 * thing it is not.
 *
 * So the palette is the control, and the custom picker is the last swatch in
 * it: the same size and shape as its neighbours, showing the colour it holds,
 * with a ring around it saying it opens onto everything else. The native input
 * is still there, invisible on top of that swatch — it is what opens the
 * system picker, and no hand-rolled replacement is going to beat it on a phone.
 */
export function ColorPicker({
  value,
  onChange,
  palette,
  label,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The colours offered as one press. The custom swatch sits after them. */
  palette: readonly string[];
  /** Names the group for a screen reader — "Tag colour". */
  label: string;
  hint?: string;
}) {
  const picked = (colour: string): boolean => colour.toLowerCase() === value.toLowerCase();
  const custom = !palette.some(picked);

  return (
    <div role="group" aria-label={label}>
      <div className="flex flex-wrap items-center gap-1.5">
        {palette.map((colour) => (
          <button
            key={colour}
            type="button"
            aria-label={colour}
            aria-pressed={picked(colour)}
            title={colour}
            onClick={() => onChange(colour)}
            style={{ background: colour }}
            className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-white transition-shadow dark:ring-offset-stone-900 ${
              picked(colour)
                ? 'ring-2 ring-stone-900 dark:ring-stone-100'
                : 'ring-1 ring-stone-300 hover:ring-stone-500 dark:ring-stone-600 dark:hover:ring-stone-400'
            }`}
          />
        ))}

        {/* A label, so the whole swatch is the hit area for the input inside
            it. The input is sized over the swatch rather than hidden: a
            `display: none` input is not clickable, and some browsers open the
            picker at the input's own position, which then wanders. */}
        <label
          title="Any other colour"
          className={`relative h-7 w-7 shrink-0 cursor-pointer rounded-full ring-offset-2 ring-offset-white dark:ring-offset-stone-900 ${
            custom
              ? 'ring-2 ring-stone-900 dark:ring-stone-100'
              : 'ring-1 ring-stone-300 hover:ring-stone-500 dark:ring-stone-600 dark:hover:ring-stone-400'
          }`}
          style={{
            // The colour it holds, on a spectrum that says "and anything else".
            background: custom
              ? value
              : 'conic-gradient(#E11D48, #B45309, #4D7C0F, #047857, #0E7490, #2563EB, #7C3AED, #C026D3, #E11D48)',
          }}
        >
          <span className="sr-only">Any other colour</span>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} — any other colour`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        <span className="ml-1 font-mono text-xs uppercase text-stone-400 dark:text-stone-500">
          {value}
        </span>
      </div>
      {hint && (
        <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">{hint}</p>
      )}
    </div>
  );
}
