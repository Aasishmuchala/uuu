# The real-apps check

Both App Studio apps, built and running for real, inside the Mac app's own web view (PLAN-DESKTOP T2, DM3). A test
tool: nothing here is in the app bundle or served by the engine.

```
node engine/mac/harness/apps-real/run.mjs --check-only      # ports 3188 and 3189 free? starts nothing
node engine/mac/harness/apps-real/run.mjs [--only <regex>] [--hold]
```

It prints one line per app and row, `works`, `breaks`, `looks wrong` or `hand check`, and ends with
`apps-real: 2 apps, rows <n>, breaks <m>` (exit 0 when m is 0). Reports and pictures go to
`/Users/aasish/uuu/.router/evidence/desktop/apps-real/` (`APPS_REAL_EVID` moves it): `table.txt`, `results.json`,
one JSON per row, webkit-probe's four pictures per app (1280 x 900 and 390 x 844, dark and light) and the runner's
pictures of each check.

- `stage.mjs`: the apps cloned from this worktree's `apps/`, built by `app-exec <slug> --build` in a temp state (no
  download; packages cloned from the live engine's deps, read only), run by the real host (`engine/apps/host.mjs`)
  on **3188** (Render to Film) and **3189** (Arch Film Studio), the only two ports of 3100 to 3299 it binds (DM3: the
  orchestrator's go, 127.0.0.1 only, both free by `lsof` first). The stage's fake door and relay
  (`engine/apps/test/stage/fakes.mjs`) stand in for the generation door and the model relay; the seeds of
  `shots-r2f.mjs` and `shots-afs.mjs` make each app's data through its own procedures, then the fake allowance is
  shut. A seeded test home (the V2 seed) on a free port from 3300 up shares the temp state, so App Studio's page,
  the switches and `frame-src` are the real server's. No key, no sign-in, no allowance.
- `runner/main.swift`: `apps-real-runner`, built by `run.mjs` with `swiftc` from EngineShell's sources into
  `.build/apps-real/`. The web view is `WebViewFactory.make(home:role: .probe)`, untouched (guard, rule list). Its
  own: panels that answer an open panel with a test picture and a save panel with a file in a temp folder (recording
  the suggested name and `SafeName.clean` of it), a recorder in every frame, and real input: mouse events handed to
  the web view under the point, keys through `performKeyEquivalent` and `sendEvent`, Copy as the Edit menu's `copy:`.
  The window stays off every screen and says it is key; the app is never activated. The clipboard is put back.
- `checks.mjs`: the steps and the judging of each row (the plan's items 1 to 9).

What was settled on this Mac (macOS 27):

- `NSWindow.sendEvent` of a made-up mouse event reached no page in a window of an app that is never active; the
  same event handed to the web view's own `mouseDown`/`mouseUp` is a normal click in the page and its frames.
- A window that is not key leaves the page unfocused: a click then never moves the focus into the frame. The
  runner's window answers `isKeyWindow` true without taking the keyboard from the owner.
- Full screen from the frame is granted (`fullscreenchange` fires) and WebKit leaves it within about 0.1 s, since a
  window off every screen cannot be shown full screen. That row is left to a person in a development build.

`--hold` keeps the stage up after the checks (Ctrl-C ends it) for the hand checks: a development build
(`build.sh --dev --origin-port <the home port> --out <dir>`, opened with `open -g`), a picture picked in the real
open panel, one dragged from Finder onto a drop zone, and full screen.

The runner takes `EVID/../mac/browser.lock` (`WEBKIT_LOCK`) and refuses below 20 percent on battery. It stops what it
started and checks with `lsof` that 3188 and 3189 are free again.
