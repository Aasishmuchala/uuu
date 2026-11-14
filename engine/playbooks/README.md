# The playbooks

A playbook is craft advice an agent reads before a kind of work: how to write a post that sells, how to lay out a carousel, how to light a render, how to cut a film, how to build a page that does not look machine-made. They are your own skill folders on this Mac (`~/.claude/skills/`), copied into the engine's state folder, where every agent may read them and none may write them.

The repo holds `manifest.json`: which playbooks, which of their files, for which roles and kinds of work, and a short note per playbook in our own words. No third party's text is in the repo, which is on GitHub. The one exception is the owner's own, `own/render-to-film/SKILL.md` (see "Own playbooks"). Some playbooks are a third party's work; they are read here on your Mac only, with their licence beside them.

## Commands

- `engine/playbooks/install.sh`: copies the files the manifest names into `state/playbooks/<name>/`, writes the note beside each, and writes `state/playbooks/index.json`. Prints one line per playbook. Safe to run again: a copy that is already right is left alone, file for file.
- `engine/playbooks/install.sh --check-only`: `Playbooks: <n> installed` (exit 0) or `Playbooks: not installed` (exit 1).

## What is copied, and what never is

- Only the files the manifest names, by name or by a `*` pattern inside one folder, ending in `.md`, `.txt` or `.json`. A licence file (`LICENSE`, `NOTICE`, `COPYING`) is kept beside a third party's copy.
- Never a whole folder, never `scripts/`, `site/`, `.venv`, `node_modules` or `tests/`, never a program, a picture or a font. The manifest is refused if it names one.
- At most 512 KB a file and 20 MB in all. A larger file is skipped and said; over 20 MB in all, nothing is changed.
- A link that leaves its playbook's folder is skipped and said. A link that stays inside is copied as the file it points at.
- A skill folder that is not on this Mac is one plain line; a copy installed earlier is kept. Nothing is downloaded.
- A playbook the manifest no longer names is removed. A folder in `state/playbooks/` the installer did not make is left alone and said.

## The note

Each copy holds `IN-THIS-ENGINE.md`, written from the manifest's `note`. An agent reads it first, then `SKILL.md`, then only the reference files it is sent to. The note says which parts to use for which work here, and what to do instead where a playbook assumes something an agent here does not have:

| The playbook assumes | An agent here |
|---|---|
| a browser | asks the page viewer when it is on, else says it could not look |
| the internet | reads the Researcher's notes in `$UUU_RESEARCH_DIR` |
| Runway, Higgsfield or another paid tool | uses the generation door when it is on, else stops and says so |
| an install | never installs |

It also says where the playbook meets the engine's own tools: the brand kit outranks any colour, typeface or logo a playbook suggests; the slide and video tools make the pieces; the brand check runs before anyone reviews.

## Own playbooks

A playbook whose `source` is `own:<folder>` is read from `engine/playbooks/own/<folder>/` in the repo instead of from `~/.claude/skills/`. It is the owner's own work written for this engine (today `render-to-film`, the recipes of the Render to Film app, for the Artist). Only `.md` files are copied; `<folder>` is plain lower-case letters, numbers and dashes, so `own:../x` is refused; the folder must be a real folder, and a link leaving it is skipped and said. The installer only reads it and never removes it.

## The manifest

`manifest.json`: `{ "version": 1, "playbooks": [ { "name", "source", "origin", "licence", "files", "licenceFiles", "roles", "kinds", "note" } ] }`. `name` is plain lower-case letters, numbers and dashes (at most 40). `source` is `~/.claude/skills/<folder>` or `own:<folder>`. `origin` is `own` or `third-party`. `kinds` are the engine's kinds of work: `post`, `newsletter`, `carousel`, `poster`, `title-card`, `film`, `page`, `still`. A third party's playbook names its licence file in `licenceFiles`, or its note says no licence file was found.

To add a playbook: read its `SKILL.md`, name only the reading files it needs, write the note in your own words, then run the tests and the installer.

## What it puts where

| Path | What |
|---|---|
| `state/playbooks/<name>/` (0755, files 0644) | the named files, `IN-THIS-ENGINE.md`, and the licence file for a third party's work |
| `state/playbooks/index.json` (0644) | one row per installed playbook: `name, origin, licence, roles, kinds, files, bytes` |

## Tests

`$N --test --test-reporter=tap "engine/playbooks/test/*.test.mjs"`. They build a made-up skills folder and a made-up state folder in a temp directory (`ENGINE_PLAYBOOKS_SOURCE`, `ENGINE_PLAYBOOKS_OWN` and `ENGINE_PLAYBOOKS_DEST`, for tests only), and check the real manifest's rules.
