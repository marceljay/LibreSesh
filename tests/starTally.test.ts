import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A session's star is one fact with two halves — whether it is on your agenda,
 * and how many people put it on theirs — and it was drawn as two things in
 * two places.
 *
 * A list card had a ☆/★ toggle at the top right and a separate "★ 12" at the
 * bottom, so a card showed two stars that were not the same star. A grid block
 * put its star and its count in the row above the title, so a starred session's
 * title sat a line lower than the identical block beside it: the thing every
 * block is read for moved because of something that is not about the session.
 *
 * There is no DOM in this suite, so what is pinned is the shape: one component,
 * one star per surface, and the corner it sits in.
 */
const WEB = join(import.meta.dirname, '..', 'web', 'src', 'components');
const read = (file: string) => readFileSync(join(WEB, file), 'utf8');

const tally = read('StarTally.tsx');
const list = read('ListView.tsx');
const calendar = read('Calendar.tsx');

describe('the star tally', () => {
  it('is one component, drawing one star and one number', () => {
    expect(tally).toContain('export function StarTally');
    // The number only when there is one: "★ 0" is not a fact worth the space.
    expect(tally).toContain('{count > 0 &&');
  });

  it('is hollow only where it is a control nobody has pressed', () => {
    // A count is a filled star whether or not it is yours; the outline is the
    // invitation, and only the interactive tally has one to make.
    expect(tally).toContain("{starred || onToggle === undefined ? '★' : '☆'}");
  });

  it('says which star is yours by colour, and what the room cannot hold', () => {
    expect(tally).toContain('text-amber-500 dark:text-amber-400');
    expect(tally).toContain('text-amber-700 dark:text-amber-400');
  });

  it('does not swallow the tap that opens the session', () => {
    expect(tally).toContain('e.stopPropagation()');
  });
});

describe('the list card', () => {
  it('has one star, and it is the control', () => {
    expect(list.match(/<StarTally/g)).toHaveLength(1);
    expect(list).toContain('onToggle={() => onToggleStar(session)}');
    // The toggle that used to sit beside the title, and the count that
    // repeated it at the bottom of the same card.
    expect(list).not.toContain("{starred ? '★' : '☆'}");
    expect(list).not.toMatch(/<span aria-hidden="true">★<\/span> \{stars\}/);
  });

  it('keeps it in the corner furthest from the title', () => {
    expect(list).toMatch(/ms-auto flex items-center gap-2 text-xs[\s\S]{0,500}<StarTally/);
  });
});

describe('the grid block', () => {
  it('carries the star out of the flow, so the title never moves for it', () => {
    expect(calendar).toMatch(/<StarTally[\s\S]{0,400}absolute bottom-0\.5 end-1/);
  });

  it('no longer puts it in the row above the title', () => {
    const row = calendar.match(/<div className="flex items-center gap-1">[\s\S]*?<\/div>/);
    expect(row).not.toBeNull();
    expect((row as RegExpMatchArray)[0]).not.toContain('★');
    expect((row as RegExpMatchArray)[0]).not.toContain('StarTally');
  });

  /**
   * Starring from the grid used to mean opening the sheet — the block's
   * pointer handling is drag-sensitive, so the corner tally was display-only.
   * Now it is a button when a handler is passed, and it claims the press so a
   * star neither drags the block nor opens it.
   */
  it('lets you star without opening it, and swallows the press that would drag it', () => {
    expect(calendar).toMatch(/<StarTally[\s\S]{0,400}onToggle=\{onToggleStar/);
    // The read-out fallback keeps its pointer-events-none; the button does not.
    expect(calendar).toContain("onToggleStar ? '' : 'pointer-events-none'");
    // StarTally stops the pointer-down itself, which is what a drag starts on.
    expect(tally).toContain('onPointerDown={(e) => e.stopPropagation()}');
  });

  it('rings the open session so the grid says which block the sheet is', () => {
    expect(calendar).toContain('const highlighted = activeId === session.id');
    expect(calendar).toMatch(/highlighted[\s\S]{0,80}ring-2 ring-stone-900/);
  });
});
