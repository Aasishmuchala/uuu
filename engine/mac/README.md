# engine/mac: the Mac app's source

Company Engine, the home screen in one Mac window, in plain Swift on AppKit and WebKit, with no dependencies. Why it is
built this way, the rules it keeps and what a frame can do inside it: `docs/adr/0020-a-mac-app-outside-the-fence-that-shows-one-address.md`.
How the owner installs and uses it: "The Mac app" in `engine/README.md`.

Everything here builds with the Command Line Tools alone (no Xcode). `swift test` does not work without Xcode, so the
checks are a plain program instead.

## Layout

```
Package.swift      swift-tools-version 6.0, macOS 14, no dependencies, Swift 5 language mode
VERSION            one line; see "The version rule"
build.sh           makes the signed .app
check.sh           builds everything, runs the checks, then the source rules
version-rule.sh    any change under Sources needs a higher VERSION; nothing under Sources hidden from git
source-rules.sh    the forbidden words and the one loopback literal, over the app's sources
Resources/         Info.plist.in, AppIcon.icns, icon-1024.png (cut from the loft photograph)
Sources/EngineShell/      library: Web/ (HomeOrigin, NavigationPolicy, WebGuard, WebViewFactory, RuleList),
                          Engine/ (EngineSwitch, EngineCommand, EngineRoot, EngineEnvironment, Poller, ShellStatus),
                          Native/ (pure rules and the fixed words), Build/BuildConstants.swift (generated, ignored)
Sources/CompanyEngine/    the app: main.swift and its controllers
Sources/WebKitProbe/      webkit-probe, a test program; never in the bundle
Sources/EngineMacChecks/  engine-mac-checks, the checks program
harness/           WebKit pictures and the frames trial (test tools; nothing is served by the engine)
```

All logic that can be judged without a window lives in `EngineShell`, so the checks reach it. Two values carry the
safety of the app; keep them that way:

- `HomeOrigin` is the one address. Its only maker is `HomeOrigin.local(port:)`, and `HomeOrigin.swift` is the only
  file in `EngineShell` and `CompanyEngine` that writes the loopback address. `main.swift` makes it once from
  `BuildConstants.homePort` and hands it to every controller.
- `EngineSwitch` is the only way to the engine's script. `main.swift` makes one `LocalEngineSwitch`; no controller
  names `EngineCommand` or `EngineRoot`.

## Build

```
./build.sh --dev --origin-port <3300-65535> --out <folder>
./build.sh --install [--engine-root <absolute path>]
```

- `--dev` makes `<folder>/Company Engine Dev.app` (bundle id `local.uuu.company-engine.dev`) for a test home screen on
  the given port. The port may not be under 3300 or one of 5000, 5432, 7000, 8120: the live engine uses 3100 to 3299
  and those. A development build has no engine folder, so it can never start or stop an engine, and its web view can be
  inspected.
- `--install` makes `~/Applications/Company Engine.app` (bundle id `local.uuu.company-engine`) for port 3200, with the
  checkout holding this script compiled in as the engine's folder. It refuses while `engine/mac` has changes that are
  not committed. Installing is an owner's step: no builder runs it.

It writes `Sources/EngineShell/Build/BuildConstants.swift` (port, engine folder, flavour, version, build number), runs
`swift build -c release --product CompanyEngine`, puts the bundle together, signs it on this Mac with the hardened
runtime (`codesign --sign -`), checks the signature and prints the app's path last. The build number is
`git rev-list --count HEAD -- engine/mac`.

Several builders share `.build/`. If `swift build` fails in a file that is not yours, wait and try again.

## Check

```
./check.sh
```

1. Writes a development `BuildConstants.swift` if `build.sh` has not run.
2. `swift build -c release` (every product), then `.build/release/engine-mac-checks`: one line per check, the last
   line `checks: <n>, failed: <m>`, exit 1 when m > 0. The checks are named by area: `nav:` (where the web view may
   go), `web:` (the web view's settings), `origin:` (`HomeOrigin.url`), `env:` (the seven keys and the fixed PATH),
   `run:` and `switch:` (running the engine's script), `root:`, `poll:`, `rules:` (the rule list), `name:` and
   `title:` (cleaning a download's name and the window title), and the native rules and words (`badge:`, `notify:`,
   `awake:`, `words:` and others).
3. The source rules (`source-rules.sh`), over `Sources/EngineShell` and `Sources/CompanyEngine`: no script bridge, no own URL scheme, no
   HTML string or local file loaded, no reading of the environment, no state folder, secret or login file named; and no
   loopback address literal outside `HomeOrigin.swift`.
4. `version-rule.sh`, last.

A check is a plain function in `Sources/EngineMacChecks/`; add new ones to the file for its area.

## The version rule

Any change under `Sources` needs a new `VERSION`, because the installed app is rebuilt only when its version changes
and compares itself with the repository's `VERSION` at launch.

`version-rule.sh` (no arguments, works from any folder, exit 0 or 1):

- `VERSION` must be one line of two to four numbers (`1.0.4`) and nothing else; otherwise exit 1. `build.sh` and
  `check.sh` read it the same way, because it is written into Swift source and `Info.plist`.
- A file git ignores anywhere under `Sources` (by `.gitignore`, `.git/info/exclude` or any other rule) fails, except
  the generated `Sources/EngineShell/Build/BuildConstants.swift` (and `.DS_Store`). `.gitignore` names `/.build/`
  and `/out/` at the top of this folder only.
- The mark is the last commit that changed `VERSION`, asked from inside this folder. No mark: exit 0.
- "Sources changed" means the working tree's `Sources` differs from the mark (committed or not), or `Sources` holds a
  new file git does not ignore. The generated `BuildConstants.swift` is ignored, so it never counts.
- If Sources changed and the working tree's `VERSION` is not higher than at the mark (numbers compared part by part),
  it prints `check.sh: Sources changed since VERSION last changed. Bump VERSION.` and exits 1. Otherwise 0.
- `build.sh --install` runs it too, before it builds. Its cases are checked by `engine-mac-checks` (`version-rule:`).

It judges the working tree, so a raised `VERSION` passes before anything is committed. Builders do not edit `VERSION`:
the orchestrator raises it once for each wave of work that changes `Sources` and commits it with that wave.

## The harness

Test tools only. Nothing here goes into the app or is served by the engine. Each takes the browser lock (one hidden
browser at a time), refuses below 20 percent on battery, starts its own test home screens on free ports from 3300 up,
never touches the live engine's ports, and writes pictures and reports to
`/Users/aasish/uuu/.router/evidence/mac` (git-ignored).

- **`webkit-probe`** (`swift build -c release --product webkit-probe`): opens one page of a test home screen in the
  app's own web view (`WebViewFactory.make(home:role: .probe)`), off screen, and writes a JSON report and a picture.
  Its options and its report: `harness/README.md`.
- **`harness/run-webkit.mjs --round <r> [--only <regex>]`**: one round of pictures of every shot in
  `harness/shots-webkit.json`, at 1280 and 390 wide, dark and light. It reuses the cook harness's scenes without
  changing them and adds its own under `harness/scenes/` (the Brain pages, App Studio with an Astryx app).
- **`harness/frames/run.mjs`**: the frames trial. What a page inside App Studio's frame can do in the app's web view,
  before the rule list and with it, one line per attempt (`blocked`, `allowed-by-design` or `STILL GETS OUT`). Exit 1
  when anything that must be blocked is not. See `harness/frames/README.md`.

Run them with `/Users/aasish/.nvm/versions/node/v24.13.0/bin/node` (the bare `node` on this Mac is broken).

## Rules for changing this app

- Every new owner-facing sentence is fixed text in `Sources/EngineShell/Native/Words.swift` or `Engine/EngineWords.swift`,
  agreed first. The native side never shows text from the server, except the page's title (cleaned) and a page's
  `alert` text (cleaned, under its own heading).
- No bridge between the page and native code, no third-party package, no outside network call, no reading of the
  environment. The source rules in `check.sh` hold the first and the last; review holds the rest.
- The engine's script is run only through `EngineSwitch`, with the seven-key environment of `EngineEnvironment`.
- A new address the web view may load is a change to `NavigationPolicy`, `RuleList` and the ADR together.
