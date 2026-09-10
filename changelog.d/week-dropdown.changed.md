- **The schedule header on a phone.** A long event used to spend two rows on
  choosing a day — a rail of week chips, and that week's days scrolling
  sideways under it — and both sat between the event bar and the first session.
  Past the week threshold (default 8 days) they become one control,
  `‹ Wed 18 Sep ›`, holding every day of the event grouped under its week with
  the session counts and dimming the strip carried. The chevrons keep the
  neighbouring day one tap away, which is the only thing the old strip was
  better at. Under the threshold nothing changes: the day strip stays, and it
  now has the arrows the week rail has always had, so a day past its edge is no
  longer a day you never find. A desktop keeps both rows. [LIB-189, LIB-192]
- **One button for adding a session and pitching one.** *Add a session* and
  *Pitch a session* were the same question asked twice — do you have a room and
  a time, or only an idea? They are one `+ Session` menu now, with a sentence
  each, which is the only place that difference could actually be explained.
  Where only one of the two is open to you it is a plain button that does that
  one thing. It also appears on a session's own page, which until now had no
  way out but backwards. [LIB-193]
- **"Propose a session" is gone.** It was a synonym for *pitch* three taps from
  the pitch board, and it was untrue besides: with the capability and a room
  open for booking, a session goes straight onto the grid with nobody reviewing
  it. The form says **Add session** to everyone now, because it is the same act
  whoever does it. [LIB-191]
- **The grid and the list say which day they are showing.** The day picker
  folds away as soon as you scroll into the day, and nothing else on screen
  named the day — a tab left open overnight, or a screenshot of a grid, said
  nothing at all. It sits in the space above the first session, and on the
  list's first time row, so it costs no height in either.
- **The header's controls are one height.** They were 30, 32 and 34 pixels in a
  row of siblings that should read as one line: the padding matched everywhere
  and the box model did not. The search field also stops demanding space it has
  to take from its neighbours, so an attendee's Now button no longer wraps to a
  second row on a 360px phone.
- **An attendee's `+` no longer gets a row to itself.** Manage and Arrange are
  organiser-only, so everyone else fell through to a full-width line holding
  one right-aligned `+` and nothing else. [LIB-190]
