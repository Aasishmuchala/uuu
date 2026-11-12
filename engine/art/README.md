# The Artist's tools

The Artist draws sprites, small animations and simple images, lays out carousels of slides, and makes short videos: it writes a short drawing script (or a list of pictures, or an edit list) and gets back a sprite sheet, slides, or a video with its poster and six stills. These are the tools it needs, installed in the engine's state folder (`state/art/`), not in the repo and not in your own Python.

## Commands

- `engine/media/install.sh`: run this first. It puts the speech model that is already on this Mac into `state/media/models/` (see `engine/media/README.md`), so the key file below can name it.
- `engine/art/install.sh`: installs or finishes installing the tools. Safe to run again. Prints free disk and the size of `state/art` at the end. It downloads nothing beyond the Python and Pillow it already fetched: ffmpeg and whisper-cli are the ones already on this Mac (Homebrew, `/opt/homebrew/bin`), found by fixed path.
- `engine/art/install.sh --check-only`: `Artist's tools: installed` (exit 0) or `Artist's tools: not installed` (exit 1). `engine setup` prints this line.
- `engine/art/fence-check.sh`: checks the sprite helper works inside the fence with an Artist-like policy, that the video helper renders a two-second video and takes its stills there too, and that a fence without that policy cannot read `state/art`. Uses the proof's fixed agent id for a moment and removes its policy afterwards; it stops with a plain line if that policy is already there (the fence proof is running).
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
| `state/art/tools/` | copies of `sprite.py`, `slides.py`, `fontmap.json` and `video.py` from `engine/art` |
| `state/secrets/agents/artist.env` (0600) | `UUU_ART_PYTHON`, `UUU_ART_TOOL` (the sprite helper), `UUU_ART_SLIDES`, `UUU_ART_VIDEO`, `UUU_FFMPEG`, `UUU_FFPROBE`, and, only when the speech model is in place and `whisper-cli` is on this Mac, `UUU_STT` and `UUU_STT_MODEL`. The fence exports these to the Artist. They are paths, not keys. Run the installer again after `engine/media/install.sh` and it adds the two speech lines. |

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

## The video helper

`video.py` also runs code an agent wrote (for `render`), and only ever inside the fence, from the Artist's task folder:

```
cd <goal>/video/<name> && "$UUU_ART_PYTHON" "$UUU_ART_VIDEO" <command> ...
```

It refuses to run from any other folder. The task-folder tree is found from where the tool is installed (`state/tasks/company-work`, and `state/tasks/_proof` for `fence-check.sh`), never from the folder's name alone: the folder it runs in is resolved through links and must lie in that tree, compared without regard to letter case. The goal is the folder directly under it, and under `company-work` it must be named like a task (`STH-12`).

| Command | Does |
|---|---|
| `render <name>.py` | Runs the script in a child Python. The script leaves `size` (w, h), `fps`, `frames` (Pillow images, a list or an iterator) and, if it likes, `title` and `audio` (a sound file in the goal's folder or the room). The frames are piped straight into ffmpeg and never kept on disk. |
| `reveal <name>.json` | `{ "size", "fps", "title"?, "caption_style"?, "shots": [{ "image", "seconds", "move": "in"\|"out"\|"left"\|"right"\|"still", "caption"? }] }`: slow zooms or pans over pictures, half-second crossfades, captions drawn as pictures. |
| `words <clip>` | Takes the sound out of a clip and writes `words.json` (`[{ "w", "from", "to" }]`), with `whisper-cli -ng` on the CPU. |
| `cut <name>.json` | `{ "source", "keep": [[from, to]], "captions": "words.json" \| null, "caption_style"?, "title"? }`. With a `words.json` beside it, an edge that falls inside a word moves to that word's edge, so the whole word is kept. |
| `stills <name>.mp4` | `review/frame-01.png` to `frame-06.png`, six frames spread evenly, at most 640 px wide. |

`render`, `reveal` and `cut` write `<name>.mp4`, `poster.png` (at the video's size: a frame from the middle of the longest shot, or one third in for a video of one shot, never on a caption change), the six stills and, last, `manifest.json`, whose `seconds` has one decimal (`11.5`). The manifest is the helper's: the home screen reads its length to one decimal, and a manifest changed by hand is not to be trusted. Pictures, sounds and clips are found in the goal's folder (a path from the task folder, such as `../../pictures/front.jpg`), in the company's files (`state/knowledge/docs`), or, by bare name, in the room (`state/media/room`). All three are found from where the tool is installed; no variable the agent can set adds a folder to that list. `caption_style` is `{ "font", "size", "position" }`: a typeface name of the brand form (`fontmap.json`), 12 to 120 px, `bottom` or `top`.

Captions: a caption is on screen from its start up to but not including its end, so two that touch never share a frame. `cut` breaks the words into captions at sentence ends first, then at commas or pauses, and only then by length (at most 42 characters and 6 seconds, never ending on a small word such as "the"); each stays at least a second, taking the silence that follows and never running into the next. `words` finds where speech starts with ffmpeg's `silencedetect` and times no word before it; when it cannot tell, the speech tool's times stay and its one line says so. In a `reveal`, the caption changes at the middle of the crossfade, so two captions are never blended.

This build of ffmpeg cannot draw text, so every title and caption is a Pillow picture laid over the video. The hardware encoder fails inside the fence, so it is always `libx264`. For every run that goes through it, the helper holds these limits itself: at most 1920 × 1080 with even sides, 30 frames a second and 120 seconds; a source clip of at most 5 minutes and 1 GB; `-fs` of 300 MB on every output; a file-size limit of 2 GB on itself and everything it starts; it does not start with under 10 GB of free disk; after 10 minutes, or when it is told to stop, it stops each process group it started; at most 2 GB of files in one goal's folder, counted through links (a file moved away and left as a link still counts), and at most 10 GB in the `video` folders of all goals together. Size, rate, length and a missing `frames` are refused before ffmpeg starts. It takes ffmpeg, ffprobe, whisper-cli and the model only from the `UUU_` variables above; when one is missing it says so and stops. One plain line on success; a problem is one line starting `video:` and exit 1.

## What the helpers guarantee, and what only the fence does

The sprite, slide and video helpers run inside the fence, in the Artist's own shell. The Artist can set any variable for them, can run Pillow, ffmpeg (`$UUU_FFMPEG`) or a copy of a helper without them, and can write what it likes in its task folder. So **no helper is a wall against an agent that does not cooperate. The fence is the wall.**

What the helpers guarantee, for a run that goes through them:

- Every limit listed above for that run: sizes, frame rates, lengths, the 300 MB output cap, the 2 GB file-size limit on the helper and its children, the 10 GB free-disk floor, and the per-goal and all-goals totals before it starts.
- The video helper writes only in the folder it is run from, which must be `<goal>/video/<name>` inside the task-folder tree. The slide and sprite helpers write only beside a script named without a folder, in the folder they are run from.
- Folders the video helper reads sources from (the goal, the company's files, the room) and the task-folder tree are found from where the tool is installed, never from a variable. The tools it runs (`ffmpeg`, `ffprobe`, `whisper-cli`, the model) do come from `UUU_` variables, which the Artist can set; a missing one stops the run, and `PATH` is never searched.
- The video helper's stop (the 10 minutes, a problem, or a stop signal) ends each process group it started, so what a script started goes too. A process that asks for a session of its own is out of its reach.
- The slide helper runs the script in its own process, so a script can change the helper's limits. The home server does not take its word: it checks each slide's size, the count and the words from the files' own bytes (`routes/studio-slides.mjs`).

What only the fence guarantees, whatever the Artist does:

- It can write only in the task folders. Of the state folder it can read only the folders its policy names (`state/knowledge/docs`, `state/art`, `state/media`), and it cannot write in any of them.
- A process it leaves running stays inside the same fence, with the same rights (and, when a helper started it, the 2 GB file-size limit it inherited).
- The disk as a whole: an agent that skips the helpers is held only by the disk's size, as every agent with a task folder is.

Not used, on the prototype's findings (`.router/V3-P1-FINDINGS.md`): Blender (it cannot start inside the fence) and a browser inside the fence (it would need a patched fence tool).

## Not installed on purpose

- Aseprite: its licence is not a free-software licence, so it is neither installed nor run. The frame data only follows its `json-array` shape, so it and other tools can open the Artist's sprites.
- An in-place editor for sprites in the Studio would come from a free, browser-only pixel editor (Piskel is one, under the Apache licence) served by the home screen; nothing for it is installed now.
