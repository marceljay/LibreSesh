- **Only a demo event says its data may be reset.** On an instance running in
  demo mode, the About box on every event read "demo instance — the data here
  is reset", including the real events that instance hosts, whose data is
  never touched. The line now appears only on the demo events themselves, and
  says "may": nothing reseeds even those on a schedule, only an operator
  running `npm run seed`.
