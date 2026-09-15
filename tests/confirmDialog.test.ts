import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Asking before something irreversible is the app's job, not the browser's.
 * `window.confirm` renders an alert from the browser chrome — unstyled, one
 * line, and it freezes the page while it is up, which on a phone in a hallway
 * is indistinguishable from a hang. It also cannot say the thing that
 * actually matters: where what you are deleting goes, and whether anyone can
 * bring it back.
 */
const WEB = join(import.meta.dirname, '..', 'web', 'src');
const read = (...parts: string[]) => readFileSync(join(WEB, ...parts), 'utf8');

const CALLERS = [
  ['pages', 'SchedulePage.tsx'],
  ['pages', 'AdminPage.tsx'],
  ['components', 'PitchBoard.tsx'],
];

describe('confirming something that cannot be taken back', () => {
  it('never asks through the browser', () => {
    for (const parts of CALLERS) {
      expect(read(...parts), parts.join('/')).not.toContain('window.confirm');
    }
    // The provider may name it, since it explains what it replaced.
    expect(read('components', 'ui.tsx')).toContain('ConfirmProvider');
  });

  it('is mounted once, around the whole app', () => {
    const app = read('App.tsx');
    expect(app).toContain('<ConfirmProvider>');
    expect(app.match(/<ConfirmProvider>/g)).toHaveLength(1);
  });

  /**
   * The two halves of the truth. Sessions are the only thing the bin holds,
   * so they are the only thing allowed to promise a way back; everything else
   * has to say plainly that there is none.
   */
  it('promises the bin only for the thing the bin actually holds', () => {
    const schedule = read('pages', 'SchedulePage.tsx');
    expect(schedule).toMatch(/It moves to the bin[\s\S]{0,120}restore|put it back/);

    const admin = read('pages', 'AdminPage.tsx');
    for (const kind of ['rooms', 'tracks', 'tags']) {
      expect(admin, kind).toContain(`The bin does not hold ${kind}`);
    }
    expect(read('components', 'PitchBoard.tsx')).toContain('the bin does not hold pitches');
  });

  /**
   * Profiles were the fourth of those, and the sentence is gone because the
   * button it warned about is: the People list archives instead, which keeps
   * the sessions and is one click back, so there is no unrepeatable step left
   * to warn anybody about.
   */
  it('no longer has a profile to warn about, because it no longer deletes one', () => {
    const admin = read('pages', 'AdminPage.tsx');
    expect(admin).not.toContain('The bin does not hold profiles');
    expect(admin).not.toContain('api.deletePerson');
  });

  it('does not dress archiving up as a deletion', () => {
    const admin = read('pages', 'AdminPage.tsx');
    expect(admin).toMatch(/confirmLabel: 'Archive'[\s\S]{0,60}danger: false/);
    expect(admin).toContain('Nothing is deleted');
  });
});
