import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The comment box's button said "Post as" and then `Me.displayName` — the
 * seed the instance offers a newcomer, which follows the last name typed at
 * any gate on this instance. Enter another event as "admin" and this one said
 * "Post as admin", whatever you are called here (reported 2026-09-08). A name
 * belongs to (event, identity): inside an event the one that counts is
 * `BundleDto.displayName`, and that is what the button names now.
 */
const read = (...p: string[]) => readFileSync(join(__dirname, '..', 'web', 'src', ...p), 'utf8');

describe('the comment box posts as who you are in this event', () => {
  it('names the event display name, never the instance seed', () => {
    const detail = read('components', 'SessionDetail.tsx');
    expect(detail).toContain("Post as {displayName || 'you'}");
    expect(detail).not.toContain('me?.displayName');
    expect(detail).not.toContain('me.displayName');
  });

  it('is handed the bundle name by both the panel and the full page', () => {
    const page = read('pages', 'SchedulePage.tsx');
    expect(page.match(/displayName=\{bundle\.displayName\}/g)?.length).toBeGreaterThanOrEqual(4);
    const sheet = read('components', 'DetailSheet.tsx');
    expect(sheet).toContain('displayName: string;');
  });
});
