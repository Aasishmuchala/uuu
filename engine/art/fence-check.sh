#!/usr/bin/env bash
# Checks that the Artist's tools work inside the fence, and only where the
# fence policy allows them. Run after engine/art/install.sh:
#
#   engine/art/fence-check.sh
#
# 1. With a test policy (the proof's fixed agent id; readFolders naming state/art;
#    envFile the Artist's key file), the sprite helper runs through
#    engine/fence/fence-run in state/tasks/_proof and makes a sprite sheet.
# 2. With the same policy, the video helper renders a two-second video (frames
#    piped into ffmpeg, libx264) and then takes its six stills.
# 3. Without a policy, the same fence cannot read state/art.
# The test policy and the test folder are removed afterwards, whatever happens.
# Exit 0 when both hold, 1 otherwise. Does not touch the board, the gate or the bench.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/config.sh" || { echo "engine config: could not be read" >&2; exit 1; }

FENCE_RUN="$CFG_ENGINE_DIR/fence/fence-run"
TEST_ID="00000000-0000-4000-8000-000000000001"   # the proof's fixed id (engine/fence/prove.sh)
POLICY_FILE="$CFG_POLICY/$TEST_ID.json"
ART="$CFG_STATE/art"
ENV_FILE="$CFG_SECRETS/agents/artist.env"
PROOF="$CFG_STATE/tasks/_proof"
WORK="$PROOF/art-check"

say() { echo "$1: $2"; }
"$HERE/install.sh" --check-only >/dev/null || { echo "The Artist's tools are not installed. Run: engine/art/install.sh" >&2; exit 1; }
[ -e "$POLICY_FILE" ] && { echo "A test policy is already in place (is the fence proof running?). Try again when it is done." >&2; exit 1; }

cleanup() { rm -f "$POLICY_FILE"; rm -rf "$WORK"; }
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

mkdir -p "$WORK"
(umask 022; mkdir -p "$CFG_POLICY")
cat > "$WORK/walker.py" <<'PY'
from PIL import Image, ImageDraw

frames = []
for i in range(4):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    ImageDraw.Draw(im).rectangle([2 + i, 4, 9 + i, 13], fill=(244, 162, 97, 255))
    frames.append(im)
durations = 120
tags = [{"name": "walk", "from": 0, "to": 3, "direction": "forward"}]
title = "Fence check walker"
PY
mkdir -p "$WORK/video/clip"   # the video helper runs only from <goal>/video/<name>
cat > "$WORK/video/clip/clip.py" <<'PY'
from PIL import Image, ImageDraw

size = (320, 180)
fps = 12
title = "Fence check clip"


def make():
    for i in range(24):
        im = Image.new("RGB", size, (20, 24, 40))
        ImageDraw.Draw(im).ellipse([10 + i * 10, 60, 70 + i * 10, 120], fill=(240, 160, 60))
        yield im


frames = make()
PY
(umask 022; printf '{\n  "agentId": "%s",\n  "slug": "artist-check",\n  "localServices": [],\n  "readFolders": ["%s"],\n  "lessonsFile": null,\n  "envFile": "%s",\n  "taskFolder": "read-write"\n}\n' \
  "$TEST_ID" "$ART" "$ENV_FILE" > "$POLICY_FILE")
chmod 644 "$POLICY_FILE"

fails=0
out="$(cd "$PROOF" && PAPERCLIP_AGENT_ID="$TEST_ID" "$FENCE_RUN" \
  -c 'cd art-check && "$UUU_ART_PYTHON" "$UUU_ART_TOOL" walker.py' 2>&1)" || true
if [ -s "$WORK/walker-sheet.png" ] && [ -s "$WORK/walker.gif" ] && [ -s "$WORK/manifest.json" ]; then
  say PASS "with its policy, the Artist's sprite helper runs inside the fence and makes a sheet (${out##*$'\n'})"
else
  say FAIL "with its policy, the sprite helper did not make a sheet inside the fence: ${out##*$'\n'}"
  fails=1
fi

out="$(cd "$PROOF" && PAPERCLIP_AGENT_ID="$TEST_ID" "$FENCE_RUN" \
  -c 'cd art-check/video/clip && "$UUU_ART_PYTHON" "$UUU_ART_VIDEO" render clip.py && rm -rf review && "$UUU_ART_PYTHON" "$UUU_ART_VIDEO" stills clip.mp4' 2>&1)" || true
CLIP="$WORK/video/clip"
if [ -s "$CLIP/clip.mp4" ] && [ -s "$CLIP/poster.png" ] && [ -s "$CLIP/manifest.json" ] && [ -s "$CLIP/review/frame-06.png" ]; then
  say PASS "with its policy, the Artist's video helper renders two seconds and takes six stills inside the fence (${out##*$'\n'})"
else
  say FAIL "with its policy, the video helper did not render inside the fence: ${out##*$'\n'}"
  fails=1
fi
rm -f "$POLICY_FILE"

rm -f "$WORK/walker-sheet.png" "$WORK/walker.json" "$WORK/walker.gif" "$WORK/manifest.json"
rm -rf "$WORK/video"
out="$(cd "$PROOF" && env -u PAPERCLIP_AGENT_ID "$FENCE_RUN" -c "ls '$ART'" 2>&1)" && read_ok=1 || read_ok=0
out2="$(cd "$PROOF" && env -u PAPERCLIP_AGENT_ID "$FENCE_RUN" \
  -c "cd art-check && '$ART/venv/bin/python' '$ART/tools/sprite.py' walker.py" 2>&1)" || true
if [ "$read_ok" = 0 ] && [ ! -e "$WORK/walker-sheet.png" ]; then
  say PASS "without a policy, the fence cannot read state/art and the sprite helper cannot run"
else
  say FAIL "without a policy, the fence could still read state/art or run the sprite helper"
  fails=1
fi
exit "$fails"
