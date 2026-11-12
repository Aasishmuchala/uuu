#!/usr/bin/env bash
# Installs the Artist's tools: a Python of its own, Pillow, the sprite helper,
# the slide tool, the video helper, the brand kit's module and the brand check
# (with the shipped filler list and directions), all under state/art (nothing in the
# repo, nothing in a shell profile, no Homebrew). The Artist's own Python lives
# in state because the fence hides the owner's home folder, where uv keeps its
# Pythons. The video helper uses the ffmpeg and whisper-cli already on this Mac
# and the speech model engine/media/install.sh puts in state/media/models; run
# that one first, so the key file names the model.
#
# Usage: engine/art/install.sh [--check-only]
#   --check-only   prints "Artist's tools: installed" (exit 0) or "not installed" (exit 1)
#
# Safe to run again: every step checks whether it is already done and skips it.
# Checks free disk before every download and stops below 9 GB free; a step only
# starts when it would still leave at least 8 GB free afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/config.sh" || { echo "engine config: could not be read" >&2; exit 1; }

# Checked on 11 November 2026: Pillow 13.0.0 has a ready-made wheel for this
# Mac (arm64) and Python 3.14, the same Python the Drafter uses. See README.md.
PYTHON_VERSION="3.14"
PILLOW_VERSION="13.0.0"

MIN_START_GB=9                      # refuse to start a download below this
FLOOR_GB="${CFG_MIN_FREE_GB:-8}"    # never end a step below this
PYTHON_NEEDS_GB=1                   # rough size of one step, cache included
PACKAGES_NEED_GB=1

ART="$CFG_STATE/art"
PY_DIR="$ART/python"
VENV="$ART/venv"
TOOLS="$ART/tools"
CACHE="$ART/.cache"
AGENT_SECRETS="$CFG_SECRETS/agents"
ENV_FILE="$AGENT_SECRETS/artist.env"
VPY="$VENV/bin/python"
SPRITE_TOOL="$TOOLS/sprite.py"
SLIDES_TOOL="$TOOLS/slides.py"
VIDEO_TOOL="$TOOLS/video.py"
TOOL_FILES="sprite.py slides.py fontmap.json video.py kit.py brandcheck.py"   # copied from engine/art into state/art/tools
BRAND_FILES="filler.json directions.json"   # copied from engine/company/brand into state/art/tools, for the brand check

# Programs already on this Mac, by fixed path (never from PATH). /opt/homebrew is
# outside the home folder, so the fence can read it.
FFMPEG="/opt/homebrew/bin/ffmpeg"
FFPROBE="/opt/homebrew/bin/ffprobe"
STT="/opt/homebrew/bin/whisper-cli"
STT_MODEL="$CFG_STATE/media/models/ggml-small.en.bin"

say() { echo "art: $*"; }
die() { echo "art: $*" >&2; exit 1; }

free_gb() { df -g "$CFG_STATE" | awk 'NR==2 {print $4}'; }
need_disk() {   # need_disk <GB this step may take> <what>
  local free; free="$(free_gb)"
  if [ "$free" -lt "$MIN_START_GB" ]; then
    die "only $free GB of disk is free; the Artist's tools need at least $MIN_START_GB GB free to install. Free some disk, then run engine/art/install.sh again. Nothing was deleted."
  fi
  if [ $((free - $1)) -lt "$FLOOR_GB" ]; then
    die "only $free GB of disk is free; $2 takes about $1 GB and would leave less than $FLOOR_GB GB. Free some disk, then run engine/art/install.sh again. Nothing was deleted."
  fi
  say "free disk $free GB; ok for: $2"
}

# The speech lines only when the model is in place and whisper-cli is here.
have_speech() { [ -x "$STT" ] && /bin/bash "$HERE/../media/install.sh" --check-only >/dev/null 2>&1; }

env_text() {
  printf 'UUU_ART_PYTHON=%s\nUUU_ART_TOOL=%s\nUUU_ART_SLIDES=%s\nUUU_ART_VIDEO=%s\n' \
    "$VPY" "$SPRITE_TOOL" "$SLIDES_TOOL" "$VIDEO_TOOL"
  printf 'UUU_FFMPEG=%s\nUUU_FFPROBE=%s\n' "$FFMPEG" "$FFPROBE"
  if have_speech; then
    printf 'UUU_STT=%s\nUUU_STT_MODEL=%s\n' "$STT" "$STT_MODEL"
  fi
}

source_of() {   # source_of <file>: where the copy in state/art/tools comes from
  case " $BRAND_FILES " in *" $1 "*) echo "$HERE/../company/brand/$1" ;; *) echo "$HERE/$1" ;; esac
}

tools_copied() {
  local f
  for f in $TOOL_FILES $BRAND_FILES; do
    cmp -s "$(source_of "$f")" "$TOOLS/$f" || return 1
  done
}

installed() {
  [ -x "$VPY" ] && [ -f "$ENV_FILE" ] && tools_copied \
    && [ "$(cat "$ENV_FILE")" = "$(env_text)" ] \
    && "$VPY" -I -c "import PIL.Image" >/dev/null 2>&1
}

if [ "${1:-}" = "--check-only" ]; then
  [ $# -eq 1 ] || die "--check-only takes nothing else"
  if installed; then echo "Artist's tools: installed"; exit 0; fi
  echo "Artist's tools: not installed"; exit 1
fi
[ $# -eq 0 ] || die "unknown option $1 (usage: engine/art/install.sh [--check-only])"

command -v uv >/dev/null 2>&1 \
  || die "uv is not on this Mac, so the Artist's Python cannot be fetched. Nothing was changed."

# uv works only inside state/art: its own Pythons, its own caches, no config
# file of the owner's, no links in ~/.local/bin, nothing in a shell profile.
export UV_PYTHON_INSTALL_DIR="$PY_DIR" UV_CACHE_DIR="$CACHE/uv" UV_PYTHON_CACHE_DIR="$CACHE/python"
export UV_NO_CONFIG=1 UV_PYTHON_PREFERENCE=only-managed UV_NO_MODIFY_PATH=1
unset VIRTUAL_ENV UV_PYTHON PYTHONPATH PYTHONHOME PIP_INDEX_URL UV_INDEX_URL UV_EXTRA_INDEX_URL

clean_cache() { rm -rf "$CACHE"; }
trap clean_cache EXIT

mkdir -p "$ART"

# --- 1. A Python of its own ---------------------------------------------------
find_python() {
  uv python find --no-project --python-preference only-managed "$PYTHON_VERSION" 2>/dev/null || true
}
PY="$(find_python)"
case "$PY" in "$PY_DIR"/*) ;; *) PY="" ;; esac
if [ -n "$PY" ]; then
  say "Python $PYTHON_VERSION already in state/art/python"
else
  need_disk "$PYTHON_NEEDS_GB" "Python $PYTHON_VERSION"
  uv python install --no-bin --no-registry --install-dir "$PY_DIR" "$PYTHON_VERSION"
  PY="$(find_python)"
  case "$PY" in "$PY_DIR"/*) ;; *) die "Python $PYTHON_VERSION did not land in state/art/python" ;; esac
fi

# --- 2. Its own environment ---------------------------------------------------
if [ -x "$VPY" ] && [ "$("$VPY" -I -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)" = "$PYTHON_VERSION" ]; then
  say "environment already in state/art/venv"
else
  rm -rf "$VENV"
  uv venv --no-project --python "$PY" "$VENV"
fi

# --- 3. Pillow ------------------------------------------------------------------
if "$VPY" -I -c "import PIL, sys; sys.exit(PIL.__version__ != '$PILLOW_VERSION')" >/dev/null 2>&1; then
  say "Pillow $PILLOW_VERSION already installed"
else
  need_disk "$PACKAGES_NEED_GB" "Pillow $PILLOW_VERSION"
  uv pip install --python "$VPY" --only-binary :all: --compile-bytecode "pillow==$PILLOW_VERSION"
  "$VPY" -I -c "import PIL.Image" || die "Pillow installed but does not start"
fi

# --- 4. The helpers and the Artist's key file -------------------------------------
[ -x "$FFMPEG" ] && [ -x "$FFPROBE" ] \
  || die "ffmpeg is not at $FFMPEG, so the video helper could not work. Nothing new was installed for it."
mkdir -p "$TOOLS"
for f in $TOOL_FILES $BRAND_FILES; do
  src="$(source_of "$f")"
  [ -f "$src" ] || die "$f is missing from the repo (engine/art or engine/company/brand); nothing was copied for it"
  [ -L "$TOOLS/$f" ] && die "state/art/tools/$f is a link; remove it and run again"
  if cmp -s "$src" "$TOOLS/$f"; then
    say "$f already in state/art/tools"
  else
    cp "$src" "$TOOLS/$f.tmp" && chmod 644 "$TOOLS/$f.tmp" && mv "$TOOLS/$f.tmp" "$TOOLS/$f"
    say "$f copied to state/art/tools"
  fi
done
if have_speech; then
  say "speech to text: whisper-cli and the speech model are in place"
else
  say "speech to text: not set up (run engine/media/install.sh, then this again); the jobs that need it stay dim"
fi

[ -d "$CFG_SECRETS" ] || (umask 077; mkdir -p "$CFG_SECRETS")
[ -d "$AGENT_SECRETS" ] || (umask 077; mkdir -p "$AGENT_SECRETS")
chmod 700 "$AGENT_SECRETS"
[ -L "$ENV_FILE" ] && die "$ENV_FILE is a link; remove it and run again"
if [ -f "$ENV_FILE" ] && [ "$(cat "$ENV_FILE")" = "$(env_text)" ]; then
  say "the Artist's key file is already written"
else
  (umask 077; env_text > "$ENV_FILE.tmp")
  chmod 600 "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  say "wrote the Artist's key file (secrets/agents/artist.env)"
fi
chmod 600 "$ENV_FILE"

# --- 5. Clean up and report ------------------------------------------------------
clean_cache
installed || die "the Artist's tools did not check out after installing; run engine/art/install.sh --check-only"
say "the Artist's tools are installed (Python $("$VPY" -I -c 'import platform; print(platform.python_version())'), Pillow $PILLOW_VERSION)"
say "free disk now $(free_gb) GB; state/art takes $(du -sh "$ART" | cut -f1)"
