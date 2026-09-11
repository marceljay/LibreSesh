- **The About page names the deployed commit without a variable being set.**
  The 0.6.0 fix only took where a `BUILD_COMMIT` reference variable had been
  added to the service by hand: Railway forwards the variables set on a
  service to the image build, not its own commit variable, so a service
  without that one still read "unknown". The commit is in the server's
  environment once it runs, so the server reads it there and the page takes
  it from the server wherever its own stamp is missing. Nothing to configure
  on any service.
