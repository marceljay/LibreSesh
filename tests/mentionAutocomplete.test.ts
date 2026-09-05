import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMentionQuery, matchMentionNames } from '../server/src/shared/mentions.js';

/**
 * The composer's `@` menu. The pure half — what the caret is inside, and which
 * names that offers — is exercised directly; the component's wiring is pinned
 * as text, because this suite has no DOM (`vitest.config.ts` → `environment:
 * node`).
 *
 * What the assertions are really protecting is the promise that picking from
 * the menu always produces a mention `tokenizeMentions` will read back: the
 * boundary rule is shared with the tokenizer, and the insertion adds the
 * trailing space the tokenizer requires.
 */
describe('findMentionQuery', () => {
  it('finds the @ the caret is typing after', () => {
    expect(findMentionQuery('ask @ad', 7)).toEqual({ start: 4, query: 'ad' });
  });

  it('offers the whole directory on a bare @', () => {
    expect(findMentionQuery('ask @', 5)).toEqual({ start: 4, query: '' });
  });

  it('keeps spaces in the query, because a username may hold them', () => {
    expect(findMentionQuery('@ada love', 9)).toEqual({ start: 0, query: 'ada love' });
  });

  it('ignores an @ mid-word, so typing an email opens nothing', () => {
    expect(findMentionQuery('mail ada@grace', 14)).toBeNull();
  });

  it('takes the nearest @ when there are two', () => {
    expect(findMentionQuery('@ada and @gr', 12)).toEqual({ start: 9, query: 'gr' });
  });

  it('does not look past a newline', () => {
    expect(findMentionQuery('@ada\nnext line', 14)).toBeNull();
  });

  it('does not look further back than a username can be', () => {
    const query = `@${'x'.repeat(41)}`;
    expect(findMentionQuery(query, query.length)).toBeNull();
  });

  it('reads the text before the caret, not the whole field', () => {
    expect(findMentionQuery('@ada lovelace', 3)).toEqual({ start: 0, query: 'ad' });
  });
});

describe('matchMentionNames', () => {
  const names = ['ada', 'Ada Lovelace', 'grace', 'Katherine Johnson'];

  it('lists the directory for an empty query', () => {
    expect(matchMentionNames('', names)).toEqual([
      'ada',
      'Ada Lovelace',
      'grace',
      'Katherine Johnson',
    ]);
  });

  it('matches case-insensitively on a prefix', () => {
    expect(matchMentionNames('AD', names)).toEqual(['ada', 'Ada Lovelace']);
  });

  it('matches a later word, so a surname finds the person', () => {
    expect(matchMentionNames('johnson', names)).toEqual(['Katherine Johnson']);
  });

  it('ranks prefix matches above later-word ones', () => {
    expect(matchMentionNames('ka', names)).toEqual(['Katherine Johnson']);
    // "ada" starts with it; "Katherine" only contains it mid-word.
    expect(matchMentionNames('a', names)).toEqual(['ada', 'Ada Lovelace']);
  });

  it('does not match mid-word, which would make the menu unexplainable', () => {
    expect(matchMentionNames('ohnson', names)).toEqual([]);
  });

  it('keeps matching once a space is typed, so a two-word name is reachable', () => {
    expect(matchMentionNames('ada l', names)).toEqual(['Ada Lovelace']);
  });

  it('offers nothing when the query opens with a space — this closes the menu', () => {
    expect(matchMentionNames(' and then', names)).toEqual([]);
  });

  it('caps the list', () => {
    expect(matchMentionNames('', names, 2)).toHaveLength(2);
  });
});

describe('MentionTextArea wiring', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'web', 'src', 'components', 'MentionTextArea.tsx'),
    'utf8',
  );

  it('derives open from the candidates rather than toggling a flag', () => {
    expect(source).toContain('const open = suggestions.length > 0;');
  });

  it('recomputes the query from the caret on input only', () => {
    expect(source).toMatch(/onChange=\{\(e\) => \{[\s\S]*?findMentionQuery\(el\.value, el\.selectionStart/);
  });

  it('remembers an Escape against the offset of that @, not globally', () => {
    expect(source).toContain('setDismissed(active?.start ?? null);');
    expect(source).toContain('active.start !== dismissed');
    expect(source).toContain('if (!found) setDismissed(null);');
  });

  it('keeps the first Escape for the menu, not the panel around it', () => {
    expect(source).toContain('e.stopPropagation();');
  });

  it('picks with pointer-down so the caret survives the tap', () => {
    expect(source).toMatch(/onPointerDown=\{\(e\) => \{\s*e\.preventDefault\(\);\s*insert\(name\)/);
  });

  it('inserts the directory casing and a boundary the tokenizer can read', () => {
    expect(source).toContain("const inserted = `@${name}${after.startsWith(' ') ? '' : ' '}`;");
  });

  it('restores the caret after the insertion has rendered', () => {
    expect(source).toContain('el.setSelectionRange(caretTo, caretTo);');
  });

  it('clamps the highlight so a shrinking list cannot point past its end', () => {
    expect(source).toContain('const index = Math.min(highlight, suggestions.length - 1);');
  });

  it('anchors the menu to the field, above the composer', () => {
    expect(source).toContain('absolute bottom-full');
    // Nothing measures where the caret rendered — the flaky part of following it.
    expect(source).not.toMatch(/getBoundingClientRect|createRange|scrollHeight/);
  });

  it('wires the combobox so a screen reader follows the highlight', () => {
    expect(source).toContain('role="combobox"');
    expect(source).toContain('aria-activedescendant={open ? `${listId}-${index}` : undefined}');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
  });

  it('offers only people who have a username, since resolution is by username', () => {
    expect(source).toContain("people.map((p) => p.username).filter((u): u is string => u !== null)");
  });
});
