import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TAG_COLORS } from '../server/src/shared/tagColors.js';
import { actorWithRole, makeHarness, seedEvent, type Harness } from './helpers.js';

/**
 * Every tag used to start life the same grey, so an event's tags were told
 * apart by reading them — which is most of what a colour on a chip is for. A
 * new tag now takes the first colour no live tag is wearing, the way a room and
 * a track already did.
 *
 * The palette is bright where `ROOM_COLORS` is washed out, and deliberately: a
 * room colour is a column that text sits on all day, a tag is a chip a few
 * characters wide that has to be picked out at a glance.
 */
describe('a new tag takes a colour nobody is using', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db, { slug: 'testconf' });
  });
  afterEach(() => harness.close());

  it('assigns from the palette rather than defaulting to grey', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const first = await admin.post('/api/e/testconf/tags').send({ name: 'beginner' }).expect(201);
    expect(first.body.color).toBe(TAG_COLORS[0]);
    expect(first.body.color).not.toBe('#6B7280');
  });

  it('gives the next tag a different one', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const names = ['one', 'two', 'three'];
    const colors: string[] = [];
    for (const name of names) {
      const res = await admin.post('/api/e/testconf/tags').send({ name }).expect(201);
      colors.push(res.body.color as string);
    }
    expect(new Set(colors).size).toBe(names.length);
    expect(colors).toEqual([TAG_COLORS[0], TAG_COLORS[1], TAG_COLORS[2]]);
  });

  it('still takes a colour that was asked for', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const res = await admin
      .post('/api/e/testconf/tags')
      .send({ name: 'chosen', color: '#123456' })
      .expect(201);
    expect(res.body.color).toBe('#123456');
  });

  it('offers colours a white label can be read on', () => {
    // Tags are drawn everywhere as a filled pill with the name in white on it,
    // so a colour that cannot carry white text is not a tag colour however
    // bright it looks in the picker. 4.5:1 is the small-text threshold.
    for (const colour of TAG_COLORS) {
      expect(contrastWithWhite(colour)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/** WCAG relative luminance, then the contrast ratio against pure white. */
function contrastWithWhite(hex: string): number {
  const channel = (pair: string): number => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l =
    0.2126 * channel(hex.slice(1, 3)) +
    0.7152 * channel(hex.slice(3, 5)) +
    0.0722 * channel(hex.slice(5, 7));
  return 1.05 / (l + 0.05);
}

/**
 * The native `<input type="color">` is a rectangle the browser draws to its own
 * taste, and next to a row of round swatches it reads as a different kind of
 * thing entirely. There is one picker now, and the native input survives only
 * inside it — invisible, over the last swatch, because nothing hand-rolled
 * beats the system picker on a phone.
 */
describe('one colour picker, everywhere', () => {
  const WEB_SRC = join(__dirname, '..', 'web', 'src');

  function tsxFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return tsxFiles(path);
      return e.name.endsWith('.tsx') ? [path] : [];
    });
  }

  it('leaves no bare native colour input anywhere else', () => {
    const strays = tsxFiles(WEB_SRC)
      .filter((path) => !path.endsWith(join('components', 'ColorPicker.tsx')))
      .filter((path) => readFileSync(path, 'utf8').includes('type="color"'))
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(strays).toEqual([]);
  });

  it('is used by tags, tracks and rooms alike', () => {
    const admin = readFileSync(join(WEB_SRC, 'pages', 'AdminPage.tsx'), 'utf8');
    const rooms = readFileSync(join(WEB_SRC, 'pages', 'AdminRooms.tsx'), 'utf8');
    expect(admin).toContain('palette={TAG_COLORS}');
    expect(admin).toContain('palette={ROOM_COLORS}');
    expect(rooms).toContain('palette={ROOM_COLORS}');
  });

  it('shows the tag colour the server would pick anyway', () => {
    const admin = readFileSync(join(WEB_SRC, 'pages', 'AdminPage.tsx'), 'utf8');
    // `null` state, resolved against the live tags — so the swatch follows the
    // event until someone picks on purpose, and follows it again afterwards.
    expect(admin).toContain('const newTagColor = tagColor ?? suggestedTagColor;');
    expect(admin).toMatch(/nextTagColor\(\(bundle\?\.tags \?\? \[\]\)\.map\(\(t\) => t\.color\)\)/);
    expect(admin).toContain('setTagColor(null);');
  });
});
