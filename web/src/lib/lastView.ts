/**
 * The view a reader last chose on an event's schedule, remembered on this
 * device.
 *
 * The view and the axis live in the URL, which is what makes a shared link
 * reproduce them — and it is also why every way back to the schedule lost
 * them: a track's page, a profile, the admin pages and the event bar all
 * link to the bare `/e/:slug`, and a bare URL meant the organiser's default
 * again. Reading the grid, opening a track, coming back, and landing in the
 * list is the schedule forgetting a choice it was just told.
 *
 * So the last explicit choice is kept here and read when the URL says
 * nothing. The URL still wins whenever it speaks, so a shared `?view=cal`
 * opens the grid for a reader who last used the list. Per event, because a
 * one-room unconference and a ten-track festival want different views. Every
 * read and write is guarded: private windows and blocked site data throw on
 * storage, and the schedule must still render when nothing persists.
 */
export interface LastView {
  view?: 'cal' | 'list';
  axis?: 'room' | 'track';
}

const key = (slug: string): string => `libresesh:view:${slug}`;

export function readLastView(slug: string): LastView {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { view, axis } = parsed as Record<string, unknown>;
    return {
      view: view === 'cal' || view === 'list' ? view : undefined,
      axis: axis === 'room' || axis === 'track' ? axis : undefined,
    };
  } catch {
    return {};
  }
}

/** Merge a choice in — a view picked without touching the axis keeps the
 *  axis last picked, and the other way round. */
export function writeLastView(slug: string, patch: LastView): void {
  try {
    const next = { ...readLastView(slug), ...patch };
    localStorage.setItem(key(slug), JSON.stringify(next));
  } catch {
    // Nothing to persist; the choice lasts only for this visit.
  }
}
