# The media folder

`state/media/` holds what the Studio's video work reads and no agent may write: the speech model, and the room where you drop footage and sound. The Artist's fence may read it (the `media` read root); nothing else is in it.

## Commands

- `engine/media/install.sh`: copies the speech model that is already on this Mac into `state/media/models/` and makes `state/media/room/`. Prints one line. Safe to run again: a model already in place is left alone. Run `engine/art/install.sh` afterwards, so the Artist's key file names the model.
- `engine/media/install.sh --check-only`: `Speech model: in place` (exit 0) or `Speech model: not in place` (exit 1). `engine setup` prints this line.

## The speech model

- `ggml-small.en.bin`, about 488 MB, MIT licence (OpenAI's weights in whisper.cpp's format). It understands English only.
- It is not downloaded. The installer looks for it, by fixed path only, in other tools' caches under your home folder (`~/.cache/hyperframes/whisper/models/`, `~/.cache/whisper-models/`, `~/.cache/whisper/`). When it is not there, the installer says so and stops; nothing is fetched, and the two video jobs that need speech stay dim.
- It is copied with `cp -c`, a clone: on this Mac's disk the copy shares the original's blocks, so it takes no extra space until one of the two changes. The copy is checked against the original before it is put in place. Deleting the original later does not harm the copy.
- Before copying, the installer checks free disk and stops below 9 GB free, in case the disk copies instead of cloning.
- `whisper-cli` (whisper.cpp from Homebrew, MIT) is the program that uses it. It runs on the CPU (`-ng`): the graphics card is not reachable inside the fence. About 0.75 × real time.
- A larger model that also understands other languages (`ggml-large-v3-turbo.bin`, 1.6 GB) is on this Mac too; it is not used. Two half-finished model files (`ggml-medium.en.bin.*.tmp`, 2.3 GB) sit in the same cache; you may delete them.

## The room

`state/media/room/` is where you put footage and sound for the Studio with Finder: it is too large to send through the browser. The Studio lists the files by name only (`.mp4 .mov .m4v .mp3 .m4a .wav .png .jpg .jpeg`); the home server never opens them. A job that asks for a clip offers these names, and the Artist's video helper reads a clip there by its bare name. A clip may be at most 5 minutes long and 1 GB.

## What it puts where

| Path | What |
|---|---|
| `state/media/models/ggml-small.en.bin` | the speech model (a clone of the one already on this Mac) |
| `state/media/room/` | footage and sound you put there |
