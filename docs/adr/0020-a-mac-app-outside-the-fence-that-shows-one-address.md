# 0020: A Mac app, outside the fence, that shows one address

## Context

Until 17 November 2026 the home screen was a page in the owner's own browser. A browser tab cannot show a count on the Dock, tell the owner that something needs him while the tab is closed, keep the Mac awake while agents work, or start the engine that serves it. On 17 November 2026 the owner said: "then make our entire app into a mac app". Of the three ways offered he first chose a Mac app with a second tool, ThreeRT, to make path-traced still pictures of the 3D building.

On 18 November 2026 the owner chose photographs over 3D for the Map and the room headers (`pages/map.js`): no three.js, no WebGL. So the ThreeRT half of the first plan was dropped. Nothing of it was built, and nothing in the app draws in 3D.

The change is the owner's to make. Every other rule stands: this Mac only, the fence is never loosened to make something work, and what runs unfenced never trusts what agents, apps or pages can write (`0007`).

The app runs as the owner, outside the fence, and shows pages that hold text agents wrote. The question is what the most hostile page, or the most hostile app inside App Studio's frame, can make the app do.

## Decision

A small Mac app, "Company Engine", written in plain Swift on AppKit and WebKit with no third-party code. It is one window with one web view that shows the home screen, plus the few things a page cannot do: the Dock icon and its count, a menu bar item, a notification that says only a count, keep-awake, the engine's switch, the menus, the panels for uploads and downloads, and a native page shown while the home screen is off. Every screen stays a web page. No screen has a native copy.

The source is `engine/mac/`. `engine/mac/build.sh --install` makes `~/Applications/Company Engine.app` (the owner chose this user's folder, not `/Applications`). It is signed on this Mac only, with the hardened runtime, no entitlements and no App Store.

### The rules it keeps, as built

1. **One address.** The web view's top page is only ever `http://127.0.0.1:3200`. The address is one value, `HomeOrigin`, whose only maker is `HomeOrigin.local(port:)`: http, `127.0.0.1`, the port compiled in. It has no public initialiser, and the loopback address is written in one file (`HomeOrigin.swift`); `check.sh` fails if it is written anywhere else. No flag, environment variable, preference, link or file changes it while the app runs. A development build takes a port from 3300 to 65535 instead, never one of the live engine's.
2. **Frames.** The only frames allowed are App Studio's apps, `http://127.0.0.1:3171` to `3189`, inside the home screen's page. An app's frame may move itself only within its own port; a move from one app's page to another app's port is dropped, so one app cannot show another's page under its name. The home page may open any app. The frame's `sandbox`, `allow` and `referrerpolicy` in `pages/app.js` and the server's content policy are not changed by the app.
3. **No bridge.** The app has no message handler, no injected script, no script run in a page, no own URL scheme, and loads no HTML string, data or simulated answer as a page, and no local file. `check.sh` (through `source-rules.sh`) fails if any of these words appears in the app's source; only the generated `Sources/EngineShell/Build/BuildConstants.swift` is left out, by its full path, never by name. Nothing a page or an agent writes can call native code. What the app needs from the engine it reads itself from `GET /api/shell`.
4. **Leaving the app.** Another address opens in the default browser only after the owner's click, only for `http` or `https` with a host, no user name or password, and at most 2,048 characters. Everything else is dropped. A page that moves itself somewhere else without a click is dropped and opens nothing. The address is judged on its parsed parts (`http`, the host exactly `127.0.0.1`, the port), never by matching text.
5. **The engine's switch.** The app runs exactly `/bin/bash <checkout>/engine/bin/engine start`, `stop` or `status`, and nothing else. The word is a fixed choice of three; no text from anywhere reaches the command. One run at a time, with a time limit (10 minutes to start, 3 to stop, 1 for status) after which that one process is ended. It keeps the last 200 lines the script printed, each cut to 500 characters, shown as plain text. The environment is built from nothing: seven keys (`PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `SHELL`), so no key, no engine setting and no library preload of the owner's shell reaches the engine. `HOME` and `USER` come from the user database by user ID and `TMPDIR` from the system's own temp folder, never from the app's environment (`CFFIXED_USER_HOME` or `TMPDIR` set at launch would otherwise move the engine's state folder). The script's output goes to an unlinked file of its own, not a pipe, so quitting the app in the middle of a start does not kill the script half way: it runs to its end and the engine is not left half on. It never runs `prove`, `setup`, `test`, git or node. All of this goes through one `EngineSwitch`; no window or menu names the script.
6. **Hostile text.** Everything from the server is treated as written by an agent. The native side shows only its own fixed sentences and numbers. The window title is the page's title as plain text, cut to 80 characters (and 240 Unicode scalars, so stacked marks cannot pile up), with control, direction-changing and invisible characters removed (line and paragraph separators, zero-width space, byte order mark, soft hyphen, tag characters and the like). A notification carries no server text. A download's name is cleaned (no folders, no hidden name, no name that would run, install or open a link when opened, such as `.app`, `.command`, `.jar`, `.mobileconfig`, `.url`, `.py` or `.iso`, without `.txt` added) and always goes through the save panel.
7. **Files.** The app reads its own bundle, runs `<checkout>/engine/bin/engine`, and reads the one line of `<checkout>/engine/mac/VERSION`. It writes its own preferences, WebKit's own data folder for the app, and a download only where the owner's save panel says. It never opens the engine's state folder, a secret, a login file, a `.env` or a database.
8. **Money and safety words** are shown as the server sent them, inside the pages. No native control spends, approves, accepts or opens a door. Every decision stays a click in a page.
9. **No outside call from the app.** No update check, no crash reporter, no analytics, no fraud-site look-ups, no link previews. The only network peer of the native code is the home screen.

### The poll (no bridge)

The Dock count, the notification and keep-awake come from the native side asking `GET /api/shell` itself: every 20 seconds while the window is open, every 30 seconds while it is closed, with no cookies, no cache, no proxy, no redirect followed, a 5-second limit and the answer cut at 1 MB. It reads two numbers (`counts.needsYou`, `counts.running`, each a whole number from 0 to 100,000) and three state words (`engine.board`, `books`, `gate`). Every other field is ignored and never kept. A redirect or an answer from another address counts as "down".

### Quitting never stops the engine

Quitting the app, or closing its window, leaves the engine as it was. "Stop the engine…" is its own menu item and asks first ("Turn the engine off?"). The app never starts the engine by itself, at launch or at login: while the home screen is off it shows its own off page with a "Start the engine" button. "Open Company Engine at login" opens the app only, is off until the owner turns it on, and exists only in the installed build. The owner chose not to start the engine at login.

### Where the engine is

The checkout the app runs is compiled in by `build.sh --install`. A development build has none: its Start, Stop and "Engine status" are greyed and it says "This is a development build. It cannot start or stop the engine." At every use the installed app checks the compiled folder: an absolute path, no hidden folder in it (so never the engine's state folder), not under a temporary folder, a real folder of the owner's that no one else can write to, in a folder of the owner's (or the system's) that no one else can write to (so the checkout cannot be renamed away and another put in its place), holding `engine` and `engine/bin` as real folders and `engine/bin/engine` as a real file, none of them a link, all of the owner's and none that anyone else can change. The script that runs is exactly `<checkout>/engine/bin/engine` with no link on the way. If anything fails, Start and Stop are greyed with one sentence: "This app cannot find the engine it was built for. Rebuild it: engine/mac/build.sh --install". This keeps a development build, or a copy of the repository, from ever starting a second engine over the live state.

### The engine's PATH when started from the app

The app gives the engine one fixed `PATH`, built from nothing, never read from the owner's shell (the owner said yes to this line on 18 November 2026):

`/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`

- `/usr/local/bin` is first, as in the owner's terminal, so `python3` and the others are the same programs whichever way the engine was started. It belongs to the system's administrator account.
- `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin` are the system's own tools (`curl`, `lsof`, `jq` and the rest).
- `/opt/homebrew/bin` is last. Agents need `rg` and `gh` from it, as they have them when the engine is started from a terminal. It is a folder this user can write to, so it comes after every system folder and can never stand in front of a system tool.
- Left out on purpose: `~/.local/bin`, where the real, unfenced `claude` lives; Node 22; and every other folder of the owner's shell.

The board still puts the fence's `claude`, `codex` and `git` first and refuses to start if they are not the ones it finds (`engine/parts/20-board.sh`), so nothing in this line can stand in front of them. Only the board passes its `PATH` on to agents; the other parts call their programs by full path.

### A second fence inside the web view

Every web view the app makes carries a WebKit rule list: it blocks every load, in every frame, then lets through only the home screen's own address, App Studio's addresses (`127.0.0.1` ports 3171 to 3189), and the `blob:` addresses those pages make for themselves (which never leave the Mac). The list's shape (`Rules.json`) names no host; the addresses are filled in from `HomeOrigin`, so the only host it can ever name is `127.0.0.1`, and a check says so. This is stricter than a browser can be. It is a second fence, not the first: the frame's sandbox, App Studio's headers and the app's own navigation rules all stay. If WebKit ever could not build the list, the web view keeps only the first fence and a log line says so.

### What a page in App Studio's frame can do inside the app, as measured

Measured on 18 November 2026 on this Mac (macOS 27, WebKit 22625) by the frames trial (`engine/mac/harness/frames/`): a stand-in home screen framed a stand-in app with exactly the frame attributes of `pages/app.js` and App Studio's own headers, and an attack page in the frame tried 44 things, before the rule list and with it. "Outside" was another port on this Mac standing in for the internet; nothing left the Mac.

| What the frame tried | Before the list | With the list |
|---|---|---|
| Read the home page or its address | blocked | blocked |
| Move the home page (`top.location`, `parent.location`, a link or form to `_top`, with or without a click) | blocked | blocked |
| Open a window, with or without a click | blocked | blocked |
| `alert`, `confirm`, `prompt` | blocked | blocked |
| Camera, microphone, screen, location, pointer lock, reading the clipboard | blocked | blocked |
| `fetch`, a picture, a WebSocket, server events, a beacon, a prerender or prefetch link, a service worker, to an outside address | blocked | blocked |
| A preconnect link to an outside address | **still gets out** | blocked |
| WebRTC (a STUN packet to an outside port) | **still gets out** | **still gets out** |
| The brain door (a stand-in for port 3190) and the home's own `/api/brain/find`, by `fetch`, picture and WebSocket | blocked | blocked |
| Its own cookies and storage, `fetch` to its own address, its own service worker, pictures it made itself | allowed by design | allowed by design |
| A download (the save panel asks the owner), full screen (the film player), writing to the clipboard, after a click | allowed by design | allowed by design |

Two more things measured: a cookie the frame sets is seen by the home page, because cookies do not separate ports on one host (the same is true in any browser); and WebKit sends `Sec-Fetch-Site` on the frame's first request (`same-site`, `iframe`), which App Studio's host accepts, so the host needed no change. An app built on the Astryx kit drew in its frame with the list on, with no console error.

So inside the Mac app an app's page cannot reach the internet by ordinary requests, which is stricter than a browser. WebRTC remains: a rule list does not see it, and no public WebKit setting closes it. The sentence App Studio shows ("Its page runs in your browser, and a page in your browser can still reach the internet") is left as it is everywhere, by the owner's choice on 18 November 2026: it errs on the safe side, and the same app may be opened in a browser too.

### A further unfenced reader, with one narrow rule

`0007` says that anything that runs unfenced treats what agents can write as hostile, with one narrow rule for each place. After the page viewer (`0015`), App Studio's host (`0016`), the brain door (`0018`) and the parts that read the Astryx kit (`0019`), the Mac app is one more. Its one narrow rule: **it shows one address, runs one script with three words, and reads two numbers and three state words.** Nothing else from the engine reaches native code.

### What a remote client would need

Nothing here is built for another computer, and nothing is promised. Later, for a Windows client or several logins, these would be needed, and each is a server change first:

- **TLS.** Today the address is plain http on this Mac's own loopback; across a network it would have to be encrypted.
- **A login the poll can carry.** The poll sends no cookie today, and the home screen has no sign-in of its own.
- **No engine switch.** A remote client could not start or stop the engine; it would show that as a development build does today, with its own sentence.
- **No keep-awake.** That only makes sense on the Mac that runs the engine.
- **App Studio's frames on another host,** which the frame rules, the rule list and App Studio's host all assume are on `127.0.0.1` today.

The app is ready for that without being changed now: the address is one value (`HomeOrigin`), so a remote address would be a new maker and a new review; and every engine action goes through one `EngineSwitch`, whose "cannot start or stop" state already exists.

### What "the owner's click" means (accepted, M15's L1)

"A click" in rule 4 is WebKit's link activation (`WKNavigationType.linkActivated`). Script on the home page itself can activate a link without a real click (`a.click()`, a dispatched mouse event, a `download` link to another host), and that address then opens in the default browser like a clicked one. This is accepted, not fixed: only script on the home screen's own origin can do it (an App Studio frame cannot move or open anything; M8's trial measured that with real clicks, and `window.open` or `_blank` without a gesture opens nothing); that script is the engine's own pages, which could equally put a link in front of the owner; what opens is still only an `http` or `https` address, checked as in rule 4, in the owner's own browser and nowhere inside the app. Telling a real click apart would need WebKit's private `_isUserInitiated` or a measurement of `buttonNumber` with real mouse and keyboard input, which the checks cannot make; a private call in an unfenced program is a worse trade than this gap. Revisit if the home screen ever shows a page whose script is not the engine's own.

### Version and rebuild

The pages are served live by the home screen, so the app is rebuilt only when `engine/mac/` changes. `engine/mac/VERSION` holds its version. Any change under `engine/mac/Sources` needs a higher VERSION; `engine/mac/version-rule.sh`, run by `check.sh` and by `build.sh --install`, fails otherwise. VERSION is one line of two to four numbers (`1.0.4`) and nothing else, in all three scripts, because it is written into the app's source and `Info.plist`. Nothing under `Sources` may be hidden from git: the build folders are ignored only at the top of `engine/mac`, and a file git ignores anywhere under `Sources` (other than the generated `BuildConstants.swift`) fails the rule, so a file name alone cannot get code into the app past a review. When the repository holds a newer version than the installed app, its menu says "A newer version of this app is in the repository. Run: engine/mac/build.sh --install".

## Consequences

- One more program runs as the owner, outside the fence. A flaw in it would be a flaw in the engine, so it is small, has no dependencies and no bridge, and is reviewed as a whole before it is installed.
- Its checks run without Xcode: `engine/mac/check.sh` builds everything and runs a plain checks program (navigation verdicts, the seven-key environment, the poll's parsing, the rule list, the native rules and words), then the source rules.
- Testing in WebKit uses the app's own web view, made by the same factory, through a small command-line program, `webkit-probe`, and a picture harness (`engine/mac/harness/`). The probe may run script in a page; it is never put into the app. To draw a page from a window off every screen, the probe turns off one WebKit test switch (window occlusion) for its own web view only; the app does not use it.
- The app keeps its own website data. The look chosen in Chrome is not carried over.
- WebRTC from an app's page still gets out, as in a browser. Turning an app on is still the owner's yes to that (`0016`).
- Nothing of this is live yet. It is built and checked on `build/v5-mac`. Installing it is a separate step after the security review and the owner's yes; the first real `status` from the app is compared line for line with `engine/bin/engine status` from a terminal before Start is ever pressed in the app.

## Rejected

- **A bridge between the page and native code**, even with a list of allowed messages. Any handler is reachable from a page that shows text an agent wrote. The poll costs one small request and needs nothing from the page.
- **Several windows.** Several polling pages on 16 GB, and two places to answer one item. Outside links, an app's own window and a site preview go to the default browser.
- **Safari's WebDriver for testing.** It needs the owner's password and a Safari setting, takes a visible Safari window, and tests Safari's settings rather than the app's. The app's own probe tests the web view that ships.
- **An address that can be set** (a flag, a preference, an environment variable). It would break the one-address rule for no one who needs it today. A remote address later is a new maker and a new review.
- **The owner's shell PATH.** It would let an environment nobody reviewed reach every agent, and the real, unfenced `claude` is on it.
- **ThreeRT for still pictures.** The owner chose photographs; nothing would use the pictures.
- **SwiftUI, Electron or Tauri.** SwiftUI brings macros the Command Line Tools cannot build without Xcode; Electron and Tauri are a download, and Electron is Chrome, which was not the choice.
