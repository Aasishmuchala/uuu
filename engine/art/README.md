# The Artist's tools

The Artist draws sprites, small animations and simple images: it writes a short drawing script and gets back a sprite sheet, its frame data, a GIF, or a vector image. These are the tools it needs, installed in the engine's state folder (`state/art/`), not in the repo and not in your own Python.

## Commands

- `engine/art/install.sh`: installs or finishes installing the tools. Safe to run again. Prints free disk and the size of `state/art` at the end.
- `engine/art/install.sh --check-only`: `Artist's tools: installed` (exit 0) or `Artist's tools: not installed` (exit 1). `engine setup` prints this line.
- `engine/art/fence-check.sh`: checks the sprite helper works inside the fence with an Artist-like policy, and that a fence without that policy cannot read `state/art`. Uses the proof's fixed agent id for a moment and removes its policy afterwards; it stops with a plain line if that policy is already there (the fence proof is running).
- Tests: `~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_*.py'` (skipped with a message when Pillow is not there). `engine test` runs them too, with the Mac's own Python.

## Versions (checked 11 November 2026)

- **Python 3.14** (3.14.3 installed), the same Python the Drafter uses.
- **Pillow 13.0.0**, which has a ready-made wheel for this Mac (arm64) and Python 3.14 (checked with `uv pip compile --python-version 3.14 --python-platform aarch64-apple-darwin --only-binary :all:`). Nothing is built from source, and Pillow needs nothing else.
- Both versions are pinned at the top of `install.sh`. To move to a newer Pillow, check its wheels the same way first.

## What it puts where

| Path | What |
|---|---|
| `state/art/python/` | the Artist's own Python, fetched by `uv` (`UV_PYTHON_INSTALL_DIR`). The fence hides your home folder, where `uv` keeps its Pythons, so the Artist needs one inside state. |
| `state/art/venv/` | Pillow (about 66 MB in all, with the Python) |
| `state/art/tools/sprite.py` | a copy of `engine/art/sprite.py` |
| `state/secrets/agents/artist.env` (0600) | exactly two lines, `UUU_ART_PYTHON` and `UUU_ART_TOOL`. The fence exports these to the Artist. They are paths, not keys. |

Nothing goes into `~/.local/bin`, a shell profile or Homebrew. `uv` gets its own caches under `state/art/.cache`, which are deleted when the install ends; your own `uv` cache is left alone.

## Disk

Before each download the installer checks free disk. It stops with a plain message when less than 9 GB is free, and it does not start a step that could leave less than 8 GB (the Python is counted as 1 GB, Pillow as 1 GB). Nothing is deleted to make room; free some disk and run it again, and it carries on from where it stopped.

## The sprite helper

`sprite.py` runs code an agent wrote. It is only ever run inside the fence, in the Artist's task folder:

```
cd <goal>/art/<name> && "$UUU_ART_PYTHON" "$UUU_ART_TOOL" <name>.py [--frames]
```

The script leaves `frames` (1 to 256 Pillow images of one size, at most 512 × 512 each) and, if it likes, `durations` (milliseconds, 10 to 60000, default 100), `tags` (`{ "name", "from", "to", "direction" }`, direction `forward`, `reverse` or `pingpong`), `title` and `columns`. For a simple vector image it leaves `svg` (a string starting `<svg`, at most 1 MB, with no script, no event handler, no foreignObject and no link outside itself) instead.

It writes beside the script: `<name>-sheet.png`, `<name>.json` (the frame data, in the `json-array` shape other sprite tools read), `<name>.gif` (every frame with its own delay, looping) and `manifest.json`; with `--frames` also `frames/<name>-00.png` and on. For `svg`: `<name>.svg` and `manifest.json`. Everything is checked before anything is written, and the sheet and GIF are opened again afterwards. It prints one line such as `walker: 4 frames of 16 × 16, 1 tag, 5 colours. Wrote walker-sheet.png, walker.json, walker.gif.` Problems are one line starting `sprite:` and exit 1. The home server never runs it; the Studio page only lists, checks and serves the files.

## Not installed on purpose

- Aseprite: its licence is not a free-software licence, so it is neither installed nor run. The frame data only follows its `json-array` shape, so it and other tools can open the Artist's sprites.
- An in-place editor for sprites in the Studio would come from a free, browser-only pixel editor (Piskel is one, under the Apache licence) served by the home screen; nothing for it is installed now.
