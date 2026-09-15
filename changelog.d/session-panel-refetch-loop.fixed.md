- **An open session no longer refetches itself in a loop.** Selecting a session
  loaded its contributions, and loading them dispatched the session it had just
  read back into the bundle — which replaced the selected object, which the
  effect watched, which loaded them again. The panel fetched
  `/sessions/:id` about eighty times a second for as long as it was open, until
  the read rate limit refused it and the page showed "Too many requests". The
  effect now watches the selected session's id, which does not change when its
  contents do. Removing the read limit is what made this visible: with nothing
  left to refuse it, the loop no longer stopped on its own.
