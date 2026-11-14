# 0015: Pages the Builder makes are opened in a real browser that runs outside the fence

## Context

Until 13 November 2026 the Builder could write a page but could not see it. It could not tell whether the page was wider than a phone, whether a picture failed to load, or whether the words were too small to read. Nothing could take a picture of a page, so neither the Builder nor the Art director could judge one by looking. On 12 November 2026 the owner said yes to a real Chrome on this Mac that opens the pages agents make and takes pictures of them.

The change is the owner's to make. Every other rule stands: this Mac only, the fence is never loosened to make something work, and what runs unfenced never trusts what agents can write (`0007`).

A page is code an agent wrote, and a browser runs it. That is the whole difficulty. The question is what the most hostile page can reach if Chrome does exactly what the page says.

## Decision

One small server, outside the fence, that opens a built site in a hidden Chrome and gives back pictures and a report. Two agents can reach it, only while the owner's switch is on.

- **The page viewer.** It is a part of the engine on 127.0.0.1 port 3150, with no dependencies, built on the pattern of the web door (`0013`) and the generation door (`0014`): a token minted outside the fence, a log, a status file, a part script (`engine/parts/38-viewer.sh`) and a line in `engine status` and Health. It counts as installed only when `engine/viewer/READY` exists. Its switch is in `<state>/doors/state.json`, which agents cannot reach. A missing or damaged file means off.
- **Two agents.** Only the Builder and the Art director can reach it, named in `config.json` (`doors.viewer.agents`). The Checker cannot, and says so when it reads a page. The Builder looks at its own page and fixes what it sees, at most three looks. The Art director asks the viewer itself and never trusts the Builder's pictures.
- **Why it runs outside the fence.** A browser inside the fence would need a patched fence tool (`0009`, `.router/V3-P1-FINDINGS.md`). The fence is the engine's strongest wall, and it is not weakened for one feature. So Chrome runs next to the fence, not in it, and everything that makes that safe is built around Chrome instead.

### The walls

Chrome runs as the owner, so each of these is there because a page could otherwise reach the owner's Mac.

- **Chrome's own sandbox is on.** No flag in the viewer turns it off. The flags are written in one place, and a test fails if any of them touches the sandbox, so `--no-sandbox` can never be added quietly. A test with the real Chrome checks that every renderer it started ran inside Chrome's sandbox.
- **A throwaway profile.** Every start gets a new profile folder, home folder and temporary folder, made private, and removed when the render ends. The owner's own Chrome and its profile are never looked at or touched. Chrome is ended by its process id, never by the name of the program.
- **A proxy that passes only the site.** Chrome is told to send every address, local ones too, to the viewer's own small proxy. The proxy passes exactly one destination, the throwaway copy of the site on a random local port, and only GET and HEAD to it. Every other address, every tunnel (so every `https` and `wss` address) and every upgrade is refused, and counted in the report as blocked. The proxy never looks up a name. Chrome's own name lookups are switched off.
- **Request interception on top.** Over Chrome's private debugging pipe (there is no debugging port), the viewer fails any request whose address is not the site's own. This catches what the proxy cannot see, and the proxy catches what interception misses. Neither is trusted alone.
- **The WebRTC preferences.** A page can use WebRTC to send packets that go round a proxy. The command-line flag alone did not stop them in the prototype. The profile's own preferences are written before Chrome first reads it, so WebRTC may use only proxied traffic.
- **Nothing is allowed that asks.** Every permission is denied (camera, microphone, location, notifications, the clipboard and the rest), downloads are denied, dialogs are dismissed, new windows are blocked, and background networking, component updates, sync, extensions and the first-run page are off.
- **A memory watchdog.** The viewer measures the whole group of Chrome's processes every 200 milliseconds and ends it at 2 GB. It takes the larger of two measures: the resident memory the system lists, and the physical footprint (resident, compressed and swapped out together). The second was added after a test page held 2.4 GB while its resident memory stayed under 1 GB, because the Mac had squeezed the rest, so a cap on the resident memory alone never fired. The footprint is read by a small helper of the system's own Python, asked for the members' process ids each turn. If the helper cannot answer, the watchdog goes by the resident memory alone. The sentence the report gives, "The page used more than 2 GB of memory, so Chrome was stopped.", is the same whichever of the two measures went over.
- **One render at a time.** A second call while one is running is refused with `view_busy`, and the home server, which asks for the owner's pictures, keeps its own single line of renders. A page gets 15 seconds, a whole render 60, and then the processes are ended and the work folder is removed. A render takes at most three pages.
- **No link on the path.** Every reader of agent-written files opens them with no link anywhere on the path. A link that points elsewhere is refused, not followed.
- **The viewer spends Chrome's one launch.** Chrome is kept from opening another program by its own rule of one launch per start. The viewer uses that one launch on a harmless program before any agent page runs, so a page cannot use it.
- **The content policy.** The throwaway site is served with a content policy that lets a page reach nothing but itself (`default-src 'self' data: blob:`, no frames, no objects, no form posts, no base), `nosniff`, no cookie, and one fixed content type for each file ending. A file is served only if it was in the archive.
- **The archive is distrusted byte for byte.** The viewer reads the tar itself. It refuses an archive over 20 MB, more than 300 entries, anything that is not a plain file or folder, a name that is absolute, has `..`, is not plain letters, digits, dot, dash and underscore, or is more than six folders deep, a file over 10 MB, an ending the viewer does not serve, and a site with no `index.html`. A query other than `pages=` with up to three page names is refused.

### What it gives back

Each page at a computer width of 1280 and a phone width of 390, light, and dark too when the site's own CSS has a dark setting (the whole page, cut at 6,000 pixels), and a `report.json`. The report holds what the page did: errors in its console, anything wider than the screen, pictures that did not load, addresses that were blocked, missing labels and descriptions, text that is hard to read, the faces and sizes drawn and the colours used. The viewer writes the answer tar itself. The home server and the agents read it with strict readers, and the report reaches the owner only as plain sentences built from capped values.

### What remains, and what bounds it

Two things remain.

1. **A flaw in Chrome's renderer and in Chrome's sandbox at the same time** would run a page's code as the owner. The page is written by an agent that was itself working from text it was given, so this is an attack on the browser, not on the engine. What bounds it: Chrome's sandbox stays on; the profile is thrown away; the browser can reach only the throwaway site; the Builder has no internet to fetch an attack from; the viewer is off until the owner turns it on; and Health shows Chrome's version, so an old one is seen. Beyond those, only keeping Chrome up to date helps, and that is the owner's.
2. **The camera helper.** If a page asks for the camera, Chrome starts its own video-capture helper, and that helper runs without a sandbox. The permission stays denied, and the helper is reached only through the browser process, so a page cannot start it alone. This is left as a risk and said here. It adds nothing a flaw in Chrome's renderer and sandbox together would not already give.

### The owner's preview

For the owner, a site can be opened in the owner's own browser. This is a second small server in the same part. Its own address is 127.0.0.1 port 3160, and it only sends the browser on. Each load of a site is served on its own port, one of 3161 to 3169, so each is another origin than the home screen, the gate, the relay and every door.

- Each load gets its own port, with no service workers, and its site data is cleared. The ports are used in turn, so after nine more loads one is used again.
- It holds each site in memory. Only the home server can load it (with the viewer's own owner token), from a file list the home server read itself under the same rules as the viewer's.
- Every answer carries the content policy above, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, `nosniff`, a permissions policy that turns off the camera, microphone, location and the rest, and `no-store`. No cookie is ever set.
- A request whose `Host` is not its own address is refused, so a name someone else's site points at 127.0.0.1 cannot read it.
- The home screen opens it in a new tab with `noopener` and `noreferrer`. The address it opens is the home server's own, never the one the preview answers with.
- **What remains here.** In the owner's browser a previewed page can send the browser away and so carry its own contents out. Those are the site's own files, meant to be public. It cannot read the home screen (another origin, and every write there needs same-origin headers) or a door (each needs a token). It cannot read another preview while that preview is on a port of its own. The limit below says when that is not so.
- **Nothing is published.** "Download as a zip" is a zip the home server builds from the same checked file list. A site goes nowhere else.

### The home server's own pictures

The home screen judges a page from the viewer's own measurements (the colours, the faces, the smallest text, the blocked addresses and the filters), not from the agent's check. The home server asks the viewer for the owner's pictures of a site, keeps them by a hash of the site's files in `<state>/home/shots/` (at most 500 MB, oldest removed first), and shows them on the task's page and in the pick card. It does this for agents' pages only while the switch is on. The owner's own "Test" (a page built into the engine, nothing an agent made), the preview and the zip work whatever the switch. No agent can reach the folder of pictures: the proof checks it.

### The brand check reads pages by code

The brand check (`0011`) reads a site's own files as text, never from pictures, and nothing is run. It sends a page back to the Builder, with the check's own words, before any reviewer's time is spent, for: the kit's tokens file changed (`tokens_file_changed`), a colour that is not the kit's (`colour_not_token`), a face that is not the kit's (`font_not_kit`), text smaller than the kit's smallest (`text_too_small`), an address outside the site in a place a page loads from (`outside_address`), and a logo that is not in the page's header (`no_logo`). A `.ttc` font is a soft warning, because pages cannot use one. When the Builder runs it with `--report`, it also uses the viewer's own measure of the smallest text drawn. A false report can only add failures.

It has known gaps, and they are the reason the pictures and the other walls exist. It reads a script for addresses in a string written out in full, not for a colour or a face a script sets when it runs, and it cannot read an address a script builds from pieces. The viewer's report (the colours and faces really drawn) and the Art director's own look catch the first; the proxy, the interception and the content policy stop the second whether the check sees it or not. It does not judge a photograph.

### The site kit

The Builder builds from the brand kit and a small offline site kit, `engine/site-kit/`: a reset, a layout with a 12-column grid and a spacing scale, a script that fades parts in as they come on screen, and a script for a picture lightbox. They are written in this repository, so there is no third party's licence to carry, and they fetch nothing and name no address. The playbooks installer copies them, with a note, to `<state>/playbooks/site-kit/`, where the Builder and the Art director may read them and none may change them. A library that is not there is not used, and no package is installed.

### Known limits

These are said plainly. None is hidden.

- **A tab left open while nine more sites are previewed.** The preview has nine ports. A tab of a previewed site, left open while nine more sites are previewed, shares its address with the ninth one. While the ninth is loaded, that old tab can read it. Closing the tab, or not previewing so many sites at once, avoids it.
- **Chrome's one launch.** The viewer's Chrome is kept from opening another program only by Chrome's own rule of one launch per start. A test catches a Chrome that changes that rule. A Chrome that changes it and is not tested is not caught.
- **The check by code runs no scripts.** The measured verdict sees only what a page shows about 300 milliseconds after it loads. A page that changes itself later (on a scroll, a timer or a visitor's input) is not measured.
- **Only the first 5,000 elements are measured.** A page with more is "unknown", never a pass.
- **Some places are not looked into.** Nothing inside iframes, shadow DOM or canvas is measured, and neither are the pixels of pictures and video.
- **A hidden logo can pass.** A logo hidden by a rule in a style sheet passes the check.
- **A hidden browser can be told apart.** A determined page can still tell that its browser is hidden, and act differently.

## Consequences

- One more part to run (the viewer, with the preview inside it), with its own line in `engine status` and Health, and one more row in the playbooks list for the site kit.
- Nothing of this is live yet. It is built and tested: a rehearsal on a copy of the engine, with the real Chrome and a page made to attack it, ended with the page's pictures taken, the blocked addresses counted and neither canary (a local listener, and a name for the proxy to look up) seeing anything. With the switch off, the fence's lists and every run are exactly as before. The live proof, with the Builder, the Art director and the Checker set up and the site kit installed, runs at go-live.
- A page can take a minute or more to be opened and photographed. Each version of a page costs the Builder a few minutes, and the job page says so.
- Chrome as installed on this Mac is part of what is trusted. If it is old, Health shows its version.
- The camera helper's risk, above, remains.
- The brand check's gaps, above, remain.

## Rejected

- **Chrome inside the fence.** It would need a patched fence tool (`0009`). Weakening the fence for one feature is the thing the engine never does.
- **`--no-sandbox`.** It would let Chrome start anywhere, and it is the flag that turns off the wall against a flaw in the renderer. Chrome's own sandbox is the second of two walls, and it stays on.
- **Request interception alone.** It is Chrome's own rule, kept by Chrome, and WebRTC traffic is not an ordinary request, so a page can go round it. The proxy is outside Chrome and decides what leaves it, so both are used, and the proxy does not depend on Chrome's good behaviour.
- **A library from the internet.** For the pages themselves (a grid, a lightbox, scroll effects) or for the viewer (a headless-browser driver). Each would put code the engine does not control next to a browser, and a page's own code could not be told from it. The viewer speaks to Chrome over the debugging pipe in its own code, and the site kit is our own few files.
