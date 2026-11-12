# 0009: Media inside the fence

## Context

The Artist should make short videos and slides, with titles and captions, and cut the owner's footage so a cut never lands inside a word. Prototypes on 12 November 2026 tested what runs inside the fence on this Mac (`.router/V3-P1-FINDINGS.md`). The owner's rules still hold: free software only, nothing downloaded for this, nothing leaves the Mac.

## Decision

- **What runs inside the fence:** ffmpeg already on this Mac, with the software encoder only (the hardware one fails there). This build cannot draw text, so every title and caption is a Pillow picture laid over the video. Pillow frames go straight into ffmpeg and are never kept. `whisper-cli` runs on the CPU and gives a time for every word.
- **The limits:** at most 1920 by 1080, 30 frames a second and 120 seconds; a source clip of at most 5 minutes and 1 GB; 300 MB on every output; a 2 GB file-size limit on the helper; 10 minutes of work; not started with under 10 GB of disk free; at most 2 GB in one goal's folder and 10 GB across all goals. The helper holds them for every run that goes through it. An agent that skips the helper is held only by the fence, which is the wall.
- **The `media` read root.** One new folder under the state folder, `media`, joins `knowledge/docs`, `lessons`, `cad` and `art` as a folder a policy may name for reading. It holds the owner's footage and sound (the room) and the speech model. Only the Artist's policy names it and no agent may write there. The proof gained one block of checks for it. This is the same kind of change as in 0004.
- **The speech model** already on this Mac was copied in as a clone with no download, with the owner's yes. It is English only.
- **The video route** serves an `.mp4` only after its bytes are checked, from one open file, in single byte ranges.

## Consequences

- Videos have no 3D, no web pages and no live text. Charts are drawn with Pillow.
- A different language needs the larger speech model (a ticket exists).
- Each new reader of agent files falls under 0007.

## Rejected

- **Blender inside the fence.** It crashes at start-up: it looks for a graphics device even in background mode, and the fence cannot grant the graphics driver. The only fix is a patched sandbox that opens the kernel's graphics driver to agent code.
- **Headless Chrome inside the fence.** It runs only with four changes to the sandbox tool itself, one of them switching off Chrome's own sandbox. That widens the fence for one feature.
- **A browser's debugging port.** It needs every local port opened, the board included.

## A possible later phase

Blender outside the fence, on the owner's side, from a data-only scene file (boxes, materials, a camera path) read by a script of ours. Never agent Python. It would read agent files with the owner's rights, so it falls under 0007: the scene file is parsed, bounded and checked, and nothing in it is run. No code for this exists. A ticket records it.
