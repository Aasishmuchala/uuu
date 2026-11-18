# Building and upgrading the Astryx kit

For the owner or a later session. The kit in `astryx/` is built from a vendor folder, and the built files are committed. Nothing here uses the network: no command below downloads, installs or fetches anything. The decision and what was turned down are in `docs/adr/0019-pages-and-apps-from-a-design-system-kept-on-this-mac.md`.

Use Node 24, written `$N` here: `/Users/aasish/.nvm/versions/node/v24.13.0/bin/node` (the plain `node` on this Mac is broken). Run every command from the repository's top.

## The vendor folder

`/Users/aasish/astryx-vendor/node_modules` is the build's input. It is about 50 MB, it lives outside every repository, and it was put there once, by hand. It holds Astryx (`@astryxdesign/core` and `@astryxdesign/theme-neutral`, 0.7.16), React 19.3.1 and React DOM, their few dependencies (`scheduler`, `@stylexjs/stylex`, `styleq`, `intl-messageformat` and its three `@formatjs` packages) and `lucide-react`, the icon set.

Treat it as untrusted data. The build reads and hashes it, and the pinned bundler parses it. Nothing in it is imported, required or run: not a script, not a postinstall, not a plugin or a config. Never run `npm`, `pnpm` or the Astryx command-line tool in it or anywhere near it.

`inputs.lock.json` records a hash of every input package's files. A vendor folder that differs from it fails the build with the name of the package, so a changed copy cannot be built by accident.

The bundler is `engine/node_modules/@esbuild/darwin-arm64/bin/esbuild`, version 0.28.2, pinned in `engine/package-lock.json`. The build refuses to run with any other.

## The two commands

Each rewrites committed files. Read `git diff` after each one.

- `$N engine/astryx-kit/build.mjs --write --vendor /Users/aasish/astryx-vendor/node_modules` builds the kit, replaces `astryx/` whole, and writes `astryx.lock.json` (each file's size and sha256, each entry's exports, the addresses and calls found in the bundle), `tokens.json` and `inputs.lock.json`.
- `$N engine/astryx-kit/docs.mjs --write --vendor /Users/aasish/astryx-vendor/node_modules` makes the component pages by parsing the package's doc files as text (never running them), into `engine/playbooks/own/astryx/components/`, with the index `COMPONENTS.md`.

## The checks

- `$N engine/astryx-kit/build.mjs --verify` needs no vendor folder. Every file in `astryx/` is as `astryx.lock.json` lists it, and no file is missing or extra. A good result ends "as listed."
- `$N engine/astryx-kit/build.mjs --check --vendor /Users/aasish/astryx-vendor/node_modules` builds again into a temporary folder and compares it with what is committed. A good result is "Astryx kit: the build matches." The build comes out the same from any folder.
- `$N engine/astryx-kit/docs.mjs --check --vendor /Users/aasish/astryx-vendor/node_modules` does the same for the component pages.

The tests are in `engine/astryx-kit/test/`. They copy to a temporary folder and never write into the repository. The ones that need the vendor folder are skipped, with a plain reason, where it is not there.

## On an upgrade

1. Put the new packages in a new vendor folder, outside every repository (a download is the one step that needs the network, and it is done by the owner, not by anything in this repository). Keep the old folder until the new kit is committed.
2. Set the new versions in the list at the top of `build.mjs` (`PACKAGES`) and run `--write` for both commands, with `--vendor` pointing at the new folder. That makes a new `inputs.lock.json`.
3. Read the diff of `astryx.lock.json`, above all `addresses` and `calls`, before committing. A new address, or a new `fetch(`, `WebSocket`, `eval(`, `new Function` or `sendBeacon`, means the new code can reach further than the old, and must be understood first. The build fails outright on `googleapis`, `esm.sh`, `jsdelivr`, `unpkg`, an `@import` or a `url(` in the stylesheets; never loosen that to make a build pass. Check `LICENSES.txt` names every package that is in the bundle.
4. Run the tests: `$N --test --test-reporter=tap engine/astryx-kit/test/*.test.mjs`, then the end-to-end tests (`engine/test/astryx-e2e.test.mjs`, `engine/home/server/test/astryx-judge.test.mjs`, `engine/home/server/test/astryx-theme.test.mjs`, `engine/viewer/test/astryx-real.test.mjs`, `engine/apps/test/astryx-real.test.mjs`, `engine/playbooks/test/astryx-playbook.test.mjs`). They prove the example page still passes the brand check, the viewer and the judge of drawn colours, and that an app still draws the kit under the host's policy.
5. Update the pinned `addresses` and `calls` in the build test only with the diff in front of you, and commit the kit, the lists and the component pages together.
6. Going live with a new kit is the same separate step as the first time: run the playbooks installer on the live state, restart the home server, run the fence proof.
