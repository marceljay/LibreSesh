import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A speaker holding a four-word code was told "you are a speaker" and nothing
 * else. The login page used to hide the box that takes it behind "I'm already here
 * on another device" — a sentence about device linking that a speaker on
 * their only device would never click. And a speaker *link* has to sign the
 * device in on arrival, except when that device is already somebody here.
 *
 * No DOM in this suite, so what is pinned is the wording and the shape.
 */
const read = (...parts: string[]) =>
  readFileSync(join(import.meta.dirname, '..', 'web', 'src', ...parts), 'utf8');

const source = read('components', 'Login.tsx');
const hook = read('lib', 'useSpeakerLink.ts');
const schedule = read('pages', 'SchedulePage.tsx');
const profile = read('pages', 'ProfilePage.tsx');

describe('the login page has a door marked speaker', () => {
  it('offers "I have a speaker code" ahead of the device-link door', () => {
    const speaker = source.indexOf('I have a speaker code');
    const device = source.indexOf('I’m already here on another device');
    expect(speaker).toBeGreaterThan(-1);
    expect(device).toBeGreaterThan(-1);
    expect(speaker).toBeLessThan(device);
  });

  it('calls the field what the speaker was sent, and the button what it does', () => {
    expect(source).toContain("linkMode === 'speaker' ? 'Speaker code' : 'Link phrase'");
    expect(source).toContain("'Enter as speaker'");
  });

  it('opens on that form, with the reason, when a speaker link failed', () => {
    expect(source).toContain('speakerLinkFailed?: boolean');
    expect(source).toContain("useState<LinkMode>(speakerLinkFailed ? 'speaker' : 'none')");
    expect(source).toContain('speakerLinkFailed ? SPEAKER_CODE_FAILED : null');
  });

  it('tells a speaker to ask the organiser, not to hurry back to another device', () => {
    // A speaker code never expires; the device-phrase wording would send
    // them looking for a ten-minute clock that does not exist.
    expect(source).toMatch(/SPEAKER_CODE_FAILED =\s*'[^']*Ask your organiser/);
  });
});

describe('a speaker link signs the device in on arrival', () => {
  it('reads the code once, from the scrubbed fragment', () => {
    expect(hook).toContain('useState(() => takeSpeakerLink()?.phrase)');
  });

  it('asks before abandoning a role this device already holds here', () => {
    // The organiser who opens their own link to check it must not be signed
    // out of their event by it.
    expect(hook).toContain("if (me.roles[slug]) setStatus('ask');");
    expect(schedule).toContain("speakerLink.status === 'ask'");
    expect(schedule).toContain('<SpeakerLinkPrompt');
  });

  it('never redeems twice', () => {
    expect(hook).toContain('if (!phrase || started.current) return;');
  });

  it('settles before the login page or the schedule is drawn', () => {
    const settle = schedule.indexOf("speakerLink.status === 'waiting'");
    const loginDraw = schedule.indexOf("data.status === 'login page'");
    expect(settle).toBeGreaterThan(-1);
    expect(settle).toBeLessThan(loginDraw);
    expect(schedule).toContain("speakerLinkFailed={speakerLink.status === 'failed'}");
  });
});

describe('the organiser gets the link where they get the code', () => {
  it('builds it beside the phrase, from the same base as the invite QR', () => {
    expect(profile).toContain('buildSpeakerLinkUrl({ baseUrl: readLinkBase(), slug, phrase })');
    expect(profile).toContain('Copy link');
  });

  it('points the speaker at the door by its name', () => {
    expect(profile).toContain('“I have a speaker code”');
  });
});
