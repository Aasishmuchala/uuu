# The WebKit harness

Pictures of the home screen as the Mac app's own web view draws them (PLAN-MAC D12, PLAN-MAC-2 M4 and N5). It is a
test tool: nothing here is in the app bundle, and nothing here is served by the engine.

## The parts

- `../Sources/WebKitProbe/main.swift`: `webkit-probe`, a command-line program. It makes its web view with
  `WebViewFactory.make(home: .local(port: p), role: .probe)`, the same configuration, navigation rules and guard as
  the app, puts it in a borderless window far off every screen, loads one page of a seeded home and writes a JSON
  report, optionally after running a script and with a PNG. Build: `cd engine/mac && swift build -c release --product webkit-probe`.
- `run-webkit.mjs`: one round of pictures. `node engine/mac/harness/run-webkit.mjs --round <r> [--only <regex>]`.
- `shots-webkit.json`: the shots. Every shot of the cook harness's `shots.json` except the site samples (S21 to S26,
  kind `site`: pages of sites agents made, not of the home screen), plus B01 to B06 (the Brain pages and an Astryx app).
- `scenes/`: the scenes written here (`from: "mac"`); every other shot imports the cook harness's scene.
- `checks/steps.js`, `checks/look.js`: the script the probe runs in the page for a shot: the shot's wait, its steps,
  its style sheet, then the measure (wider than the window, frames on the page, the focused element).

## webkit-probe

```
webkit-probe --origin-port <p> --path '/?theme=dark#/tasks' [--size 1280x800] [--scale 2] [--wait-ms n]
             [--script file.js] [--snapshot out.png] [--full] [--reduced-motion] [--appearance light|dark]
             [--json out.json] [--timeout-ms n]
```

The port follows `build.sh --dev`: 3300 to 65535, never 5000, 5432, 7000 or 8120. The path goes through
`HomeOrigin.url`, so only the home origin is ever loaded. Exit 0 done, 1 the page did not load or the script threw or
the snapshot failed, 2 bad arguments, 3 timed out (90 s by default).

The report: `url`, `title`, `loaded`, `quiet`, `visibility`, `consoleErrors[]` (console.error, uncaught errors and
rejections), `cspViolations[]`, `failedRequests[]` (resources that failed to load, fetches that failed or answered 400
or more), `dropped` (addresses the guard dropped), `externalAsked[]` (what would have opened in the browser; nothing
opens), `panelsAsked[]` (every panel is answered "cancel"), `scriptResult`, `scriptError`, `webglContexts` (calls of
`getContext("webgl" | "webgl2" | "experimental-webgl")`; 0 is expected), `images: { total, broken }`,
`frames: { count, medianMs }` (requestAnimationFrame over `--wait-ms`, at least 300 ms), `notes[]`, `elapsedMs`.

What was settled on this Mac (macOS 27, WebKit 22625):

- **requestAnimationFrame off screen.** A window off every screen counts as hidden: WebKit held back both drawing and
  animation frames (0 callbacks in 1 s, and lists drawn by the page's script never appeared in the picture). The probe
  turns off WebKit's window-occlusion judgement for its own web view (`_setWindowOcclusionDetectionEnabled:`, a WebKit
  switch for tests, asked for by name and skipped with a note when absent). With it off the page is `visible` and
  requestAnimationFrame runs at full rate (median 17 ms). The app is not touched by this.
- **takeSnapshot and the full page.** `takeSnapshot` draws the web view's own bounds only. `--full` therefore makes
  the view as tall as the page (at most 6000 points), takes the picture and puts the view back, as the cook harness's
  `captureBeyondViewport` does.
- **Scale.** WebKit's picture is drawn into a bitmap of exactly width x scale by height x scale pixels.
- **Reduced motion.** WebKit has no switch for it. `--reduced-motion` makes the page's `matchMedia` answer "reduce";
  style sheets still see the system's answer, so the round also passes the web app's own `motion=off`.
- **Website data.** The probe clears its own website data (its own folder, not the app's) before every run, so no
  look or setting carries over from one picture to the next.

## run-webkit.mjs

For each shot, at 1280 x 900 and 390 x 844, dark and light: start (or reuse) the shot's seeded home on a free port,
run the probe with `?theme=<theme>&motion=off`, the appearance of that theme, scale 2 and the shot's script, and
write `EVID/r<r>/<shot>-<width>-<theme>-webkit.png`; every report goes into `EVID/r<r>/summary.json` under
`pictures`. `EVID` is `WEBKIT_EVID`, default `/Users/aasish/uuu/.router/evidence/mac`.

- One hidden browser at a time: the round takes `WEBKIT_LOCK` (default `EVID/browser.lock`) with `mkdir`, waits 20 s
  while it exists, and removes it when it ends, on any way out.
- It refuses to start on battery below 20 percent.
- It fails a picture only when the probe failed, no picture was written, a shot's wait never appeared or a page asked
  for a WebGL context. Console errors, policy violations, failed requests, dropped addresses, broken images and a page
  wider than the window are written down for the WebKit pass (M6) to judge.
- The cook harness's scenes are imported from `/Users/aasish/uuu/cook/harness/cook/scenes` with `COOK_ENGINE` set to
  this worktree's engine; none of its files is changed. It refuses to run from the live checkout.

### Steps inside WebKit

The cook harness drives Chrome through its debugging protocol; here the steps run as script in the page: a click is
`element.click()`, a key is a `KeyboardEvent` sent to the focused element (the web app's shortcuts answer it), and a
character typed into a field goes in with `insertText`, which fires the field's input event. Hover and real focus
rings from a keyboard are not reproduced.

### Scenes written here

- `scenes/brain.mjs` (B01 to B05): no cook scene had the Brain pages. The brain's switch is turned on with
  `updateDoors`, the brain's test fixture files are written into the home's own temp state, and the index is built by
  the server's own `POST /api/brain/index/refresh`. B05 is Settings → Brain with the switch off.
- `scenes/apps.mjs` (S07, S08, S08b, S08c, S08d, B06): the cook scene puts its stand-in app on a port from 3172 to
  3189, and the plan keeps 3100 to 3299 unbound. Here the stand-in app is on a free port from 3300 up, so App Studio's
  page makes no frame and shows its own sentence ("This app's port is not one App Studio opens, so it is not shown
  here.") where the frame would be; the app's navigation rules would drop such a frame as well (they allow frames from
  127.0.0.1:3171 to 3189 only). The pictures show App Studio's bars and notice line; a frame that is allowed, drawn in
  WebKit, needs a port from 3171 to 3189 and is the isolation trial's (M8). B06's stand-in is the Astryx kit's example
  page served with App Studio's own headers, the kit imported by relative path, ready for that trial.
- `scenes/_lib.mjs`: the engine to use (never the live one) and a free port from 3300 up.
