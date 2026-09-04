import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type {
  ContributionDto,
  ContributionKind,
  Me,
  PersonDto,
  RoomDto,
  Role,
  SessionDto,
  FormatDto,
  TagDto,
} from '@shared/types';
import { CloseIcon, ExpandIcon } from './icons';
import { COLLAPSED_COUNT, SessionDetail } from './SessionDetail';

export interface DetailSheetProps {
  session: SessionDto;
  slug: string;
  rooms: RoomDto[];
  tags: TagDto[];
  formats: FormatDto[];
  people: PersonDto[];
  contributions: ContributionDto[] | undefined;
  role: Role;
  me: Me | null;
  timezone: string;
  canEdit: boolean;
  canDelete: boolean;
  archived: boolean;
  /** Whether this session is on the current identity's personal agenda. */
  starred: boolean;
  /** The event's word for the middle role, used in the upgrade prompt. */
  userLabel: string;
  /** Where the expand control goes — the same session's full-page route. */
  expandTo: string;
  onClose: () => void;
  onToggleStar: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAdd: (kind: ContributionKind, body: string, url?: string) => Promise<void>;
  onRemoveContribution: (id: number) => void;
  onToggleHidden: (contribution: ContributionDto) => void;
}

/** Both header controls share one 36px square target — big enough to hit on a
 *  touch screen, and equal so the pair reads as a pair. */
const headerButtonClass =
  'grid h-9 w-9 place-items-center rounded-full text-stone-400 dark:text-stone-500 ' +
  'hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300';

/** Bottom sheet on mobile, side panel from `sm` up (SPEC §7.4). The panel is
 *  chrome only: everything inside it is `SessionDetail`, shared with the
 *  full-page route so the two cannot drift apart. */
export function DetailSheet({
  session,
  expandTo,
  onClose,
  ...rest
}: DetailSheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={session.title}>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default bg-stone-900/30 dark:bg-black/60"
        onClick={onClose}
      />
      {/* `dvh`, not `vh`: `vh` measures the viewport with the mobile address
          bar hidden, so `85vh` made the sheet taller than the `fixed inset-0`
          parent it is bottom-anchored in, and the top of a long session — its
          title — was clipped where no amount of scrolling reached it.

          Width climbs with the viewport rather than sitting at one desktop
          size: the panel holds a description, three lists of contributions and
          a composer, and at `sm:w-96` on a wide screen every one of them
          wrapped early while the grid behind it had room to spare. */}
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-5 shadow-xl sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[26rem] sm:rounded-2xl lg:w-[32rem] lg:p-6 xl:w-[36rem]">
        <SessionDetail
          {...rest}
          session={session}
          layout="sheet"
          collapseAt={COLLAPSED_COUNT}
          headerActions={
            <div className="flex shrink-0 items-center gap-1">
              <Link to={expandTo} aria-label="Open this session as a full page" title="Open as a full page" className={headerButtonClass}>
                <ExpandIcon />
              </Link>
              <button type="button" onClick={onClose} aria-label="Close" className={headerButtonClass}>
                <CloseIcon />
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}
