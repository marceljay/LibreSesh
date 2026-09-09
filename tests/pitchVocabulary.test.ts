import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Propose" and "pitch" are synonyms, and the app used both — a few taps
 * apart — for two genuinely different acts. **Pitch a session** puts an idea
 * on the board with no room and no time, to be placed later if people want
 * it. **Propose a session** was the heading over the ordinary add-a-session
 * form, which puts a real session on the grid at a real room and time.
 *
 * Worse than ambiguous, it was untrue. `canCreateSession` wants
 * `session.create_open` and a room with `openBooking`; with those the session
 * is created outright. Nobody reviews it, nothing queues. The word promised a
 * step the code has never had, and an attendee reading it had every reason to
 * wait for an answer that was never coming.
 *
 * So "pitch" keeps the board — chosen deliberately, and the reason is written
 * beside it in SchedulePage — and "propose" is retired from what a person
 * reads. The route, the `Proposal*` components and the `proposal.create`
 * capability are internal names and a separate decision; they stay for now.
 * LIB-191.
 */
const WEB = join(__dirname, '..', 'web', 'src');
const read = (...p: string[]): string => readFileSync(join(WEB, ...p), 'utf8');

/**
 * Comments out. A note explaining why a word was retired has to be free to
 * name the word, and nobody using the app ever reads it.
 */
const prose = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sessionModal = read('components', 'SessionModal.tsx');
const login = read('components', 'Login.tsx');
const newEvent = read('pages', 'NewEventPage.tsx');
const schedule = read('pages', 'SchedulePage.tsx');

describe('adding a session does not call itself proposing', () => {
  it('heads the form the same way whoever opens it', () => {
    expect(sessionModal).toContain("const heading = session ? 'Edit session' : 'Add session';");
    // The old heading branched on isAdmin. It is the same act either way —
    // only who may do it, and into which rooms, differs.
    expect(prose(sessionModal)).not.toContain('Propose a session');
  });

  it('describes what an attendee adds without the word', () => {
    expect(sessionModal).toContain('What you add lives in a room anyone may book');
    expect(sessionModal).not.toContain('What you propose');
  });
});

describe('the word is gone from everything a person reads', () => {
  const copy: [string, string][] = [
    ['the login role picker', login],
    ['the new-event role labels', newEvent],
    ['the schedule tour', schedule],
    ['the session form', sessionModal],
  ];

  for (const [where, source] of copy) {
    it(`leaves none of it in ${where}`, () => {
      // Only the prose. `proposals`/`ProposalBoard`/`proposal.create` are
      // identifiers and route segments, and are deliberately untouched — the
      // rename behind those is its own decision, with a redirect attached.
      const strings = prose(source).match(/'[^'\n]{12,}'|"[^"\n]{12,}"/g) ?? [];
      const guilty = strings.filter((s) => /\bpropos(e|es|ed|ing)\b/i.test(s));
      expect(guilty).toEqual([]);
    });
  }

  it('still lets somebody search for it, because they will', () => {
    // The admin search index keeps the old word as a keyword on purpose: the
    // point of a keyword is to catch what a person types, not what we renamed.
    expect(read('lib', 'adminSearch.ts')).toContain('propose');
  });
});

describe('pitch still means the board, and only the board', () => {
  it('says pitch where an idea waits to be placed', () => {
    expect(schedule).toContain("title: 'Pitch a session'");
    expect(schedule).toContain('Pitch a session with no room or time');
    expect(read('components', 'ProposalModal.tsx')).toContain("'Pitch a session'");
  });
});
