# The frames trial

What a page inside App Studio's frame can do in the Mac app's web view, before the rule list (PLAN-MAC D16) and with
it. A test tool: nothing here is in the app bundle or served by the engine.

```
node engine/mac/harness/frames/run.mjs
```

It prints `<attempt>: blocked | allowed-by-design | STILL GETS OUT` for every attempt, once for each of the two, and
writes `EVID/rmac8/frames.txt`, `frames.json` and two pictures of the Astryx kit's example drawn in the frame
(`astryx-frame-before.png`, `astryx-frame-after.png`). Exit 1 when a row for top-page movement, parent reading, a
permission or the brain is not `blocked`, when the app's own origin or the Astryx app fails with the list on, or when
the frame's first request is not what `engine/apps/host.mjs` accepts.

- `run.mjs`: the stand-ins and the judging. A stand-in home frames a stand-in app with the `sandbox`, `allow` and
  `referrerpolicy` read from `PUB/pages/app.js`, under the home's content policy read from
  `home/server/lib/app.mjs`; the app answers with `host.mjs`'s `securityHeaders` and judges each request with its
  `browserRefusal`. A stand-in internet (HTTP, WebSocket, a bare port for preconnect), a stand-in brain door (for 3190)
  and a UDP port for STUN write down what reaches them. All on free ports from 3300 up.
- `trial/main.swift`: `frames-trial`, built by `run.mjs` with `swiftc` from EngineShell's sources and this file into
  `.build/frames/`. The web view is `WebViewFactory.make(home:role: .probe)`. Because ports 3171 to 3189 stay unbound
  here, two things stand in for them, in this program only: a delegate in front of the app's guard judges a load on
  the stand-in app's origin as the guard judges the same address on port 3175, and with the list on the factory's list
  is swapped for `RuleList.json(home:framePorts:)` with the stand-in app's port added. Clicks are real mouse events.
  The system clipboard is copied before a clipboard attempt and put back after it.
- `pages/`: the home's script, the app's attack page and its service worker.

The runner takes `EVID/browser.lock` and the scratchpad's `chrome.lock`, and refuses below 20 percent on battery.
