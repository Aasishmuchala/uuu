# The Drafter's tools

The Drafter designs parts: it writes a CadQuery script and gets back a STEP file with the part's measured size. These are the tools it needs, installed in the engine's state folder (`state/cad/`), not in the repo and not in your own Python.

## Commands

- `engine/cad/install.sh`: installs or finishes installing the tools. Safe to run again. Prints free disk and the size of `state/cad` at the end.
- `engine/cad/install.sh --check-only`: `Drafter's tools: installed` (exit 0) or `not installed` (exit 1).
- `engine/cad/fence-check.sh`: checks the export works inside the fence with a Drafter-like policy, and that a fence without that policy cannot read `state/cad`. Uses the proof's fixed agent id for a moment and removes its policy afterwards.
- Tests: `~/.paperclip/uuu-engine/cad/venv/bin/python -m unittest discover -s engine/cad/tests -p 'test_*.py'` (skipped with a message when the tools are not installed).

## Versions (checked 11 November 2026)

- **Python 3.14** (3.14.3 installed). CadQuery's current release, **2.8.0**, needs `cadquery-ocp` 7.9.x; its newest build for this Mac (arm64) is 7.9.3.1.1, which has wheels for Python 3.10 to 3.14. Every other package resolves for 3.14 from ready-made wheels (checked with `uv pip compile --python-version 3.14 --python-platform aarch64-apple-darwin --only-binary :all:`). Nothing is built from source.
- Both versions are pinned at the top of `install.sh`. To move to a newer CadQuery, check its wheels the same way first.

## What it puts where

| Path | What |
|---|---|
| `state/cad/python/` | the Drafter's own Python, fetched by `uv` (`UV_PYTHON_INSTALL_DIR`). The fence hides your home folder, where `uv` keeps its Pythons, so the Drafter needs one inside state. |
| `state/cad/venv/` | CadQuery and what it needs (about 1.4 GB in all, with the Python) |
| `state/cad/tools/export.py` | a copy of `engine/cad/export.py` |
| `state/secrets/agents/drafter.env` (0600) | `UUU_CAD_PYTHON` and `UUU_CAD_EXPORT`. The fence exports these to the Drafter. They are paths, not keys. |

Nothing goes into `~/.local/bin`, a shell profile or Homebrew. `uv` gets its own caches under `state/cad/.cache`, which are deleted when the install ends; your own `uv` cache is left alone.

## Disk

Before each download the installer checks free disk. It stops with a plain message when less than 9 GB is free, and it does not start a step that could leave less than 8 GB (the Python is counted as 1 GB, the packages as 3 GB). Nothing is deleted to make room; free some disk and run it again, and it carries on from where it stopped.

## The export helper

`export.py` runs code an agent wrote. It is only ever run inside the fence, in the Drafter's task folder:

```
cd <goal>/cad && "$UUU_CAD_PYTHON" "$UUU_CAD_EXPORT" <name>.py
```

It runs the script, takes the solid left in `result`, and writes `<name>.step` and `<name>.json` (`name`, `units`, `bbox`, `volume_mm3`, `script`, `made_at`) beside it, then prints one line such as `plate.step: 60 × 40 × 5 mm, volume 11717.26 mm³.` Problems are one line starting `export:` and exit 1. The home server never runs it; the Studio page only lists and serves the files.
