# App Studio's engine side

Apps are folders `apps/<slug>/` beside `engine/`, each with an `app.json` (PLAN-V5 K17). This
folder holds what runs them. None of it has a dependency.

| File | What it is |
|---|---|
| `manifest.mjs` | Reads every app's `app.json` with the trust rule; a manifest that breaks a rule makes the app `damaged` (listed, never started). `appPaths` says where an app's code, packages, data and sockets live. |
| `fence.mjs` | The app fence (K18): what the sandbox tool is told for `run`, `build`, `test` and `install`. |
| `app-exec` | The only way an app's code, its packages or its build runs on this Mac: inside the sandbox tool, with an environment built from nothing. |
| `host.mjs` | The host (K17, K19): App Studio's only unfenced code. Part `engine/parts/39-apps.sh`, part name "App Studio", started by `engine start` once `engine/apps/READY` exists. |

## The host

Every 2 seconds it reads the manifests and the owner's switches (`<state>/apps/state.json`) and
makes the running apps match. An app runs only when its manifest is good, its `READY` exists
and the owner switched it on.

- **Start:** the app's run folder `<state>/run/apps/<slug>/` emptied and made again (0700), its
  engine socket `engine.sock` opened there, `app-exec <slug> --run` started in its own process
  group with pipes for its output (kept in `<state>/logs/apps/<slug>.log`, cut to `.1` at 5 MB).
  When the app's `app.sock` appears it is moved at once to `<state>/run/apps/.host/<slug>`, where
  no app can reach, and checked there: a socket, not a link, the owner's, one name. A 200 on
  `GET /healthz` within 30 seconds makes the app `on`; then its browser listener opens.
- **An exit:** started again after 5 seconds; the third exit within 10 minutes makes it `failed`
  until the owner switches it off and on.
- **Stop:** the listener closes, SIGTERM to the group (and to any process the app started in a
  session of its own), SIGKILL after 10 seconds, the engine socket closes, the run folder is
  emptied.
- **States:** `off`, `starting`, `on`, `failed`, `not_installed`, `damaged`.

### Why `app.sock` is moved

The app makes `app.sock` in a folder it may write, so it could put a link to any unix socket on
this Mac in its place, and an unfenced program that connected through that name would follow
it. The host never connects through it. A rename moves a link itself rather than what it points
to, and the fence lets an app neither move, remove nor replace its run folder, nor link in a
socket from outside it (the tests prove each), so what the host checks in its own folder is
what it then talks to, every time.

### The browser side: `127.0.0.1:<the manifest's port>`

Checked in this order: an Upgrade or CONNECT → 403; a `Host` other than `127.0.0.1:<port>` or
`localhost:<port>` → 421; a `Sec-Fetch-Site` other than `same-origin` or `none` → 403, except
`same-site` on a GET or HEAD with `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest` `iframe` or
`document` (the home screen opening the app); an `Origin` other than `http://` + the `Host` →
403, and anything but GET and HEAD must carry that `Origin`; a body over 40 MB is cut.
`Cookie`, `Authorization`, `Proxy-*` and hop-by-hop headers never go in. `Set-Cookie` and
hop-by-hop headers never come out, and every answer carries the host's own content policy
(framed only by the home screen), `nosniff`, `no-referrer`, `same-origin` resources and no
camera, microphone or location. An app that does not answer gets a page with no script: "<name>
is starting or stopped. Open App Studio to see why." At most 64 requests at once per app;
request headers within 10 seconds.

Because every page says `Referrer-Policy: no-referrer`, a browser sends `Origin: null` with a
plain HTML form's POST, which the host refuses. An app sends its writes with `fetch`.

### The engine socket: `<state>/run/apps/<slug>/engine.sock`

The app's only way into the engine, and how the engine knows which app is asking: an app holds
no secret. For each call the host adds a fresh token (kind `t`, subject `app-<slug>`, 120
seconds) keyed with the secret of the part it goes to.

| The app asks | Goes to | Only when the manifest's `engine` names |
|---|---|---|
| `GET /gen/app/models`, `POST /gen/app/estimate`, `POST /gen/app/inputs`, `POST /gen/app/jobs`, `GET /gen/app/jobs/<job>`, `GET /gen/app/jobs/<job>/output`, `GET /gen/app/allowance` | the generation door, same path | `generate` |
| `POST /v1/messages` (JSON, at most 32 MB; 60 an hour and 300 a day per app) | the model relay | `relay` |

Anything else is 404 `app_not_found`. Only `Content-Type`, `Content-Length` and `Accept` go
in; only the status, `Content-Type` and `Content-Length` come back. The host's own refusals are
403 JSON `{ "error": { "message" }, "code" }`: `app_engine_off`, `app_no_answer`,
`app_limited`, `app_too_big`, `app_refused`, `app_busy` (16 calls at once, 4 of them to the
relay). The relay's counts are kept in the status file, so a restart does not reset them.

### Its own address: `127.0.0.1:3170`

`GET /apps/health` → `{ "status": "ok", "part": "apps", "apps": [ { "slug", "state", "since",
"restarts" } ] }`. Nothing else is served there. The status file `<state>/apps/host-status.json`
holds the same per app, with `name`, `port`, `why` (for `failed`: `exits`, `no_health`,
`port_busy`, `path_too_long`, `run_folder`, `spawn`, `app_socket_not_a_socket`, …) and the
relay's calls of the last day.

### Log lines

The time, the app, a route's name and a status. Never a header, a body, a query string or a
token.

## Tests

`node --test engine/apps/test/*.test.mjs`. The host's tests (`host-*.test.mjs`) run the fixture
app in `test/fixture-app/` unfenced through an injected spawner, behind a fake generation door
and a fake relay that check every token; `host-sandbox.test.mjs` runs it in the real fence
through `app-exec`. Nothing touches the live engine's state.
