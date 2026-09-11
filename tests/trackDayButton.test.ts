import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A track's "day that differs" is a button until pressed. The day picker, the
 * two time boxes and *Add day* used to sit open under every track's hours,
 * as if every track kept a different window somewhere; most never do.
 *
 * Layout and composition, so there is no DOM here: `TrackHoursFields` is
 * private to the admin page, and the per-day rule itself is exercised over
 * HTTP in trackHours.test.ts.
 */
const page = readFileSync(join(__dirname, '..', 'web', 'src', 'pages', 'AdminPage.tsx'), 'utf8');
const fields = page.slice(
  page.indexOf('function TrackHoursFields('),
  page.indexOf('function TrackEditor('),
);

describe('a day that differs', () => {
  it('is a button until pressed', () => {
    expect(fields).toContain('const [adding, setAdding] = useState(false);');
    expect(fields).toContain('{free.length > 0 && !adding && (');
    expect(fields).toContain('+ A day that differs');
    expect(fields).toContain('onClick={() => setAdding(true)}');
  });

  it('opens into the same fields, which are otherwise not rendered', () => {
    expect(fields).toContain('{free.length > 0 && adding && (');
    const open = fields.slice(fields.indexOf('{free.length > 0 && adding && ('));
    expect(open).toContain('<Field label="A day that differs">');
    expect(open).toContain('aria-label="Day"');
    expect(open).toContain('Add day');
  });

  it('folds back once the day is added, or cancelled', () => {
    const addDay = fields.slice(
      fields.indexOf('const addDay = () => {'),
      fields.indexOf('return ('),
    );
    expect(addDay).toContain('onWindows(next);');
    expect(addDay).toContain('setAdding(false);');
    expect(fields).toContain('onClick={() => setAdding(false)}');
    expect(fields).toContain('Cancel');
  });

  it('is still gone once every day has its own row', () => {
    // Nothing to offer, so neither the button nor the fields.
    expect(fields).toContain('const free = days.filter((d) => !taken.has(d));');
    expect(fields.match(/free\.length > 0 &&/g)).toHaveLength(2);
  });
});
