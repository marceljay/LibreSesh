import { describe, expect, it } from 'vitest';
import {
  bestField,
  matchRanges,
  matchesQuery,
  rankSessions,
  scoreSession,
  searchTerms,
  snippet,
} from '../web/src/lib/search.js';

const session = (id: number, title: string, speaker = '', description = '') => ({
  id,
  title,
  speakers: speaker ? [{ name: speaker }] : [],
  description,
});

describe('searchTerms', () => {
  it('splits on whitespace and folds accents away', () => {
    expect(searchTerms('  Ada   José ')).toEqual(['ada', 'jose']);
  });

  it('is empty for a blank query, which means "no search"', () => {
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('matchesQuery', () => {
  const talk = session(1, 'Open Space 101', 'Ada Lovelace', 'How self-organising agendas work.');

  it('matches words in any order, across fields', () => {
    expect(matchesQuery(talk, 'lovelace open')).toBe(true);
  });

  it('requires every term — one miss is a miss', () => {
    expect(matchesQuery(talk, 'open kubernetes')).toBe(false);
  });

  it('ignores accents in either direction', () => {
    expect(matchesQuery(session(2, 'Café culture'), 'cafe')).toBe(true);
    expect(matchesQuery(session(3, 'Cafe culture'), 'café')).toBe(true);
  });

  it('treats a blank query as no filter at all, not as a match', () => {
    expect(matchesQuery(talk, '  ')).toBe(false);
  });
});

describe('scoreSession', () => {
  const terms = searchTerms('space');

  it('ranks a title hit above a speaker hit above a description hit', () => {
    const title = scoreSession(session(1, 'Space rockets'), terms);
    const speaker = scoreSession(session(2, 'Rockets', 'Space Cadet'), terms);
    const description = scoreSession(session(3, 'Rockets', '', 'about space'), terms);
    expect(title).toBeGreaterThan(speaker);
    expect(speaker).toBeGreaterThan(description);
  });

  it('ranks a word start above a hit inside a word', () => {
    expect(scoreSession(session(1, 'Space rockets'), terms)).toBeGreaterThan(
      scoreSession(session(2, 'Aerospace rockets'), terms),
    );
  });
});

describe('rankSessions', () => {
  const sessions = [
    session(1, 'Rockets', '', 'a space elevator, in passing'),
    session(2, 'Open Space clinic', 'Grace Hopper'),
    session(3, 'Space rockets', 'Ada Lovelace'),
  ];

  it('returns the best match first', () => {
    expect(rankSessions(sessions, 'space').map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('keeps the input order between equally good hits', () => {
    const ids = rankSessions(
      [session(7, 'Space one'), session(8, 'Space two')],
      'space',
    ).map((s) => s.id);
    expect(ids).toEqual([7, 8]);
  });

  it('prefers the whole query in one title over two scattered words', () => {
    const ids = rankSessions(
      [
        session(1, 'Open agendas', '', 'we hold space for it'),
        session(2, 'Open Space', 'Ada'),
      ],
      'open space',
    ).map((s) => s.id);
    expect(ids[0]).toBe(2);
  });

  it('caps the list when the caller asks for a top few', () => {
    expect(rankSessions(sessions, 'space', 2)).toHaveLength(2);
  });

  it('finds nothing for a blank query', () => {
    expect(rankSessions(sessions, '  ')).toEqual([]);
  });
});

describe('bestField', () => {
  it('names where the hit came from', () => {
    const talk = session(1, 'Rockets', 'Ada Lovelace', 'about space');
    expect(bestField(talk, searchTerms('rockets'))).toBe('title');
    expect(bestField(talk, searchTerms('lovelace'))).toBe('speaker');
    expect(bestField(talk, searchTerms('space'))).toBe('description');
  });
});

describe('matchRanges', () => {
  it('marks every occurrence, in order', () => {
    expect(matchRanges('Space and space', ['space'])).toEqual([
      [0, 5],
      [10, 15],
    ]);
  });

  it('merges overlapping terms into one range', () => {
    expect(matchRanges('spacecraft', ['space', 'acecraft'])).toEqual([[0, 10]]);
  });

  it('indexes the original text, accents and all', () => {
    const text = 'Café talk';
    expect(matchRanges(text, ['cafe'])).toEqual([[0, 4]]);
    expect(text.slice(0, 4)).toBe('Café');
  });
});

describe('snippet', () => {
  const long = `${'filler words '.repeat(20)}the needle here${' more words'.repeat(20)}`;

  it('leaves a short description alone', () => {
    expect(snippet('Short and sweet.', ['sweet'])).toBe('Short and sweet.');
  });

  it('windows a long description around the match', () => {
    const out = snippet(long, ['needle']);
    expect(out).toContain('needle');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(140);
  });

  it('collapses whitespace so a result stays one line', () => {
    expect(snippet('two\n\nlines   here', ['lines'])).toBe('two lines here');
  });
});
