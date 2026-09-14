import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  explainJsonError,
  parseDoc,
  partsIn,
  summarise,
  withOverrides,
  withParts,
} from '../web/src/lib/importDoc.js';

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

  it('replaces the address, name and dates only when one is given', () => {
    const doc = { event: { name: 'Photo Conf', slug: 'photoconf' }, rooms: [] };
    expect(withOverrides(doc, {})).toBe(doc);
    expect(withOverrides(doc, { slug: '', name: '   ' })).toBe(doc);
    expect(withOverrides(doc, { slug: ' photoconf-2 ' })).toEqual({
      event: { name: 'Photo Conf', slug: 'photoconf-2' },
      rooms: [],
    });
    // Running the event again: the same frame with next year's name and dates.
    expect(
      withOverrides(doc, {
        name: 'Photo Conf 2027',
        startDate: '2027-06-01',
        endDate: '2027-06-02',
      }),
    ).toEqual({
      event: {
        name: 'Photo Conf 2027',
        slug: 'photoconf',
        startDate: '2027-06-01',
        endDate: '2027-06-02',
      },
      rooms: [],
    });
    // A document with no `event` at all still gets one, so the server's
    // message is about the fields it lacks rather than about the slug.
    expect(withOverrides({}, { slug: 'x' })).toEqual({ event: { slug: 'x' } });
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

  it('lists the parts a document carries, in either spelling', () => {
    const typed = {
      event: { name: 'Photo Conf', slug: 'photoconf', dayStartMin: 540 },
      rooms: [{ name: 'Hall' }],
      tags: [],
      sessions: [{ room: 'Hall', title: 'Talk', track: 'Design', tags: ['x'] }],
    };
    expect(partsIn(typed)).toEqual(['settings', 'rooms', 'sessions']);
    const exported = {
      exportedAt: '2026-09-14T00:00:00.000Z',
      event: { name: 'Old', slug: 'old' },
      permissions: { 'session.star': ['admin'] },
      rooms: [{ id: 1, name: 'Hall' }],
      tracks: [{ id: 2, name: 'Design' }],
      breaks: [{ startMin: 720, endMin: 780 }],
      people: [{ id: 9, name: 'Ada' }],
    };
    expect(partsIn(exported)).toEqual(['permissions', 'rooms', 'tracks', 'breaks']);
    expect(partsIn({})).toEqual([]);
  });

  it('takes parts out, and with them every reference to them', () => {
    const typed = {
      event: { name: 'Photo Conf', slug: 'photoconf', dayStartMin: 540, adminPassword: 'kept' },
      permissions: { 'session.star': ['admin'] },
      rooms: [{ name: 'Hall' }],
      tracks: [{ name: 'Design' }],
      tags: [{ name: 'x' }],
      formats: [{ name: 'Talk' }],
      sessions: [{ room: 'Hall', title: 'Talk', track: 'Design', tags: ['x'], format: 'Talk' }],
    };
    expect(withParts(typed, new Set())).toBe(typed);
    expect(
      withParts(typed, new Set(['settings', 'permissions', 'tracks', 'tags'] as const)),
    ).toEqual({
      event: { name: 'Photo Conf', slug: 'photoconf', adminPassword: 'kept' },
      rooms: [{ name: 'Hall' }],
      formats: [{ name: 'Talk' }],
      sessions: [{ room: 'Hall', title: 'Talk', format: 'Talk' }],
    });
    // An export numbers what a typed document names; both spellings go.
    const exported = {
      event: { name: 'Old', slug: 'old' },
      rooms: [{ id: 1, name: 'Hall' }],
      formats: [{ id: 3, name: 'Talk' }],
      sessions: [{ roomId: 1, title: 'Talk', trackId: 2, tagIds: [4], formatId: 3 }],
    };
    expect(withParts(exported, new Set(['formats'] as const))).toEqual({
      event: { name: 'Old', slug: 'old' },
      rooms: [{ id: 1, name: 'Hall' }],
      sessions: [{ roomId: 1, title: 'Talk', trackId: 2, tagIds: [4] }],
    });
    // Sessions are placed in rooms: no rooms, no sessions.
    expect(withParts(exported, new Set(['rooms'] as const))).toEqual({
      event: { name: 'Old', slug: 'old' },
      formats: [{ id: 3, name: 'Talk' }],
    });
  });
});
