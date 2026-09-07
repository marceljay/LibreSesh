import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A speaker holding a four-word code was told "you are a speaker" and nothing
 * else. The gate used to hide the box that takes it behind "I'm already here
 * on another device" — a sentence about device linking that a speaker on
 * their only device would never click.
 *
 * No DOM in this suite, so what is pinned is the wording and the shape.
 */
const read = (...parts: string[]) =>
  readFileSync(join(import.meta.dirname, '..', 'web', 'src', ...parts), 'utf8');

const gate = read('components', 'Gate.tsx');

describe('the gate has a door marked speaker', () => {
  it('offers "I have a speaker code" ahead of the device-link door', () => {
    const speaker = gate.indexOf('I have a speaker code');
    const device = gate.indexOf('I’m already here on another device');
    expect(speaker).toBeGreaterThan(-1);
    expect(device).toBeGreaterThan(-1);
    expect(speaker).toBeLessThan(device);
  });

  it('calls the field what the speaker was sent, and the button what it does', () => {
    expect(gate).toContain("linkMode === 'speaker' ? 'Speaker code' : 'Link phrase'");
    expect(gate).toContain("'Enter as speaker'");
  });

  it('tells a speaker to ask the organiser, not to hurry back to another device', () => {
    // A speaker code never expires; the device-phrase wording would send
    // them looking for a ten-minute clock that does not exist.
    expect(gate).toMatch(/SPEAKER_CODE_FAILED =\s*'[^']*Ask your organiser/);
  });
});
