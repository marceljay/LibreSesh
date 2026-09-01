import { describe, expect, it } from 'vitest';
import { trackNote, type TrackFactsInput } from '../web/src/lib/tracks.js';

const track = (over: Partial<TrackFactsInput> = {}): TrackFactsInput => ({
  description: '',
  ...over,
});

describe('trackNote', () => {
  it('says nothing when the organiser wrote nothing', () => {
    expect(trackNote(track())).toBe('');
    expect(trackNote(track({ description: '   ' }))).toBe('');
  });

  it('gives the organiser their words back, trimmed', () => {
    expect(trackNote(track({ description: '  Hands-on. Bring a laptop.  ' }))).toBe(
      'Hands-on. Bring a laptop.',
    );
  });

  it('keeps the line breaks the organiser typed', () => {
    // The panel renders with `whitespace-pre-line`, so a paragraph break the
    // organiser typed is a paragraph break the attendee reads.
    expect(trackNote(track({ description: 'Hands-on.\n\nBring a laptop.' }))).toBe(
      'Hands-on.\n\nBring a laptop.',
    );
  });
});
