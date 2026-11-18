# 0019: Pages and apps are made with a design system that is kept whole on this Mac

Number 0018 is on another branch (`build/v5-brain`) and is not reused here.

## Context

On 18 November 2026 the owner asked that the end products the engine's agents make (sites and apps) be built with Meta's Astryx design system. The change is the owner's to make. Every other rule stands: this Mac only, nothing is downloaded by a page, the fence is never loosened, and what runs unfenced never trusts what agents can write (`0007`).

What was found while reading the package and this Mac (the plan, `.router/PLAN-ASTRYX.md`, has the numbers):

- **React 19 ships as CommonJS only.** A browser cannot load it through an import map as it is. A service such as esm.sh converts it; here the same conversion has to be done locally.
- **Astryx's `dist/` is 1,195 files and 9 MB.** A site may hold 300 entries, so the unbundled package cannot ride inside a site.
- **The docs are not in the docs script.** `docs.mjs` of the package only says "run the Astryx command-line tool". The real docs are 267 files, each a JavaScript module with object literals in it. Reading them by running them would put the package's code on this Mac outside the fence.
- **The theme names Figtree and loads it from Google Fonts**, with one `@import` of an outside address. A page that did so would break `0015` (a page reaches only itself) and the brand kit's law (`0011`) that the faces are the owner's.
- **The brand check reads every `.css`, `.js` and `.mjs` of a site as the maker's own text.** The kit's files would fail every rule (a colour that is not a token, a face that is not the kit's, text under the smallest size, an address outside the site) and the size cap.
- **The home server judges what Chrome drew.** Every drawn colour must be a brand colour within 2 a channel (or a grey, where the kit allows greys), every face the kit's, no text under the smallest size. A theme made from the brand kit has to satisfy that judge, not only look right.
- **App Studio's policy is `script-src 'self'`**, with no inline script. An inline import map is refused there, so an app has to import by relative path.

A bundler is already on this Mac, pinned in `engine/package-lock.json`. A trial build with it gave 45 files and 2.5 MB, rendered under the exact site policy from a local address, and made 38 requests, every one to the page's own address.

## Decision

Thirteen decisions, in plain words.

1. **The kit is built once, with the pinned bundler, and committed to the repository** at `engine/astryx-kit/astryx/` (50 files, 2.8 MB). The vendor folder (`/Users/aasish/astryx-vendor/node_modules`, about 50 MB, outside every repository) is the build's input and is never needed again at install or at run time. `inputs.lock.json` records a hash of every input package, so a changed copy fails the build.
2. **The bundle is split into six entries and shared parts**: React, React DOM, its client, the JSX runtime, the Astryx components and the neutral theme's code. One React serves all of them. The React entries are written by the build script from the names in the package's production file, because the bundler gives a CommonJS module a default export only.
3. **A site carries the kit.** A folder `astryx/` at the site's top is copied whole and unchanged from the playbooks folder, as `kit.css` is. A site stays one folder that runs anywhere (the export zip, the owner's preview, the viewer) with no server change.
4. **The page's own code uses an import map and `React.createElement`**, written `h(...)`. The import map is inline in `index.html`, word for word from the kit's `importmap.json`. There is no JSX and no `htm`: nothing compiles the page.
5. **An Astryx page keeps a written shell.** `index.html` holds the header with the logo `<img src>` and a `<main data-astryx-root>`; the script draws inside that. The brand check's logo rule and the words rules keep working on the HTML.
6. **The brand theme is a file the home server writes**: `brand/astryx-theme.css`, beside `kit.css`, on every save of the brand kit and at start when it is missing or stale. The Builder copies it byte for byte. It is unlayered, so it wins over the kit's own theme layer, and it sets every colour, the three faces, the sizes and the radii, with `color-scheme: light`. The brand kit is still the law (`0011`): the theme is made from it, by the home server, and every colour it gives passes the judge of drawn colours.
7. **The brand check passes over the kit by hash**, as it does `kit.css`. A file under `astryx/` must be in the kit's list with the same sha256, or it is a hard line (`kit_file_changed`); `astryx-theme.css` must equal the brand folder's. Everything the maker wrote is still read by every rule, and on a site with `astryx/` the strings of the maker's own scripts count as the page's words. This is the same reasoning as `0007`: a site is an agent's folder, so the check trusts a hash, never a name.
8. **The docs are parsed, never run.** A small walker over the text turns literal values into data and refuses anything else. The output is Markdown in an own playbook, `astryx` (267 component pages, an index and the licence), so the installer needs no new rule for it.
9. **The viewer waits for the drawn page, with a bound.** When the page has an element with `data-astryx-root`, the viewer waits up to 2,000 ms after the load event for that element to have a child, and says `drawn_late` if it had none. A page without that element is waited for no longer than before, and nothing a page does can stretch the wait. The viewer's policy, proxy, hosts list and limits do not change (`0015`).
10. **Apps: proof and words, no host change.** An app copies `astryx/` into its client folder and imports by relative path. A test proves the kit draws under the host's exact policy, and that an inline import map is refused there. The host's policy is unchanged (`0016`).
11. **The old site kit stays as it is.** Its files, installer rule, role text and tests are untouched; a site with no `astryx/` folder is judged as before, and a test pins the old kit's hashes.
12. **The Builder's rules are one marked block** in `builder.md`, between `<!-- astryx:start -->` and `<!-- astryx:end -->`, above the heading "Rounds, the cook way", so the branch that edits other parts of that file merges with it cleanly. No existing line changes, and its tests are a file of their own.
13. **Licences are in one file**, `astryx/LICENSES.txt`: each package's name, version, licence and the full text. For the two packages that ship no licence file (`@astryxdesign/core` and `@stylexjs/stylex`, both Meta's and MIT by their `package.json`), the text of the theme package's licence is used, and the file says so in so many words.

### What does not change

`SITE_POLICY`, `SITE_LIMITS`, the file types of `engine/viewer/sitefiles.mjs`, the viewer's proxy, and the host's content policy in `engine/apps/host.mjs` are not changed. The page still reaches only itself (`0015`). The kit names no address a page loads: the addresses that remain in the bundle are namespace names and error-page text, listed and pinned in `astryx.lock.json`, and the one `fetch(` in it is listed there too, so an upgrade that adds another fails a test.

## Consequences

- **What is given up.** One palette: the brand kit has one ground and one ink, so an Astryx page has no dark variant. Status colours follow the brand kit: an error is not Astryx's red, nor a success its green, but the kit's colours or greys. A site is about 3 MB heavier, because it carries the kit.
- A new site is made with Astryx by default. The old kit stays for sites already made with it; going back is one sentence in the Builder's block.
- The kit is only as current as the last time it was built. An upgrade is a deliberate act with a new vendor folder (see `engine/astryx-kit/BUILDING.md`), and the diff of the pinned addresses and calls is read before it is committed.
- Nothing of this is live yet. It is built and tested on `build/v5-astryx`. Going live means running both installers on the live state, restarting the home server so it writes the theme, and running the fence proof; that is a separate step after the owner has read the review.
- An app that wants a real red for an error cannot have it yet. That is a question for when the first Astryx app is planned (a named pair of status colours in the brand kit would be the clean way).

## Rejected

- **A CDN, or a service such as esm.sh.** A page would load outside code from an outside address, which `0015` forbids, and the page would stop working with no network.
- **Google Fonts.** The theme's one `@import` is never copied. The faces come from the brand kit.
- **The Astryx command-line tool.** It is an installer and a fetcher; nothing here may run or download one.
- **Running the package's docs script.** It holds no docs, and running any of the package's own code is what decision 8 avoids.
- **Building at install time.** The live Mac would need the vendor folder and a build tool at every install.
- **Hand-wrapping the CommonJS without a bundler.** 1,195 files would still be over a site's limit.
- **One big file with hand-written shims.** The lazy parts of Astryx would load at once.
- **The viewer and the home server mounting the kit at a reserved path.** Three servers to change, and an exported zip that does not run. A page that carries its kit needs none of it.
- **`htm`.** The only copy on this Mac is bound to Preact, and the plain package would be a new download. `h(...)` is what the package's own no-build page uses and needs nothing new.
