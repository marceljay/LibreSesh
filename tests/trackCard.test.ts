import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A track's column card is one button: press it anywhere and the track's
 * page opens, and it lifts under the pointer to say so. The ⓘ inside it
 * keeps its own job. Layout and composition, so there is no DOM here; the
 * page it opens is mounted for real in routes.test.tsx.
 */
const WEB = join(__dirname, '..', 'web', 'src');
const calendar = readFileSync(join(WEB, 'components', 'Calendar.tsx'), 'utf8');
const schedule = readFileSync(join(WEB, 'pages', 'SchedulePage.tsx'), 'utf8');
const card = calendar.slice(
  calendar.indexOf('function ColumnCard('),
  calendar.indexOf('export interface CalendarProps'),
);

describe('a track column card', () => {
  it('is the link, whole, with a hover to say so', () => {
    // The anchor is the name; its `after` layer covers the card.
    expect(card).toContain("after:absolute after:inset-0 after:rounded-lg after:content-['']");
    expect(card).toContain('hover:shadow-md hover:brightness-95');
    // Only with somewhere to go — a room card is a name and stays flat.
    expect(card).toMatch(/column\.href\s*\?\s*'transition-\[box-shadow,filter\]/);
  });

  it('keeps the ⓘ above that layer, so it still opens its panel', () => {
    const info = card.slice(card.indexOf('aria-label={`About ${column.name}`}'));
    expect(info.slice(0, info.indexOf('>'))).toContain('relative z-10');
    // Not a button inside the anchor: that markup is not allowed.
    expect(card.indexOf('<Link')).toBeLessThan(card.indexOf('{hasInfo && ('));
    expect(card.slice(card.indexOf('<Link'), card.indexOf('</Link>'))).not.toContain('<button');
  });

  it('is the name alone, and says everything else behind the ⓘ', () => {
    expect(calendar).not.toContain('column.detail');
    expect(schedule).toContain('href: `/e/${slug}/t/${track.id}`');
    expect(schedule).toContain('in the programme, every day counted');
    expect(schedule).not.toContain('detail: (');
  });
});
