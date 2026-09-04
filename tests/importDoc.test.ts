import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainJsonError, parseDoc, summarise } from '../web/src/lib/importDoc.js';

/** The template the import docs point at, which the server suite also dry-runs. */
const EXAMPLE = 'docs/examples/schedule-import.example.json';

describe('parsing a pasted schedule', () => {
  it('summarises the example document the docs hand out', () => {
    const result = parseDoc(readFileSync(EXAMPLE, 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.slug).toBe('valley-2026');
    expect(result.summary.sessions).toBeGreaterThan(0);
    expect(result.summary.rooms).toBeGreaterThan(0);
  });

  it('counts a speaker once however it was typed', () => {
    const summary = summarise({
      sessions: [
        { speaker: 'Ada Lovelace' },
        { speaker: 'ada  lovelace' },
        { speaker: ' ADA LOVELACE ' },
        { speaker: 'Grace Hopper' },
        { speaker: '' },
        {},
      ],
    });
    expect(summary.speakers).toBe(2);
  });

  it('reads counts off a document and reports what is absent as absent', () => {
    const summary = summarise({ event: { name: 'Photo Conf' }, rooms: [{}, {}] });
    expect(summary).toMatchObject({
      name: 'Photo Conf',
      slug: null,
      dates: null,
      rooms: 2,
      tracks: 0,
      breaks: 0,
      sessions: 0,
      speakers: 0,
    });
  });

  it('notices an export the app made, and does not mistake a typed document for one', () => {
    expect(summarise({ exportedAt: '2026-09-02T10:00:00.000Z', event: {} }).exportedAt).toBe(
      '2026-09-02T10:00:00.000Z',
    );
    expect(summarise({ event: { name: 'Photo Conf' } }).exportedAt).toBeNull();
  });

  it('gives a date range only when both ends are readable', () => {
    expect(summarise({ event: { startDate: '2026-08-24', endDate: '2026-09-20' } }).dates).toEqual([
      '2026-08-24',
      '2026-09-20',
    ]);
    expect(summarise({ event: { startDate: '2026-08-24' } }).dates).toBeNull();
  });

  it('turns a byte offset into a line and column', () => {
    // A missing comma, which is the mistake a paste actually makes.
    const result = parseDoc('{\n  "name": "Photo Conf"\n  "slug": "photoconf"\n}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/line 3, column 3/);
    // The engine's own words survive: they are the part that says *what*.
    expect(result.error).toMatch(/Expected ',' or '}'/);
  });

  it('keeps the engine’s message when there is no position to translate', () => {
    expect(explainJsonError('{}', new Error('Unexpected end of JSON input'))).toBe(
      'Unexpected end of JSON input',
    );
    const snippet = `Unexpected token '}', ..."rooms": [}" is not valid JSON`;
    expect(explainJsonError('{}', new Error(snippet))).toBe(snippet);
  });

  it('refuses valid JSON that is not a document', () => {
    expect(parseDoc('[1, 2, 3]')).toMatchObject({ ok: false });
    expect(parseDoc('"hello"')).toMatchObject({ ok: false });
    expect(parseDoc('null')).toMatchObject({ ok: false });
    expect(parseDoc('   ')).toMatchObject({ ok: false, error: 'Nothing pasted yet.' });
  });

  // The paste box must not be stricter than the route it feeds: the dry run is
  // the authority on validity, and anything this refused could never reach it.
  it('accepts an object the server would reject, leaving that verdict to the server', () => {
    expect(parseDoc('{"event": {"slug": "no-sessions-and-no-rooms"}}')).toMatchObject({ ok: true });
  });
});
