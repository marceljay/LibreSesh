import type { TourStep } from '../components/Tour';

/**
 * The schedule's coach-marks, in the order the tour walks them.
 *
 * Controls a role does not have are left out here; the Tour itself also skips
 * any target that is not in the DOM.
 */
export function scheduleTourSteps({
  participant,
  longEvent,
  hasTracks,
  canAdd,
  canArrange,
  isAdmin,
}: {
  /** What this event calls somebody signed in with the participant password. */
  participant: string;
  /** More than one week, so the week rail is on screen. */
  longEvent: boolean;
  hasTracks: boolean;
  /** The add button is there: the viewer may book a room, or pitches are on. */
  canAdd: boolean;
  canArrange: boolean;
  isAdmin: boolean;
}): TourStep[] {
  const steps: TourStep[] = [
    {
      target: 'identity',
      title: 'This is you',
      body: `You're known by a name on this device, not an account — you're here as ${participant}. Open it for your profile, your calendar links, or to sign out.`,
    },
    {
      target: 'days',
      title: 'Pick a day',
      body: longEvent
        ? 'One tab per day, a week at a time — the weeks are the rail above. On a phone all of it folds into the day button, with an arrow for the day either side. Dimmed days have nothing scheduled yet.'
        : 'One tab per day of the event.',
    },
    {
      target: 'view',
      title: 'Grid or list',
      body: hasTracks
        ? 'Grid shows the columns side by side; list is a plain agenda that reads better on a phone. This event has tracks, so Grid asks whether to lay its columns out by room or by track — reading by track, each block says which room it is in.'
        : 'Grid shows the rooms side by side; list is a plain agenda that reads better on a phone.',
    },
    /* One step, because it is one button now — and conditional, because it is
       not always there: an event can turn the board off, and not everyone may
       book a room. Spread in place rather than pushed at the end, so the tour
       does not walk back up the page to reach it. */
    ...(canAdd
      ? [
          {
            target: 'add',
            title: 'Add or pitch a session',
            body: 'Both live here. Add one with a room and a time to put it straight on the grid, or pitch an idea with neither and let people say they would turn up — organisers place the popular ones.',
          },
        ]
      : []),
    {
      target: 'now',
      title: 'Jump to now',
      body: 'Scrolls the grid to the current time and the yellow now-line.',
    },
    {
      target: 'session-block',
      title: 'Open a session',
      body: "Tap any block for its description, speaker and everyone's notes, links and questions. Dashed green blocks are non-official — anyone may add one, and something else can always run alongside it.",
    },
    {
      target: 'filters',
      title: 'Find and narrow',
      body: 'Search finds a session on any day — press Enter for the full list of results. Filter narrows the day on screen by room, tag or text, and lives in the URL, so a filtered view can be shared as a link.',
    },
  ];
  if (canArrange) {
    steps.push({
      target: 'arrange',
      title: 'Move things around',
      body: 'Turn on Arrange, then drag a block to change its time or room, or drag its bottom edge to change its length. It snaps to 5 minutes and only moves what you may edit.',
    });
  }
  if (isAdmin) {
    steps.push({
      target: 'manage',
      title: 'Organiser tools',
      body: 'Rooms, tags, passwords, duplicating the event and archiving all live behind Manage Event.',
    });
  }
  steps.push({
    target: 'live',
    title: "It's live",
    body: 'Everyone else sees your changes within a second, with no refresh needed.',
  });
  return steps;
}
