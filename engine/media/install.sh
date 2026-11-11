#!/usr/bin/env bash
# Puts the speech model that is already on this Mac into the engine's own
# media folder, and makes the Studio's room. Downloads nothing.
#
# Usage: engine/media/install.sh [--check-only]
#   --check-only   prints "Speech model: in place" (exit 0) or "Speech model: not in place" (exit 1)
#
# The model (ggml-small.en.bin, about 488 MB, MIT licence, English only) is
# copied from another tool's cache under the owner's home folder into
# state/media/models/ as a clone (cp -c): on this Mac's disk a clone shares the
# file's blocks, so it takes no extra space until one of the two changes.
# state/media/room/ is where the owner drops footage and sound with Finder.
# The Artist's fence may read state/media; no agent may write there.
#
# Safe to run again: a model already in place is left alone. Checks free disk
# first and stops below 9 GB free, in case the disk cannot clone and copies.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/config.sh" || { echo "engine config: could not be read" >&2; exit 1; }

MODEL_NAME="ggml-small.en.bin"
MIN_MODEL_BYTES=400000000           # the small English model is 487614201 bytes
MIN_START_GB=9
FLOOR_GB="${CFG_MIN_FREE_GB:-8}"
MODEL_NEEDS_GB=1                    # if the disk copies instead of cloning

# Where the model is already on this Mac (other tools' caches). Nothing else is searched.
SOURCES="$HOME/.cache/hyperframes/whisper/models/$MODEL_NAME
$HOME/.cache/whisper-models/$MODEL_NAME
$HOME/.cache/whisper/$MODEL_NAME"

MEDIA="$CFG_STATE/media"
MODELS="$MEDIA/models"
ROOM="$MEDIA/room"
MODEL="$MODELS/$MODEL_NAME"

die() { echo "media: $*" >&2; exit 1; }

free_gb() { df -g "$CFG_STATE" | awk 'NR==2 {print $4}'; }

# A whisper.cpp model file starts with the bytes "lmgg".
is_model() {
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  local size magic
  size="$(stat -f %z "$1" 2>/dev/null || echo 0)"
  [ "$size" -ge "$MIN_MODEL_BYTES" ] || return 1
  magic="$(head -c 4 "$1" 2>/dev/null || true)"
  [ "$magic" = "lmgg" ]
}

in_place() { [ ! -L "$MEDIA" ] && [ ! -L "$MODELS" ] && is_model "$MODEL"; }

if [ "${1:-}" = "--check-only" ]; then
  [ $# -eq 1 ] || die "--check-only takes nothing else"
  if in_place; then echo "Speech model: in place"; exit 0; fi
  echo "Speech model: not in place"; exit 1
fi
[ $# -eq 0 ] || die "unknown option $1 (usage: engine/media/install.sh [--check-only])"

[ -d "$CFG_STATE" ] || die "the engine's state folder is not there yet; run engine start once first. Nothing was changed."
for d in "$MEDIA" "$MODELS" "$ROOM"; do
  [ -L "$d" ] && die "$d is a link; remove it and run again. Nothing was changed."
done
(umask 022; mkdir -p "$MODELS" "$ROOM")
chmod 755 "$MEDIA" "$MODELS" "$ROOM"

if in_place; then
  echo "Speech model: in place (already in state/media/models; the room is state/media/room)"
  exit 0
fi

src=""
while IFS= read -r c; do
  if is_model "$c"; then src="$c"; break; fi
done <<EOF_SOURCES
$SOURCES
EOF_SOURCES
if [ -z "$src" ]; then
  die "the speech model ($MODEL_NAME) is not on this Mac, so nothing was copied and nothing was downloaded. The two video jobs that need speech stay dim."
fi

free="$(free_gb)"
if [ "$free" -lt "$MIN_START_GB" ] || [ $((free - MODEL_NEEDS_GB)) -lt "$FLOOR_GB" ]; then
  die "only $free GB of disk is free; copying the speech model needs at least $MIN_START_GB GB free. Free some disk, then run engine/media/install.sh again. Nothing was copied."
fi

tmp="$MODEL.$$.tmp"
trap 'rm -f "$tmp"' EXIT
cp -c "$src" "$tmp" || die "the speech model could not be copied. Nothing was changed."
chmod 644 "$tmp"
cmp -s "$src" "$tmp" || die "the copy of the speech model does not match the original. Nothing was changed."
mv -f "$tmp" "$MODEL"
trap - EXIT
in_place || die "the speech model did not check out after copying"
echo "Speech model: in place (copied as a clone into state/media/models, no extra disk; the room is state/media/room)"
