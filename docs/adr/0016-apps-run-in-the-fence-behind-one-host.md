# 0016: Apps the engine runs stay inside a fence, behind one host

## Context

Until 13 November 2026 everything the engine ran was either the engine's own code or an agent inside the fence. On 13 November 2026 the owner asked for a separate App Studio on the home screen, where every app the company makes goes. His words: "okay now inside this i need separate APPSTUDIO OPTION where all the apps we create go there, /Users/aasish/Downloads/checkpoint.tar.zst this will be the first app remove runway sigin and change it to runway + higgsfield mcp".

The first app is Render to Film, which the owner made on Runway's hosted App Studio. It turns a render into cinematic stills, clips and a finished film. It brought about 262 third-party packages, a sign-in that only works on Runway's platform, storage on Runway's cloud and Runway's own credits.

The owner answered the questions that followed on 13 and 14 November:

- **Who uses it.** The owner and the Artist both use the app.
- **How it reaches the services.** Through the engine. The keys stay in Settings and never go into the app. Every app shares one set of daily and monthly limits and one record of spending.
- **The download.** "Yes, download them": the app's public packages, from the public registry only, once, into the app's own folder.
- **The rest.** He accepted every recommended default: Higgsfield off until switched on, one daily allowance for each app starting at $5, Aleph and clip upscale left out for now, the app's thinking on his own model provider, the app's source in the private GitHub repository, and a playbook so the Artist learns the app's recipes. The plan he named is not in Higgsfield's public price list, so the rate is five cents a Higgsfield credit, changeable in Settings.
- **Order.** On 14 November he said "Yes, live sooner": the App Studio pages are built in today's look and restyled later.

The change is the owner's to make. Every other rule stands: this Mac only, the fence is never loosened to make something work, and what runs unfenced never trusts what agents or third-party code can write (`0007`).

An app is third-party code in bulk. If it ran as the owner, any one of its packages could read every key on this Mac and send it away. So the question is the same as for the page viewer (`0015`): what can the most hostile app reach if it does exactly what it likes?

## Decision

An app is a folder. It runs only inside the fence, started by one host. It reaches the engine by one socket. It spends only inside the allowance the owner sets above it.

### An app is a folder in the repository

Each app is `apps/<name>/`, beside `engine/`. It holds its source, an `app.json`, an icon and, once it is installed, a file `READY`. Only `.build/` and `dist/` are made inside it when it runs, and git ignores both; its `node_modules` is a link to the app's packages in the state folder.

`app.json` has exactly these keys: `version`, `slug`, `name`, `about`, `port`, `entry`, `client`, `engine`, `tools`, `icon` and `memoryMb`. The reader refuses a missing or extra key, a slug that differs from the folder's name, a port outside 3171 to 3189 or one that another app also names (then both are damaged), a path with `..`, an icon that is not a plain `.svg` or `.png` file of at most 256 KB, and any file the trust rule refuses. `engine` may name `generate` and `relay`, and `tools` may name `ffmpeg` and `ffprobe`, and nothing else. A manifest that breaks a rule makes the app `damaged`: it is listed, and never started.

### The app fence

`engine/apps/app-exec` is the only way an app's code, its packages or its build runs on this Mac. It runs them inside the sandbox tool the agent fence already uses, in one of four modes. The environment is built from nothing; a variable of the caller's decides nothing.

| | run | build | test | install |
|---|---|---|---|---|
| Reads | the app's code, packages, data, run folder, temp, home, and Node 24 | code, packages, temp, home, Node 24 | the same | packages, the package store, temp, home, Node 24 |
| Writes | data, run folder, temp, home | `.build`, `dist`, temp, home | temp, home | packages, store, temp, home |
| Network | none | none | none | `registry.npmjs.org` only |
| Unix sockets | its own run folder | none | none | none |

The owner's home is denied in every mode. `app.json` and `READY` are never writable, and neither are the names Claude Code and Codex load as settings, instructions, skills or hooks, so nothing an app writes is ever picked up by an agent. The fence never uses `allowLocalBinding` (it opens every local port, the board and the home screen included) and never `allowAllUnixSockets`.

A test run on this Mac on 13 November settled the shape. A Node server inside the sandbox tool serves on a unix socket in an allowed folder and is reached from outside. From inside it reaches a socket served outside. A connection to a port on 127.0.0.1 fails with `EPERM`, and so does reading `~/.ssh`. Two limits came out of it: a unix socket path must be under 104 bytes on macOS, and the tool must find Node 24 first on its path, because the plain `node` on this Mac does not work in it. The proof for this step checks each wall again with the real tool.

The fence planner for agents learned the apps' ports, 3170 to 3189, and refuses them in any policy. No agent's fence can hold a port or a path of an app, the host or the allowances.

### The host is the only unfenced part

`engine/apps/host.mjs` is a part of the engine called App Studio (`engine/parts/39-apps.sh`; it counts as installed only once `engine/apps/READY` exists). It runs as the owner, unfenced, with no dependencies, and is the only unfenced code in this step. It is small on purpose.

Every two seconds it reads the manifests and the owner's switches in `<state>/apps/state.json`, both with the trust rule, and makes the running apps match. An app runs only when its manifest is good, its `READY` exists and the owner switched it on. It starts the app in its own process group through `app-exec`, waits up to 30 seconds for the app to answer a health check, and only then opens the app's address. An app that exits is started again after five seconds; the third exit within ten minutes makes it `failed` until the owner switches it off and on. Stopping ends the whole group, with a kill after ten seconds, and empties the run folder.

An app makes its own socket `app.sock` in a folder it may write, so it could put a link to any other socket on this Mac in that place. The host never connects through the app's name for it. It moves the socket by rename to a folder no app reaches, and checks there that it is a real socket owned by the owner. A rename moves a link rather than what it points to, so the host talks to what it checked.

### Each app is its own origin, framed by the home screen

The host serves each app on its own port on 127.0.0.1, 3171 to 3189. A different port is a different origin, so an app cannot read the home screen's pages or call its routes (every write there needs same-origin headers). The host checks every request in this order: an upgrade or tunnel is refused; a `Host` that is not its own address is refused; a `Sec-Fetch-Site` that is not the app's own is refused, except the home screen opening the app in a frame; anything but a read must carry the app's own `Origin`; a body over 40 MB is cut. No cookie or `Authorization` goes in and no `Set-Cookie` comes out, and neither does any header of the app's that makes the browser fetch, connect, prerender, report, reload or forget on the app's word: `Link`, `Refresh`, `Clear-Site-Data`, `Speculation-Rules`, `Alt-Svc`, `Report-To`, `Reporting-Endpoints`, `NEL`, `Origin-Trial`, `Service-Worker-Allowed`, `Document-Policy`, `Integrity-Policy` and every report-only policy (the list is `DROPPED_OUT` in `engine/apps/host.mjs`). Every answer carries the host's own content policy (the app's page may load and call only its own address, and may be framed only by the home screen), `nosniff`, `no-referrer`, `same-origin` for resources, and no camera, microphone or location. A form post carries `Origin: null` under that referrer rule and is refused, so an app sends its writes with `fetch`. That policy narrows what the app's page asks for; it does not stop a page in a browser from reaching the internet (see "What the fence does not protect").

The home screen opens an app in a frame under its own bar. The bar is the home screen's, not the app's, and the app cannot draw over it. It shows the app's state, what it may spend today with "Allow spending" or "Stop spending", the model it thinks with, and "Open in its own window". The frame may run scripts, keep its own address, send forms and save downloads, and nothing more: it opens no window of its own and never moves the home screen. One answer from the host that says the app is off does not take the frame away: the home screen says "Checking the app…" and believes the second. Only the host's address `127.0.0.1:3170` answers health, and nothing else is served there.

### What the fence does not protect

Two parts of an app run in two places. Its program, the server half, runs inside the fence. Its page, the half the owner sees, runs in the owner's own browser, like any web page. The fence holds the program. It cannot hold the page.

What the fence protects. The app's program cannot reach the internet, any port on this Mac, the owner's home folder, the keys and secrets in Settings, the engine's own secrets, another app, or the money path except through an allowance the owner sets. The page, for its part, cannot read the owner's files or keys, the home screen or another app.

What it does not protect. The page can still reach the internet, as any page in a browser can. So what the owner puts into an app (a render, a prompt, a picture it made, anything its program hands to its page) can be sent off this Mac by that app's page, from the owner's browser, if the app's own code or one of its packages is bad. Some of these ways need no click.

The review on 14 November 2026 (T85, finding 1, by Fable) showed it with a planted package: from the app's page it sent words to a server of its own by WebRTC and by a prerender link with no click, and opened a new tab with any click. Four things were then done (T86):

- **No popups.** The frame no longer has `allow-popups` or `allow-popups-to-escape-sandbox`, and Render to Film opens nothing in a new window: "Open full size" is a view inside the app, and a download stays a download.
- **Headers dropped.** The host stops passing the app's `Link`, `Refresh` and `Clear-Site-Data` headers, the three the review named, and with them every other header that makes the browser fetch, prerender or send reports to an address the app chose (the list above).
- **The fence's reads narrowed.** Before, an app could read some folders outside the home folder, such as other disks under `/Volumes` and `/Users/Shared`. Now it reads only its own folders, Node, and the system files a program needs.
- **The truth in words.** App Studio says it beside every app's switch, in full while the app is off: "This app's own program runs inside the fence: it cannot reach the internet or your files. Its page runs in your browser, and a page in your browser can still reach the internet, as any web page can. Turn on only an app whose code you trust." While the app is open, a short form stays under the bar: "This app's page runs in your browser and can reach the internet. Its program cannot."

The ways that remain, and cannot be closed by any rule the engine can set: WebRTC (Chrome does not obey the policy that should block it), a prerender link, and the page moving its own tab when the app is opened in its own window. Turning an app on is the owner's yes to this, and nothing is on at go-live.

### The engine socket is the app's identity

An app is known by the socket it can reach, not by a secret it holds. For each running app the host serves `<state>/run/apps/<name>/engine.sock` in a folder only that app's fence allows. For each call the host adds a fresh token (120 seconds, naming the app) keyed with the secret of the part it goes to. The app holds no key, and a package that reads every file the app can read finds no secret.

The socket serves only what the manifest's `engine` names. With `generate`: the generation door's app routes (models, estimate, inputs, jobs, one job, its output, the allowance). With `relay`: the model relay's `/v1/messages`, at most 60 calls an hour and 300 a day for each app. The body must be one JSON object with a whole-number `max_tokens` (otherwise `app_refused`), and a `max_tokens` over 12,000 (`HOST_LIMITS.relayMaxTokens`; Render to Film asks at most 10,000) is refused, never cut, as `app_too_long`: "This app asked the model for a longer answer than App Studio allows." The host sends the body it checked, and sets the provider's `anthropic-version` header itself, since the app cannot pass one. The relay counts each app under its own name in its status file (calls, tokens, the times of its calls in the last day, its last refusal), never among the agents. Anything else is `app_not_found`. Only a few headers go in and a few come back, and a log line holds the time, the app, the route's name and the status, never a header, a body or a token.

### Money: the allowance is the owner's yes for an app

An app's click is the owner's click, so a click cannot be a plain yes for any amount. The owner sets an allowance in the home screen's bar above the app: $2, $5, $10 or $20, never more than is left of today's limit and this month's. It ends at the next midnight in Kolkata, or when the owner presses "Stop spending". It is a file in `<state>/doors/allowances/<name>.json`, written only by the home server, with a new id at each yes. The generation door reads it fresh at every job and adds up its spending from the ledger.

- Every spending button in an app shows its price first ("About $0.40", from the door's own table) and is off, with "Allow spending in the bar above.", while no allowance is open.
- App jobs do not need the Artist's switch. They need the app on, an open allowance, the service ready and the limits.
- There is one ledger and one set of limits for the Artist and every app. A Runway job and a Higgsfield job count against the same daily cap.
- An app may have two jobs running and the door four in all; more are refused with `gen_busy`.

### Dependencies live in the state folder

The app's packages are installed once, into `<state>/apps/render-to-film/deps/`, with pnpm's store beside them in `store/`. The lockfile is first pruned of the packages the app no longer uses (Runway's private ones and Amazon's), then checked: every package left is in the original lockfile with the same hash, none comes from an address, none belongs to the dropped families. Only then is it fetched with the lockfile frozen, so every byte is checked against the original hashes. The fetch runs in the install mode of the fence, which reaches only `registry.npmjs.org`, and runs no install script for any package. The files the app needs from native packages are prebuilt inside their packages, and a test inside the fence proves they load.

On 13 November the install ran: 262 packages in the pruned lockfile, 164 fetched (98 are for other kinds of computer and were not needed), 220 MB of packages and 216 MB of store, from the public registry only, with pnpm 10.28.2 that Node already holds. Nothing enters git and a merge moves no package. A package that ships a name the fence refuses (an editor folder, a git hook, a settings file of an agent) fails the install and the install stops.

### Render to Film, made local

The app keeps Runway's task words at one boundary, a small gateway, so its forty call sites and seventeen prompt files stayed as they were. What changed at that boundary:

- **Removed.** The Runway sign-in, the consent notice, Runway's credits and storage, and Runway's private design package, which cannot be fetched. The profile is "You". The fonts are Geist and Geist Mono (open licence), from the home screen's own folder.
- **Replaced.** Pictures and documents are on this Mac, in `<state>/apps/render-to-film/data/`. Stills and clips go to the engine's generation door, which chooses Runway's public service when it offers the model and Higgsfield otherwise. The app's thinking (its people check, close-up finder, storyboard planner and editor chat) goes through the model relay under its own pick, the Art director's at first. Video work (trim, join, export, captured frames) is done by this Mac's ffmpeg inside the fence.
- **Dropped, with a plain sentence where it shows.** Aleph (AI grades and edits of a clip), clip upscale, Krea Image 3, LTX-2.5 Pro, Gen-4.5's frames in between, negative prompts and seeds. The built-in look of the Edit page stays.
- **Priced, but not made yet.** The door has no price for Wan 2.6 or for Higgsfield's 4K upscale, and none for two of Runway's GPT Image variants. A model with no price is refused, and nothing is spent: the app says "Price unknown".

### What the Artist may never do

The Artist uses the door as before (`0014`), only inside a batch the owner approved, and a batch's model may now be a Higgsfield one. It may never open, reach or name an app's port, the host or an engine socket (its fence allows no unix socket and refuses the ports); draw on an allowance (an agent job that names one is refused, and only the host mints an app's token); pick a provider or model outside its batch; read an allowance, an app's data or the Higgsfield token file; or send a picture it did not upload itself. The Artist learns the app's recipes, in words only, as a playbook (`own/render-to-film`), which says in so many words: never open the app.

## Consequences

- One more part to run, with its own line in `engine status` and Health: "App Studio is on. Open: Render to Film.", or "App Studio is on. No app is switched on.", or "App Studio is not installed yet."
- Nothing of this is live yet. It is built and tested: the host and the app run in the real fence, and a rehearsal against stand-in services ends with a clip made, the allowance used up, and the app unable to reach 127.0.0.1:3200 or `~/.ssh`. The live proof and the real services come at go-live. Until `apps/render-to-film/READY` and `engine/apps/READY` exist, App Studio lists the app as "Not ready yet." and nothing starts.
- An app costs memory while it runs: up to the manifest's `memoryMb` (2 GB for Render to Film), and the app's thinking draws on the owner's model provider only while Models is on the owner's key: with Models set to plans the model relay refuses it (`relay_app_plans`) and nothing is sent. Settings, Models shows one line for each app that asked: its calls today and this hour, and why the relay last refused it. It is not in Generation's spending.
- The host is the one new piece that runs unfenced. A flaw in it would be a flaw in the engine, so it is small, has no dependencies, and is attacked in this step's proof and review.
- No WebSocket, cookie, inline script or form post works in an app. The host's rules forbid them.
- An app's data can be as large as the pictures and clips the owner makes in it. Nothing tidies it.

### Known limits

- **A package that runs as the app.** Code inside the fence can still do what the fence allows: fill its own data folder, use up to its memory, spend inside an open allowance, ask the model relay to think up to its hourly and daily counts, and make the pictures it shows the owner say anything. The allowance, the limits and the price beside each button are what bound the money.
- **A package in the app's page.** It runs in the owner's browser and can send what the page holds off this Mac. See "What the fence does not protect". Render to Film brought 164 packages from the public registry, and its page is built from some of them; one bad one is enough.
- **The home screen shows the app's own pictures.** What an app draws is the app's. The bar above it is not.
- **Uploads to Higgsfield are held.** See `0017`.

## Rejected

- **An app run unfenced, as the owner.** About 262 packages, any one of which could read every key. This is the thing the fence is for.
- **Docker.** It is not on this Mac.
- **The sandbox's `allowLocalBinding`.** It opens every local port, including the board and the home screen.
- **An app served from the home screen's own address.** Its code would act as the owner on every route.
- **A new tab only.** The owner asked for apps inside the home screen. A tab remains, as "Open in its own window".
- **A confirm for every click.** Tiresome. One yes a day, with the price beside every button, is as honest and keeps the app usable.
- **No allowance.** An app could spend up to the daily cap unseen.
- **A secret file inside the app.** Any of its packages could read it. The socket is the identity.
- **An agent token for an app's routes.** It would turn third-party code into a door for an agent, and app work is not bounded by a batch.
- **Fetching the app's packages without a lockfile check, or running their install scripts.** Neither is needed here, and each puts third-party code on this Mac outside the fence.
