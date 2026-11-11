import { describe, expect, it } from 'vitest';
import { changeText, describeChange } from '../web/src/lib/auditChanges.js';

/**
 * The server stores a change by its API name and raw value; the page turns
 * each into the words the Settings form uses. Pinned here: the minute fields
 * read as clock times, the zero cap reads as "everything", a permissions row
 * reads as who may, a creation has no "before", and a password has no value.
 */
describe('a change in words', () => {
  it('names a setting by the form’s label and shows both values', () => {
    expect(describeChange('event', { field: 'name', from: 'Old', to: 'New' })).toEqual({
      label: 'Name',
      from: '“Old”',
      to: '“New”',
    });
    expect(changeText('event', { field: 'dayStartMin', from: 480, to: 540 })).toBe(
      'Day starts: 08:00 → 09:00',
    );
    expect(changeText('event', { field: 'auditKeep', from: 1000, to: 0 })).toBe(
      'Audit entries to keep: 1,000 → everything',
    );
    expect(changeText('event', { field: 'pitchesEnabled', from: true, to: false })).toBe(
      'Pitch board: on → off',
    );
    expect(changeText('event', { field: 'defaultView', from: 'list', to: 'cal' })).toBe(
      'Default view: List → Calendar',
    );
  });

  it('a creation has no before; a password has no value', () => {
    expect(describeChange('event', { field: 'name', to: 'First' })).toEqual({
      label: 'Name',
      from: null,
      to: '“First”',
    });
    expect(changeText('event', { field: 'name', to: 'First' })).toBe('Name: “First”');
    expect(describeChange('event', { field: 'adminPassword' })).toEqual({
      label: 'Organiser password',
      from: null,
      to: null,
    });
    expect(changeText('event', { field: 'adminPassword' })).toBe('Organiser password changed');
  });

  it('a permissions change reads as who may, by the capability’s label', () => {
    expect(
      changeText('permissions', { field: 'session.star', from: 'viewer,user,admin', to: 'admin' }),
    ).toBe(
      'Star sessions and build a personal agenda: viewers, attendees, organisers → organisers',
    );
    expect(changeText('permissions', { field: 'proposal.vote', from: 'user', to: '' })).toBe(
      'Register interest in a pitch: attendees → nobody',
    );
  });

  it('falls back to the raw field for one it does not know', () => {
    expect(changeText('event', { field: 'somethingNew', from: 1, to: 2 })).toBe(
      'somethingNew: 1 → 2',
    );
  });
});
