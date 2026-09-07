import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actorWithRole, makeHarness, seedEvent, type Harness } from './helpers.js';

/**
 * A profile used to be read-only until you pressed "Edit profile", which opened
 * a dialog holding every field at once. Two things were wrong with that. An
 * empty profile — the one you land on the first time you open yours, since the
 * menu creates it on the way — showed a name and nothing else: no bio section,
 * no links section, no sign that either existed to be filled. And editing one
 * line meant loading all of them, then saving all of them back.
 *
 * Now each field is read in place and edited in place, and saves alone. That
 * rests on the routes taking a partial body, which is what the first half of
 * this file pins; the second half pins the page that depends on it.
 */
describe('a profile field saves without the rest of the profile', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db, { slug: 'testconf' });
  });
  afterEach(() => harness.close());

  it('leaves the fields it was not given alone', async () => {
    const user = await actorWithRole(harness, 'testconf', 'user-pw');
    await user
      .patch('/api/e/testconf/me/profile')
      .send({
        name: 'Ada',
        bio: 'Builds engines.',
        links: [{ label: 'Site', url: 'https://example.com' }],
      })
      .expect(200);

    // What the Bio field on its own sends.
    const patched = await user
      .patch('/api/e/testconf/me/profile')
      .send({ bio: 'Builds difference engines.' })
      .expect(200);
    expect(patched.body.bio).toBe('Builds difference engines.');
    expect(patched.body.name).toBe('Ada');
    expect(patched.body.links).toEqual([{ label: 'Site', url: 'https://example.com' }]);
  });

  it('empties a field when that is what you meant', async () => {
    const user = await actorWithRole(harness, 'testconf', 'user-pw');
    await user
      .patch('/api/e/testconf/me/profile')
      .send({ bio: 'Placeholder.', links: [{ label: 'Site', url: 'https://example.com' }] })
      .expect(200);

    // Clearing is a save like any other — the field goes back to its empty
    // state on the page rather than silently keeping the old text.
    const cleared = await user.patch('/api/e/testconf/me/profile').send({ bio: '' }).expect(200);
    expect(cleared.body.bio).toBe('');
    expect(cleared.body.links).toHaveLength(1);

    const unlinked = await user.patch('/api/e/testconf/me/profile').send({ links: [] }).expect(200);
    expect(unlinked.body.links).toEqual([]);
  });

  it("lets an organiser save one field of someone else's profile", async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const created = await admin
      .post('/api/e/testconf/people')
      .send({ name: 'Grace', bio: 'Compiles.' })
      .expect(201);
    const patched = await admin
      .patch(`/api/e/testconf/people/${created.body.id}`)
      .send({ bio: 'Compiles, and names the bug.' })
      .expect(200);
    expect(patched.body.name).toBe('Grace');
    expect(patched.body.bio).toBe('Compiles, and names the bug.');
  });
});

const page = readFileSync(join(__dirname, '..', 'web', 'src', 'pages', 'ProfilePage.tsx'), 'utf8');

describe('the profile page edits a field at a time', () => {
  it('has no page-wide edit button or dialog left', () => {
    expect(page).not.toContain('Edit profile');
    expect(page).not.toContain('ProfileEditor');
  });

  it('sends only the field that changed', () => {
    const bodies = [...page.matchAll(/savePerson\(\{\s*([a-zA-Z]+):/g)].map((m) => m[1]);
    expect(bodies.sort()).toEqual(['bio', 'links', 'name']);
    // Three calls, three fields: nothing bundles two of them into one save.
    expect(page.match(/savePerson\(\{/g)).toHaveLength(3);
    expect(page).not.toMatch(/savePerson\(\{\s*name:[\s\S]{0,120}\bbio:/);
  });

  it('keeps the display name out of the profile body', () => {
    // It is your identity in the event, not a column of this profile, and it
    // is the one save that can be refused (names are unique per event).
    expect(page).toContain('api.renameInEvent(slug, wanted)');
    expect(page).not.toMatch(/savePerson\(\{\s*displayName/);
  });

  /**
   * A profile is reached from the schedule and from Manage → People, and
   * those are nothing like each other. Sending an organiser out to the
   * schedule made them navigate back in for every person they looked at.
   */
  it('goes back where it was opened from, and to the schedule otherwise', () => {
    expect(page).toMatch(/useLocation\(\)\.state as \{ back\?: /);
    expect(page).toMatch(/from\?\.to \?\? `\/e\/\$\{slug\}`/);
    expect(page).toMatch(/from\?\.label \?\? 'Schedule'/);
    // A deep link arrives with no history, so an organiser is told the tab.
    expect(page).toContain('Manage → People');

    const admin = readFileSync('web/src/pages/AdminPage.tsx', 'utf8');
    expect(admin).toMatch(/state=\{\{ back: \{ to: `\/e\/\$\{slug\}\/admin\?tab=people`/);
  });

  it('names the two names, and shows the row id nowhere', () => {
    // The heading is the full name a session is credited to; under it the
    // username the room calls them. The row id is in the address bar.
    expect(page).toMatch(/aria-label="Full name"/);
    expect(page).toContain('Username');
    expect(page).not.toContain('rowId');
  });

  it('opens one field at a time', () => {
    expect(page).toMatch(/type FieldKey = /);
    expect(page).toMatch(/useState<FieldKey \| null>\(null\)/);
  });

  it('gives an empty field its own place, with the way to fill it', () => {
    for (const [empty, add] of [
      ['Nothing about you yet.', 'Add a bio'],
      ['No links yet.', 'Add a link'],
    ]) {
      expect(page).toContain(empty);
      expect(page).toContain(add);
    }
    // An empty profile is still a profile: the sections are the page, not
    // something conditional on there being content.
    expect(page).not.toMatch(/\{bioHtml && \(/);
    expect(page).not.toMatch(/\{person\.links\.length > 0 && \(/);
  });

  it('draws nothing for a blank field the reader cannot fill', () => {
    expect(page).toContain('if (!editing && !filled && !canEdit) return null;');
  });

  it('reports a failed save under the field that failed', () => {
    // Not a toast: the message belongs beside the text you still have in hand.
    expect(page).toMatch(/<FormError className="mt-2">\{error\}<\/FormError>/);
    expect(page).toContain('Every link needs both a label and an address.');
  });
});
