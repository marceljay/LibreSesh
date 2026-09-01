import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { PrimaryButton, SecondaryButton } from './ui';

/** One coach-mark: `target` is a `data-tour` id somewhere in the page. */
export interface TourStep {
  target: string;
  title: string;
  body: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const selectorFor = (id: string): string => `[data-tour="${id}"]`;

interface Placement {
  top: number;
  left: number;
  width: number;
}

export function Tour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  onClose: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  // Freeze the step list to those actually on screen now, so a role-conditional
  // control that isn't rendered never becomes a dead step.
  const [resolved] = useState(() =>
    steps.filter((s) => document.querySelector(selectorFor(s.target))),
  );
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // Nothing is remembered about having taken it: the tour is asked for now, so
  // the next press of "?" should give you the same tour again.
  const finish = useCallback(() => {
    onClose();
  }, [onClose]);

  /** Nearest step in `dir` from `from` whose target is currently in the DOM. */
  const resolveFrom = useCallback(
    (from: number, dir: 1 | -1): number => {
      for (let i = from; i >= 0 && i < resolved.length; i += dir) {
        if (document.querySelector(selectorFor(resolved[i].target))) return i;
      }
      return -1;
    },
    [resolved],
  );

  const next = useCallback(() => {
    const n = resolveFrom(index + 1, 1);
    if (n === -1) finish();
    else setIndex(n);
  }, [resolveFrom, index, finish]);

  const back = useCallback(() => {
    const p = resolveFrom(index - 1, -1);
    if (p !== -1) setIndex(p);
  }, [resolveFrom, index]);

  // Return focus to whatever was focused when the tour opened.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  // Bring the current target into view, measure it, and keep the measurement
  // fresh while the page scrolls or resizes underneath.
  useEffect(() => {
    const step = resolved[index];
    if (!step) {
      finish();
      return;
    }
    const selector = selectorFor(step.target);
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) {
      const n = resolveFrom(index + 1, 1);
      if (n === -1) finish();
      else setIndex(n);
      return;
    }
    el.scrollIntoView({ block: 'center', inline: 'nearest' });

    const measure = () => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) {
        const n = resolveFrom(index + 1, 1);
        if (n === -1) finish();
        else setIndex(n);
        return;
      }
      setRect(node.getBoundingClientRect());
    };

    const raf = requestAnimationFrame(() => {
      measure();
      cardRef.current?.focus();
    });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [index, resolved, finish, resolveFrom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        finish();
        return;
      }
      const onButton = e.target instanceof HTMLButtonElement;
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, next, back]);

  // Place the card below the target, or above when it would overflow, and clamp
  // it inside the viewport. On a narrow screen it spans the width with a margin.
  useLayoutEffect(() => {
    if (!rect) return;
    const margin = 12;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const narrow = vw < 420;
    const width = narrow ? vw - margin * 2 : Math.min(320, vw - margin * 2);
    const height = cardRef.current?.offsetHeight ?? 200;
    const below = rect.bottom + gap;
    const top =
      below + height <= vh - margin ? below : Math.max(margin, rect.top - gap - height);
    const left = narrow
      ? margin
      : clamp(rect.left + rect.width / 2 - width / 2, margin, vw - width - margin);
    setPlacement({ top, left, width });
  }, [rect]);

  const step = resolved[index];
  if (!step) return null;
  const isLast = resolveFrom(index + 1, 1) === -1;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      {rect && (
        <>
          {/* Four overlay panels around the target rather than an SVG mask —
              simpler, and the target still looks live. */}
          <div
            className="pointer-events-auto absolute bg-stone-900/50 dark:bg-black/70"
            style={{ left: 0, top: 0, width: '100%', height: Math.max(0, rect.top) }}
          />
          <div
            className="pointer-events-auto absolute bg-stone-900/50 dark:bg-black/70"
            style={{ left: 0, top: rect.bottom, width: '100%', bottom: 0 }}
          />
          <div
            className="pointer-events-auto absolute bg-stone-900/50 dark:bg-black/70"
            style={{ left: 0, top: rect.top, width: Math.max(0, rect.left), height: rect.height }}
          />
          <div
            className="pointer-events-auto absolute bg-stone-900/50 dark:bg-black/70"
            style={{ left: rect.right, top: rect.top, right: 0, height: rect.height }}
          />
          <div
            className="pointer-events-none absolute rounded-lg ring-2 ring-white"
            style={{
              left: rect.left - 4,
              top: rect.top - 4,
              width: rect.width + 8,
              height: rect.height + 8,
            }}
          />
        </>
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="pointer-events-auto fixed rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-4 shadow-lg outline-none"
        style={
          placement
            ? { top: placement.top, left: placement.left, width: placement.width }
            : { top: 0, left: 0, opacity: 0 }
        }
      >
        <div id={titleId} className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          {step.title}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-stone-300">{step.body}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="text-xs font-medium text-stone-500 dark:text-stone-400 underline hover:text-stone-800 dark:hover:text-stone-200"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-400 dark:text-stone-500">
              Step {index + 1} of {resolved.length}
            </span>
            {index > 0 && <SecondaryButton onClick={back}>Back</SecondaryButton>}
            <PrimaryButton onClick={next}>{isLast ? 'Done' : 'Next'}</PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
