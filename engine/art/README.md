# The Artist's tools

The Artist draws sprites, small animations and simple images, lays out carousels of slides, and makes short videos: it writes a short drawing script (or a list of pictures, or an edit list) and gets back a sprite sheet, slides, or a video with its poster and six stills. These are the tools it needs, installed in the engine's state folder (`state/art/`), not in the repo and not in your own Python.

## Commands

- `engine/media/install.sh`: run this first. It puts the speech model that is already on this Mac into `state/media/models/` (see `engine/media/README.md`), so the key file below can name it.
- `engine/art/install.sh`: installs or finishes installing the tools. Safe to run again. Prints free disk and the size of `state/art` at the end. It downloads nothing beyond the Python and Pillow it already fetched: ffmpeg and whisper-cli are the ones already on this Mac (Homebrew, `/opt/homebrew/bin`), found by fixed path.
- `engine/art/install.sh --check-only`: `Artist's tools: installed` (exit 0) or `Artist's tools: not installed` (exit 1). `engine setup` prints this line.
- `engine/art/fence-check.sh`: checks the sprite helper works inside the fence with an Artist-like policy, that the video helper renders a two-second video and takes its stills there too, that a film's commands work there (two test clips made with the Artist's ffmpeg in `film/fc-a/clips/`, `board`, `clipstills` and `film`, about 3.5 seconds, one line each), and that a fence without that policy cannot read `state/art`. Uses the proof's fixed agent id for a moment and removes its policy afterwards; it stops with a plain line if that policy is already there (the fence proof is running).
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
| `state/art/tools/` | copies of `sprite.py`, `slides.py`, `fontmap.json`, `video.py`, `kit.py` and `brandcheck.py` from `engine/art`, and of `filler.json` and `directions.json` from `engine/company/brand` (the brand check's shipped filler list and the directions for variants). `--check-only` says "installed" only when every one of them matches the repo. |
| `state/secrets/agents/artist.env` (0600) | `UUU_ART_PYTHON`, `UUU_ART_TOOL` (the sprite helper), `UUU_ART_SLIDES`, `UUU_ART_VIDEO`, `UUU_FFMPEG`, `UUU_FFPROBE`, and, only when the speech model is in place and `whisper-cli` is on this Mac, `UUU_STT` and `UUU_STT_MODEL`. The fence exports these to the Artist. They are paths, not keys. Run the installer again after `engine/media/install.sh` and it adds the two speech lines. |

Nothing goes into `~/.local/bin`, a shell profile or Homebrew. `uv` gets its own caches under `state/art/.cache`, which are deleted when the install ends; your own `uv` cache is left alone.

## Disk

Before each download the installer checks free disk. It stops with a plain message when less than 9 GB is free, and it does not start a step that could leave less than 8 GB (the Python is counted as 1 GB, Pillow as 1 GB). Nothing is deleted to make room; free some disk and run it again, and it carries on from where it stopped.

## The brand kit

The owner fills the brand kit in Files; only the home server writes it, as `state/knowledge/docs/brand/kit.json` (PLAN-V5 K5): the colours by name and role, the heading and body typefaces, the smallest sizes, the logo files with their clear space, the margins, the voice. `kit.py` reads it for the tools and the scripts they run. It finds the kit from where it is installed (`state/art/tools`), never from a variable.

The slide tool and the video helper hand the script `kit` (or `None` when the owner has not saved one):

```
bg, ink = kit.colour("sand"), kit.colour("ink")      # (r, g, b), by the kit's own names
title = kit.font("heading", 96)                      # the kit's face; below its smallest size is refused
kit.place(im, "tower-dusk.jpg", (0, 0, 1080, 700))   # a company or room picture by bare name, cover-fitted
kit.place_logo(im, "bottom-right")                   # the logo, with its clear space and least height
m = kit.margin(1080)                                 # the kit's margin for that width
```

What `place` and `place_logo` put on which picture is written into the manifest as `pictures: [{slide|frame, box, source}]` and `logo: [{file, slide|frame, box}]` (a box is `[left, top, right, bottom]`), so the brand check can test each claim against the pixels. Paste on the very image you leave for the tool: a copy made after the paste loses its record. With a kit:

- `slides.py`: `font(name, size)` takes only the kit's two typefaces, at no less than its smallest size for slides; anything else is one line starting `slides:`.
- `video.py render`: the frames that become the poster and the six stills carry what the script placed on them into the manifest (by frame, as the poster and stills are taken).
- `video.py reveal` and `cut`: captions are in the kit's body face (or its heading face when `caption_style.font` names it; no other name is taken), in its text colour (the main one when it has none) on a band of its background colour, never below its smallest size. `"cards": { "title", "end" }` (each the words, or `{ "text", "seconds" }`, 1 to 10 seconds, 3 when not said) adds a title card before and an end card after, drawn by the tool: the heading face in the main colour on the background colour, the logo by `place_logo` on the end card and, when the kit asks for the logo on title cards, on the title card too. They are written as `title-card.png` and `end-card.png` beside the video, and the video grows by their seconds (the sound waits through the title card and is silent through the end card).

With no `kit.json` every command does exactly what it did before the kit, and `cards` is refused ("there is no brand kit yet"). A damaged kit stops the command with one plain line naming what is wrong; the owner mends it by saving the kit again in Files.

## The brand check

`brandcheck.py` is the brand check by code (PLAN-V5 K6). It is run from the task folder, as `"$UUU_BRAND_PY" -I "$UUU_BRAND_CHECK" [--json] <goal id>`, writes nothing, and reads the goal's pieces itself (`content/`, `drafts/`, `slides/`, `video/`, `film/`, `site/`), with caps, never through a link and never at a path a manifest names. It measures colours outside the kit's palette on script-made pictures, checks each claimed company picture and logo against the pixels, the logo's size and clear space where the kit asks for a logo, a script that loads a typeface itself, the owner's can't-say list and the shipped filler list (`filler.json`), and variants that are near copies or repeat a direction (`directions.json`). Exit 0 passes (or only warns), 1 is a hard rule broken, 2 is "could not check". With no kit it says so once and still runs the word rules.

A film's edit (`video/<name>/` whose manifest says `made_by: "film"`) shows Runway's footage of the owner's renders, so its poster is measured but only warns when it is off the palette (PLAN-V5 C13); its title and end cards are the tool's own and stay hard. Its captions get the word rules, as a reveal's and a cut's do: the ones the manifest records (`captions`, written by `film` with the video, so a film file changed afterwards does not hide them) and those in the film file's `clips`. A treatment's storyboard (`film/<name>/board/`) is measured like any drawn picture, every board from `shot-01.png` to `shot-12.png` that is there in exactly that name (as the home server shows them), except the render box each board's manifest claims, which is checked against the render itself: found in the room as the shotlist names it (its render names, with spaces and brackets; exact letter case; a plain file, not a link), up to 100 MB and 80 million pixels (refused before decoding when larger), and made small at once, so one full-size render at most is held. Each picture a claim names is decoded and counted once a run; a run reads at most 1,500 million pixels (twelve 80-million-pixel renders and four rounds of three treatments fit), and past that the piece fails as `could_not_check`.

Who runs it: the maker, after making, to fix things before reporting; the Chief of staff before any reviewer's step (a hard failure goes back to the maker with the tool's own lines, and no reviewer is spent); the Art director before it scores; and the home server, inside the fence under a tool identity of its own, for what the owner sees. Nobody reads another's report: every run is the engine's own code on the files as they are, so a maker cannot forge one.

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

It refuses to run from any other folder (the film's commands below have folders of their own). The task-folder tree is found from where the tool is installed (`state/tasks/company-work`, and `state/tasks/_proof` for `fence-check.sh`), never from the folder's name alone: the folder it runs in is resolved through links and must lie in that tree, compared without regard to letter case. The goal is the folder directly under it, and under `company-work` it must be named like a task (`STH-12`). From the wrong folder a command says, in one line, the folder it runs from.

| Command | Does |
|---|---|
| `render <name>.py` | Runs the script in a child Python. The script leaves `size` (w, h), `fps`, `frames` (Pillow images, a list or an iterator) and, if it likes, `title` and `audio` (a sound file in the goal's folder or the room). The frames are piped straight into ffmpeg and never kept on disk. |
| `reveal <name>.json` | `{ "size", "fps", "title"?, "caption_style"?, "shots": [{ "image", "seconds", "move": "in"\|"out"\|"left"\|"right"\|"still", "caption"? }] }`: slow zooms or pans over pictures, half-second crossfades, captions drawn as pictures. |
| `words <clip>` | Takes the sound out of a clip and writes `words.json` (`[{ "w", "from", "to" }]`), with `whisper-cli -ng` on the CPU. |
| `cut <name>.json` | `{ "source", "keep": [[from, to]], "captions": "words.json" \| null, "caption_style"?, "title"? }`. With a `words.json` beside it, an edge that falls inside a word moves to that word's edge, so the whole word is kept. |
| `stills <name>.mp4` | `review/frame-01.png` to `frame-06.png`, six frames spread evenly, at most 640 px wide. |
| `film <name>.json` | The edit of a film (below): `{ "film", "clips": [{ "clip", "from"?, "to"?, "caption"? }], "fade"?, "cards"?, "caption_style"?, "title"?, "sound"? }`. |

`render`, `reveal`, `cut` and `film` write `<name>.mp4`, `poster.png` (at the video's size: a frame from the middle of the longest shot, or one third in for a video of one shot, never on a caption change), the six stills and, last, `manifest.json`, whose `seconds` has one decimal (`11.5`). The manifest is the helper's: the home screen reads its length to one decimal, and a manifest changed by hand is not to be trusted. Pictures, sounds and clips are found in the goal's folder (a path from the task folder, such as `../../pictures/front.jpg`), in the company's files (`state/knowledge/docs`), or, by bare name, in the room (`state/media/room`). All three are found from where the tool is installed; no variable the agent can set adds a folder to that list. `caption_style` is `{ "font", "size", "position" }`: a typeface name of the brand form (`fontmap.json`), 12 to 120 px, `bottom` or `top`.

Captions: a caption is on screen from its start up to but not including its end, so two that touch never share a frame. `cut` breaks the words into captions at sentence ends first, then at commas or pauses, and only then by length (at most 42 characters and 6 seconds, never ending on a small word such as "the"); each stays at least a second, taking the silence that follows and never running into the next. `words` finds where speech starts with ffmpeg's `silencedetect` and times no word before it; when it cannot tell, the speech tool's times stay and its one line says so. In a `reveal`, the caption changes at the middle of the crossfade, so two captions are never blended.

This build of ffmpeg cannot draw text, so every title and caption is a Pillow picture laid over the video. The hardware encoder fails inside the fence, so it is always `libx264`. For every run that goes through it, the helper holds these limits itself: at most 1920 × 1080 with even sides, 30 frames a second and 120 seconds; a source clip of at most 5 minutes and 1 GB; `-fs` of 300 MB on every output; a file-size limit of 2 GB on itself and everything it starts; it does not start with under 10 GB of free disk; after 10 minutes, or when it is told to stop, it stops each process group it started; at most 2 GB of files in one goal's folder, counted through links (a file moved away and left as a link still counts), and at most 10 GB in the `video`, `film` and `stills` folders of all goals together. Size, rate, length and a missing `frames` are refused before ffmpeg starts. It takes ffmpeg, ffprobe, whisper-cli and the model only from the `UUU_` variables above; when one is missing it says so and stops. One plain line on success; a problem is one line starting `video:` and exit 1. Every one of these holds for the film's commands too.

### A film

A film is made from the owner's own renders (PLAN-V5 K14). The Artist writes one treatment per direction, `film/<name>-<id>/` in the goal (`film/<name>-a/` when there is one), and lists them in `variants.json`. A treatment holds:

| Place | What |
|---|---|
| `shotlist.json` | The shots, in the shape the home server reads too (`engine/home/server/lib/shotlist.mjs`): `title` (1 to 120 characters, one line), `seconds` (5 to 120), `ratio` (`1280:720`, `720:1280`, `1104:832`, `832:1104`, `960:960` or `1584:672`), `shots` (1 to 12, ids `s01`, `s02` and on with no gap; each `render` (a bare name in the room, matched exactly, letter case too; a shot from words alone may leave it out), `seconds` 2 to 10, `move` one line of at most 200, `prompt` 1 to 1000 characters, `kind` `image_to_video` or `text_to_video`, `best` true or false), and optional `cards` `{ title, end }` and `captions`. |
| `board/shot-01.png` and on | The storyboard, one still a shot, by `board`. |
| `inputs/s01.jpg` and on | The pictures sent to the generation door, by `inputs` (and `fit`). |
| `clips/s01-t1.mp4` | A clip as the generation door made it (shot `s01`, take `t1`), saved by the Artist; `clips/s01-t1/frame-01.png` to `frame-06.png` are its stills, by `clipstills`. |

The edit is a video of its own, `video/<name>/`, made by `film`.

| Command | Runs in | Does |
|---|---|---|
| `board shotlist.json` | `<goal>/film/<name>` | Checks the shotlist and, for each shot, writes `board/shot-NN.png` at the film's ratio with its long side 1280 px: the render cover-fitted above a band 14% of the height, and in the band `s01 · 5 s · <move>` (cut with an ellipsis to fit), in the kit's body face at no less than its smallest size, in its text colour (the main one when it has none) on its background colour; with no kit, in the captions' type and colours. A shot from words alone is the band colour whole with "Made from words alone". Then `manifest.json` (`kind` and `made_by` `board`, `title`, `ratio`, `shots`, and `pictures`: each render's box and name), so the brand check verifies each box against its render. Boards of a longer, earlier list are taken away. |
| `inputs shotlist.json` | `<goal>/film/<name>` | For each shot made from a render, `inputs/sNN.jpg`: the render cropped to the film's ratio and made smaller (never larger) to that ratio's own size (1280 × 720 for `1280:720`), as a JPEG of quality 90, else 80, 70 or 60, the first of at most 3,200,000 bytes (the generation door refuses a picture over 3.3 MB). A render over 100 MB or 80 million pixels is refused before it is decoded. |
| `fit <picture> <out> [--ratio W:H] [--long N]` | `<goal>/film/<name>` or `<goal>/stills/<name>` | One picture of the room or the company's files, by bare name, to `inputs/<out>.jpg` (`out`: a to z, 0 to 9 and -, at most 36): cropped to `W:H` when given (one of Runway's video or still ratios, copied from `engine/generate/runway.mjs`), its long side at most `N` (300 to 4096, 1920 when not said; never made larger), the same JPEG steps. Refused when its short side would be under 300 px. |
| `clipstills <id>` | `<goal>/film/<name>` | `clips/<id>/frame-01.png` to `frame-06.png` from `clips/<id>.mp4` (`<id>` such as `s01-t1`: shot `s01` to `s12`, take `t1` to `t5`), spread evenly, at most 640 px wide. The clip must be a plain file (not a link) of at most 300 MB, an MP4 with a picture, at most 12 seconds. |
| `film <name>.json` | `<goal>/video/<name>` | The edit. `film` names the treatment (`film/<film>/` of the same goal, a real folder, not a link); each clip is named by its id and taken from `film/<film>/clips/<clip>.mp4`, checked as for `clipstills`, never from a path in the file. `from` and `to` trim a clip (each piece at least a second; the whole clip when not said). Every piece is cover-cropped to the first clip's size (made to fit 1920 × 1080) at its rate (at most 30); `fade` (0 to 1 second, 0.5 when not said, at most half the shortest piece) crossfades the pieces; captions are pictures, as `reveal` draws them, changing at the middle of a crossfade; `cards` are the kit's title and end cards, as `reveal` and `cut` make them; the clips' own sound is dropped; `sound` (a `.mp3`, `.m4a` or `.wav` in the room, by bare name, or null) runs from the start, cut to the length, fading over its last second. The whole with its cards is at most 120 seconds, refused before ffmpeg starts. It writes what `render` writes, and the manifest also says `made_by: "film"`, `film`, `clips: [{ clip, from, to }]` and `captions` (the words drawn, as drawn, for the brand check). |

No tool talks to Runway. Only the generation door does, and only the Artist can ask it, inside a batch the owner approved: the Artist sends it the pictures in `inputs/` and saves the clips it makes in `clips/`.

## What the helpers guarantee, and what only the fence does

The sprite, slide and video helpers run inside the fence, in the Artist's own shell. The Artist can set any variable for them, can run Pillow, ffmpeg (`$UUU_FFMPEG`) or a copy of a helper without them, and can write what it likes in its task folder. So **no helper is a wall against an agent that does not cooperate. The fence is the wall.**

What the helpers guarantee, for a run that goes through them:

- Every limit listed above for that run: sizes, frame rates, lengths, the 300 MB output cap, the 2 GB file-size limit on the helper and its children, the 10 GB free-disk floor, and the per-goal and all-goals totals before it starts.
- The video helper writes only in the folder it is run from, which must be `<goal>/video/<name>` inside the task-folder tree (for a film's commands `<goal>/film/<name>`, and for `fit` also `<goal>/stills/<name>`). The slide and sprite helpers write only beside a script named without a folder, in the folder they are run from.
- Folders the video helper reads sources from (the goal, the company's files, the room) and the task-folder tree are found from where the tool is installed, never from a variable. A film's renders, pictures, clips and sound are found by fixed or bare names, by `lstat`, never through a link. The tools it runs (`ffmpeg`, `ffprobe`, `whisper-cli`, the model) do come from `UUU_` variables, which the Artist can set; a missing one stops the run, and `PATH` is never searched.
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
