import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeText, foldLine, icsStamp } from '../server/src/ical.js';

describe('escapeText', () => {
  it('escapes the characters RFC 5545 reserves', () => {
    expect(escapeText('Q&A; then lunch')).toBe('Q&A\\; then lunch');
    expect(escapeText('a, b')).toBe('a\\, b');
    expect(escapeText('line\nbreak')).toBe('line\\nbreak');
    expect(escapeText('back\\slash')).toBe('back\\\\slash');
  });

  it('escapes backslashes before the characters they would escape', () => {
    // A literal backslash then a semicolon must not read as one escape sequence.
    expect(escapeText('\\;')).toBe('\\\\\\;');
  });

  it('normalises CRLF and CR to a single escaped break', () => {
    expect(escapeText('a\r\nb')).toBe('a\\nb');
    expect(escapeText('a\rb')).toBe('a\\nb');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeText('Opening keynote')).toBe('Opening keynote');
  });
});

describe('foldLine', () => {
  const octets = (s: string) => new TextEncoder().encode(s).length;

  it('leaves a short line intact', () => {
    expect(foldLine('SUMMARY:Hello')).toBe('SUMMARY:Hello');
  });

  it('keeps every segment inside the 75-octet limit', () => {
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);
    const segments = folded.split('\r\n');
    expect(segments.length).toBeGreaterThan(1);
    expect(octets(segments[0] as string)).toBeLessThanOrEqual(75);
    for (const seg of segments.slice(1)) {
      // The leading space is already part of the segment after splitting.
      expect(octets(seg)).toBeLessThanOrEqual(75);
    }
  });

  it('continues folded lines with a single space', () => {
    const folded = foldLine(`SUMMARY:${'y'.repeat(120)}`);
    expect(
      folded
        .split('\r\n')
        .slice(1)
        .every((l) => l.startsWith(' ')),
    ).toBe(true);
  });

  it('counts octets, not characters, so multi-byte text still fits', () => {
    // 'é' is two octets: 60 of them exceed 75 even though it is 60 characters.
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    for (const seg of folded.split('\r\n')) {
      expect(octets(seg)).toBeLessThanOrEqual(75);
    }
  });

  it('never splits a multi-byte character across segments', () => {
    const folded = foldLine(`X:${'あ'.repeat(80)}`);
    // A split character would decode to a replacement char on re-encode.
    expect(folded).not.toContain('�');
  });
});

describe('icsStamp', () => {
  it('writes a UTC DATE-TIME with no punctuation', () => {
    expect(icsStamp(new Date('2026-06-01T09:30:00.000Z'))).toBe('20260601T093000Z');
  });
});

describe('buildCalendar', () => {
  const base = {
    name: 'DemoConf',
    timezone: 'Europe/Berlin',
    now: new Date('2026-05-01T00:00:00Z'),
  };
  const event = {
    uid: 'session-1@demo.libresesh',
    startsAt: new Date('2026-06-01T08:00:00Z'),
    endsAt: new Date('2026-06-01T09:00:00Z'),
    summary: 'Opening keynote',
  };

  it('wraps events in a well-formed VCALENDAR', () => {
    const ics = buildCalendar({ ...base, events: [event] });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('UID:session-1@demo.libresesh');
    expect(ics).toContain('DTSTART:20260601T080000Z');
    expect(ics).toContain('DTEND:20260601T090000Z');
    expect(ics).toContain('SUMMARY:Opening keynote');
  });

  it('uses CRLF line endings throughout', () => {
    const ics = buildCalendar({ ...base, events: [event] });
    expect(ics.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(true);
  });

  it('omits optional properties that are absent', () => {
    const ics = buildCalendar({ ...base, events: [event] });
    expect(ics).not.toContain('DESCRIPTION:');
    expect(ics).not.toContain('LOCATION:');
    expect(ics).not.toContain('CATEGORIES:');
  });

  it('writes the optional properties when present', () => {
    const ics = buildCalendar({
      ...base,
      events: [
        {
          ...event,
          description: 'Two lines\nof text',
          location: 'Main Hall',
          url: 'https://example.org/s/1',
          categories: ['AI', 'Community'],
        },
      ],
    });
    expect(ics).toContain('DESCRIPTION:Two lines\\nof text');
    expect(ics).toContain('LOCATION:Main Hall');
    expect(ics).toContain('CATEGORIES:AI,Community');
  });

  it('produces a calendar with no events at all', () => {
    const ics = buildCalendar({ ...base, events: [] });
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });
});
