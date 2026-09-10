import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A long event navigated in two rows: a rail of week chips, and that week's
 * days scrolling sideways under it. On a phone those two rows were most of
 * the gap between the event bar and the first session, and the second was a
 * hidden-scrollbar scroller — arrows could say the line went on, but not make
 * a day on the far side of a fortnight reachable in fewer than several flicks.
 *
 * Both become one control: `‹ Wed 18 Sep ▾ ›`. The dropdown holds every day
 * grouped under its week; the chevrons step to the neighbour.
 *
 * The chevrons are the load-bearing half. What the strip was genuinely good
 * at is that tomorrow was visible and one tap away, and people move between
 * neighbouring days constantly — a bare dropdown would be worse than what it
 * replaced.
 *
 * Only past `weekRailFrom`. Below it the strip shows the whole event at once
 * and keeps its `Rail` arrows, so nothing changes for the two- and three-day
 * unconferences that are nearly all of them. Desktop keeps both rows.
 *
 * Layout and composition, so there is no DOM here. LIB-192, superseding the
 * phone half of LIB-189.
 */
const WEB = join(__dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB, 'pages', 'SchedulePage.tsx'), 'utf8');
const rail = readFileSync(join(WEB, 'components', 'Rail.tsx'), 'utf8');
const picker = readFileSync(join(WEB, 'components', 'DayPicker.tsx'), 'utf8');

/** The day strip's box, from its tour marker to the view toggle after it. */
const strip = ((): string => {
  const from = schedule.indexOf('data-tour="days"');
  const to = schedule.indexOf('data-tour="view"');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return schedule.slice(from, to);
})();

describe('a long event gets one control for the day on a phone', () => {
  it('shows the picker below sm and only past the threshold', () => {
    expect(schedule).toMatch(/\{longEvent && \(\s*<DayPicker/);
    // A named boolean, not `weeks.length > 1` inline: the plural sweep bans
    // `1 ? 'a' : 'b'`, and the class ternary below would have tripped it.
    expect(schedule).toContain('const longEvent = weeks.length > 1;');
    expect(schedule).toMatch(/<DayPicker\s+className="sm:hidden"/);
  });

  it('hides the strip behind it rather than stacking the two', () => {
    // Past the threshold the strip is desktop-only; under it nothing changes
    // and it renders as it always did.
    expect(strip).toContain("longEvent ? 'hidden sm:flex' : 'flex'");
  });

  it('keeps the week rail on a desktop, where there is room for both rows', () => {
    expect(schedule).toContain('<div className="mx-auto hidden max-w-6xl pb-2 sm:block">');
  });

  it('hands the picker every day, not just this week"s', () => {
    // `stripDays` is one week. The whole point is reaching a day the strip
    // could not show without several flicks.
    expect(schedule).toMatch(/<DayPicker[\s\S]{0,200}?days=\{days\}/);
    expect(schedule).toMatch(/<DayPicker[\s\S]{0,200}?weeks=\{weeks\}/);
  });
});

describe('the chevrons keep the next day one tap away', () => {
  it('steps within the event and stops at both ends', () => {
    expect(picker).toContain('const at = days.indexOf(day);');
    expect(picker).toMatch(/const previous = at > 0 \? \(days\[at - 1\] as string\) : null;/);
    expect(picker).toMatch(/at > -1 && at < days\.length - 1/);
  });

  it('goes flat at an edge rather than disappearing', () => {
    // A control that vanishes moves everything beside it, and on a row this
    // narrow that is the button under the thumb.
    expect(picker).toContain('disabled={to === null}');
    expect(picker).toContain('disabled:pointer-events-none disabled:opacity-30');
  });

  it('names them for a screen reader, which has no chevron to look at', () => {
    expect(picker).toContain("aria-label={side === 'back' ? 'Previous day' : 'Next day'}");
  });
});

describe('the panel carries what the two rows carried', () => {
  it('groups the days under their week', () => {
    expect(picker).toContain('weeks.map((week, i)');
    expect(picker).toContain('<span>Week {i + 1}</span>');
    expect(picker).toContain('dayRangeLabel(week[0] as string, week[week.length - 1] as string)');
  });

  it('heads each week rather than making it a target', () => {
    // Picking a week meant picking its first day, and the days are right
    // there. It survives as the thing that says where you are in a fortnight.
    const heading = picker.slice(picker.indexOf('<span>Week {i + 1}</span>'));
    expect(heading.slice(0, heading.indexOf('week.map'))).not.toContain('onClick');
  });

  it('dims an empty day and marks today, as the strip and the chips did', () => {
    expect(picker).toContain("d !== day && count === 0 ? 'opacity-40' : ''");
    expect(picker).toMatch(/d === today && d !== day &&/);
    expect(picker).toContain('aria-current={d === day');
  });

  it('names the day the way the strip did', () => {
    // `dayLabel` is what turns a date into Today / Tomorrow / a weekday.
    expect(picker).toContain('const label = dayLabel(day, today);');
    expect(picker).toContain('const each = dayLabel(d, today);');
  });
});

describe('nothing changes under the threshold', () => {
  it('leaves the strip its Rail and its arrows', () => {
    expect(strip).toContain('<Rail label="Days"');
    expect(strip).toContain('fade={RAIL_FADE_CARD}');
    expect(rail).toContain("RAIL_FADE_CARD = 'from-white via-white/90");
  });

  it('keeps the border outside the arrows', () => {
    const box = strip.slice(0, strip.indexOf('<Rail'));
    expect(box).toContain('rounded-lg border');
    expect(box).not.toContain('overflow-x-auto');
  });
});
