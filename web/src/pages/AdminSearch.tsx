import { useEffect, useMemo, useRef, useState } from 'react';
import { findSettings, tabLabel, type AdminSetting } from '../lib/adminSearch';
import { SearchIcon } from '../components/icons';
import { popoverPanelClass, usePopover } from '../components/Popover';
import { bareFieldFocusRing } from '../components/ui';

/**
 * Find a setting by name, wherever it lives.
 *
 * Manage is seven tabs of unrelated jobs, so knowing what you want to change
 * tells you nothing about where it is — "how long do we keep the log" and "can
 * people pitch" are one click apart on screen and nowhere near each other in
 * anybody's head. This searches the index in `lib/adminSearch.ts` and hands the
 * page a setting to open: it switches tab, scrolls to the field and flashes it,
 * so the answer to "where was that" is the field itself rather than a tab name.
 *
 * Deliberately not a filter over the visible form. Hiding the settings that do
 * not match would answer a different question — "which settings mention this" —
 * and would leave an organiser reading a form with holes in it.
 */
export function AdminSearch({ onPick }: { onPick: (setting: AdminSetting) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => findSettings(query), [query]);
  useEffect(() => setActive(0), [query]);

  const typed = query.trim() !== '';
  const showPanel = open && typed;

  const { refs, floatingStyles, getFloatingProps } = usePopover({
    open: showPanel,
    onOpenChange: setOpen,
    role: 'listbox',
    escapeKey: false,
  });

  const pick = (setting: AdminSetting) => {
    setOpen(false);
    setQuery('');
    input.current?.blur();
    onPick(setting);
  };

  return (
    <div ref={refs.setReference} className="relative w-full sm:ms-auto sm:w-56">
      <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500 dark:text-stone-400" />
      {/* eslint-disable-next-line no-restricted-syntax -- combobox with its own listbox, like the schedule's search box; not a plain text field */}
      <input
        ref={input}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (hits.length === 0) return;
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const hit = hits[active];
            if (hit) pick(hit);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            if (open) setOpen(false);
            else setQuery('');
          }
        }}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="admin-search-results"
        aria-autocomplete="list"
        aria-label="Find a setting"
        placeholder="Find a setting…"
        className={`w-full rounded-lg border border-stone-500 bg-stone-50 py-1.5 ps-8 pe-3 text-xs outline-hidden dark:border-stone-500 dark:bg-stone-950 ${bareFieldFocusRing}`}
      />

      {showPanel && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          id="admin-search-results"
          role="listbox"
          className={`${popoverPanelClass} w-[20rem] p-1`}
        >
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-xs text-stone-500 dark:text-stone-400">
              No setting matches “{query.trim()}”.
            </p>
          ) : (
            <ul>
              {hits.map((setting, i) => (
                <li key={setting.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(setting)}
                    className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-start ${
                      i === active
                        ? 'bg-stone-100 dark:bg-stone-800'
                        : 'hover:bg-stone-50 dark:hover:bg-stone-800/60'
                    }`}
                  >
                    <span className="truncate text-xs font-medium text-stone-900 dark:text-stone-100">
                      {setting.label}
                    </span>
                    {/* Which tab it is on, so picking it is not a surprise —
                        and so the next search for the same thing can skip the
                        box entirely. */}
                    <span className="shrink-0 text-[11px] text-stone-500 dark:text-stone-400">
                      {tabLabel(setting.tab)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
