#!/usr/bin/env bash
# Installs the Drafter's tools: a Python of its own, CadQuery, and the export
# helper, all under state/cad (nothing in the repo, nothing in a shell profile,
# no Homebrew). The Drafter's own Python lives in state because the fence hides
# the owner's home folder, where uv keeps its Pythons.
#
# Usage: engine/cad/install.sh [--check-only]
#   --check-only   prints "Drafter's tools: installed" (exit 0) or "not installed" (exit 1)
#
# Safe to run again: every step checks whether it is already done and skips it.
# Checks free disk before every download and stops below 9 GB free; a step only
# starts when it would still leave at least 8 GB free afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/config.sh" || { echo "engine config: could not be read" >&2; exit 1; }

# Checked on 11 November 2026: CadQuery 2.8.0 needs cadquery-ocp 7.9.x, whose
# newest wheels for this Mac (arm64) are for Python 3.14. See README.md.
PYTHON_VERSION="3.14"
CADQUERY_VERSION="2.8.0"

MIN_START_GB=9                      # refuse to start a download below this
FLOOR_GB="${CFG_MIN_FREE_GB:-8}"    # never end a step below this
PYTHON_NEEDS_GB=1                   # rough size of one step, cache included
PACKAGES_NEED_GB=3

CAD="$CFG_STATE/cad"
PY_DIR="$CAD/python"
VENV="$CAD/venv"
TOOLS="$CAD/tools"
CACHE="$CAD/.cache"
AGENT_SECRETS="$CFG_SECRETS/agents"
ENV_FILE="$AGENT_SECRETS/drafter.env"
VPY="$VENV/bin/python"
EXPORT_TOOL="$TOOLS/export.py"

say() { echo "cad: $*"; }
die() { echo "cad: $*" >&2; exit 1; }

free_gb() { df -g "$CFG_STATE" | awk 'NR==2 {print $4}'; }
need_disk() {   # need_disk <GB this step may take> <what>
  local free; free="$(free_gb)"
  if [ "$free" -lt "$MIN_START_GB" ]; then
    die "only $free GB of disk is free; the Drafter's tools need at least $MIN_START_GB GB free to install. Free some disk, then run engine/cad/install.sh again. Nothing was deleted."
  fi
  if [ $((free - $1)) -lt "$FLOOR_GB" ]; then
    die "only $free GB of disk is free; $2 takes about $1 GB and would leave less than $FLOOR_GB GB. Free some disk, then run engine/cad/install.sh again. Nothing was deleted."
  fi
  say "free disk $free GB; ok for: $2"
}

env_text() {
  printf 'UUU_CAD_PYTHON=%s\nUUU_CAD_EXPORT=%s\n' "$VPY" "$EXPORT_TOOL"
}

installed() {
  [ -x "$VPY" ] && [ -f "$EXPORT_TOOL" ] && [ -f "$ENV_FILE" ] \
    && cmp -s "$HERE/export.py" "$EXPORT_TOOL" \
    && [ "$(cat "$ENV_FILE")" = "$(env_text)" ] \
    && "$VPY" -I -c "import cadquery" >/dev/null 2>&1
}

if [ "${1:-}" = "--check-only" ]; then
  [ $# -eq 1 ] || die "--check-only takes nothing else"
  if installed; then echo "Drafter's tools: installed"; exit 0; fi
  echo "Drafter's tools: not installed"; exit 1
fi
[ $# -eq 0 ] || die "unknown option $1 (usage: engine/cad/install.sh [--check-only])"

command -v uv >/dev/null 2>&1 \
  || die "uv is not on this Mac, so the Drafter's Python cannot be fetched. Nothing was changed."

# uv works only inside state/cad: its own Pythons, its own caches, no config
# file of the owner's, no links in ~/.local/bin, nothing in a shell profile.
export UV_PYTHON_INSTALL_DIR="$PY_DIR" UV_CACHE_DIR="$CACHE/uv" UV_PYTHON_CACHE_DIR="$CACHE/python"
export UV_NO_CONFIG=1 UV_PYTHON_PREFERENCE=only-managed UV_NO_MODIFY_PATH=1
unset VIRTUAL_ENV UV_PYTHON PYTHONPATH PYTHONHOME PIP_INDEX_URL UV_INDEX_URL UV_EXTRA_INDEX_URL

clean_cache() { rm -rf "$CACHE"; }
trap clean_cache EXIT

mkdir -p "$CAD"

# --- 1. A Python of its own ---------------------------------------------------
find_python() {
  uv python find --no-project --python-preference only-managed "$PYTHON_VERSION" 2>/dev/null || true
}
PY="$(find_python)"
case "$PY" in "$PY_DIR"/*) ;; *) PY="" ;; esac
if [ -n "$PY" ]; then
  say "Python $PYTHON_VERSION already in state/cad/python"
else
  need_disk "$PYTHON_NEEDS_GB" "Python $PYTHON_VERSION"
  uv python install --no-bin --no-registry --install-dir "$PY_DIR" "$PYTHON_VERSION"
  PY="$(find_python)"
  case "$PY" in "$PY_DIR"/*) ;; *) die "Python $PYTHON_VERSION did not land in state/cad/python" ;; esac
fi

# --- 2. Its own environment ---------------------------------------------------
if [ -x "$VPY" ] && [ "$("$VPY" -I -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)" = "$PYTHON_VERSION" ]; then
  say "environment already in state/cad/venv"
else
  rm -rf "$VENV"
  uv venv --no-project --python "$PY" "$VENV"
fi

# --- 3. CadQuery ----------------------------------------------------------------
if "$VPY" -I -c "import cadquery, sys; sys.exit(cadquery.__version__ != '$CADQUERY_VERSION')" >/dev/null 2>&1; then
  say "CadQuery $CADQUERY_VERSION already installed"
else
  need_disk "$PACKAGES_NEED_GB" "CadQuery $CADQUERY_VERSION and what it needs"
  uv pip install --python "$VPY" --only-binary :all: --compile-bytecode "cadquery==$CADQUERY_VERSION"
  "$VPY" -I -c "import cadquery" || die "CadQuery installed but does not start"
fi

# --- 4. The export helper and the Drafter's key file -----------------------------
mkdir -p "$TOOLS"
if cmp -s "$HERE/export.py" "$EXPORT_TOOL"; then
  say "export helper already in state/cad/tools"
else
  cp "$HERE/export.py" "$EXPORT_TOOL.tmp" && chmod 644 "$EXPORT_TOOL.tmp" && mv "$EXPORT_TOOL.tmp" "$EXPORT_TOOL"
  say "export helper copied to state/cad/tools"
fi

[ -d "$CFG_SECRETS" ] || (umask 077; mkdir -p "$CFG_SECRETS")
[ -d "$AGENT_SECRETS" ] || (umask 077; mkdir -p "$AGENT_SECRETS")
chmod 700 "$AGENT_SECRETS"
[ -L "$ENV_FILE" ] && die "$ENV_FILE is a link; remove it and run again"
if [ -f "$ENV_FILE" ] && [ "$(cat "$ENV_FILE")" = "$(env_text)" ]; then
  say "the Drafter's key file is already written"
else
  (umask 077; env_text > "$ENV_FILE.tmp")
  chmod 600 "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  say "wrote the Drafter's key file (secrets/agents/drafter.env)"
fi
chmod 600 "$ENV_FILE"

# --- 5. Clean up and report ------------------------------------------------------
clean_cache
installed || die "the Drafter's tools did not check out after installing; run engine/cad/install.sh --check-only"
say "the Drafter's tools are installed (Python $("$VPY" -I -c 'import platform; print(platform.python_version())'), CadQuery $CADQUERY_VERSION)"
say "free disk now $(free_gb) GB; state/cad takes $(du -sh "$CAD" | cut -f1)"
