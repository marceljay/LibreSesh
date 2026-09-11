- **The About page names the deployed commit on Railway.** It read "unknown"
  there: the image is built without the git history, and nothing on the
  platform handed the build the commit it was building. The Dockerfile now
  asks Railway for its own commit variable and stamps the build with it, and
  prints what it received into the build log so a missing stamp can be traced
  rather than guessed at. Nothing to configure.
