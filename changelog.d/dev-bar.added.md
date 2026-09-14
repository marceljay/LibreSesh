- **The dev server names the checkout it serves.** Under `npm run dev` a
  strip along the bottom of every page says which working tree and branch
  this is, the commit the tree sits on (with a note when it has uncommitted
  changes) and when the server came up, read from git as you go rather than
  stamped at start. With several worktrees each running a server, the tab
  alone did not say which checkout was on screen. The × folds it to a corner
  tab that brings it back. Only the dev server has it; a production build
  carries neither the bar nor its request.
