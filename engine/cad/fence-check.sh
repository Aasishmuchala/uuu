#!/usr/bin/env bash
# Checks that the Drafter's tools work inside the fence, and only where the
# fence policy allows them. Run after engine/cad/install.sh:
#
#   engine/cad/fence-check.sh
#
# 1. With a test policy (the proof's fixed agent id; readFolders naming state/cad;
#    envFile the Drafter's key file), the export runs through engine/fence/fence-run
#    in state/tasks/_proof and makes a STEP file.
# 2. Without a policy, the same fence cannot read state/cad.
# The test policy and the test folder are removed afterwards, whatever happens.
# Exit 0 when both hold, 1 otherwise. Does not touch the board, the gate or the bench.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/config.sh" || { echo "engine config: could not be read" >&2; exit 1; }

FENCE_RUN="$CFG_ENGINE_DIR/fence/fence-run"
TEST_ID="00000000-0000-4000-8000-000000000001"   # the proof's fixed id (engine/fence/prove.sh)
POLICY_FILE="$CFG_POLICY/$TEST_ID.json"
CAD="$CFG_STATE/cad"
ENV_FILE="$CFG_SECRETS/agents/drafter.env"
PROOF="$CFG_STATE/tasks/_proof"
WORK="$PROOF/cad-check"

say() { echo "$1: $2"; }
"$HERE/install.sh" --check-only >/dev/null || { echo "The Drafter's tools are not installed. Run: engine/cad/install.sh" >&2; exit 1; }
[ -e "$POLICY_FILE" ] && { echo "A test policy is already in place (is the fence proof running?). Try again when it is done." >&2; exit 1; }

cleanup() { rm -f "$POLICY_FILE"; rm -rf "$WORK"; }
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

mkdir -p "$WORK"
(umask 022; mkdir -p "$CFG_POLICY")
cat > "$WORK/plate.py" <<'PY'
import cadquery as cq

result = (
    cq.Workplane("XY")
    .box(60, 40, 5)
    .faces(">Z").workplane()
    .pushPoints([(-20, 0), (20, 0)])
    .hole(6)
)
PY
(umask 022; printf '{\n  "agentId": "%s",\n  "slug": "drafter-check",\n  "localServices": [],\n  "readFolders": ["%s"],\n  "lessonsFile": null,\n  "envFile": "%s",\n  "taskFolder": "read-write"\n}\n' \
  "$TEST_ID" "$CAD" "$ENV_FILE" > "$POLICY_FILE")
chmod 644 "$POLICY_FILE"

fails=0
out="$(cd "$PROOF" && PAPERCLIP_AGENT_ID="$TEST_ID" "$FENCE_RUN" \
  -c 'cd cad-check && "$UUU_CAD_PYTHON" "$UUU_CAD_EXPORT" plate.py' 2>&1)" || true
if [ -s "$WORK/plate.step" ] && [ -s "$WORK/plate.json" ]; then
  say PASS "with its policy, the Drafter's export runs inside the fence and makes a STEP file (${out##*$'\n'})"
else
  say FAIL "with its policy, the export did not make a STEP file inside the fence: ${out##*$'\n'}"
  fails=1
fi
rm -f "$POLICY_FILE"

rm -f "$WORK/plate.step" "$WORK/plate.json"
out="$(cd "$PROOF" && env -u PAPERCLIP_AGENT_ID "$FENCE_RUN" -c "ls '$CAD'" 2>&1)" && read_ok=1 || read_ok=0
out2="$(cd "$PROOF" && env -u PAPERCLIP_AGENT_ID "$FENCE_RUN" \
  -c "cd cad-check && '$CAD/venv/bin/python' '$CAD/tools/export.py' plate.py" 2>&1)" || true
if [ "$read_ok" = 0 ] && [ ! -e "$WORK/plate.step" ]; then
  say PASS "without a policy, the fence cannot read state/cad and the export cannot run"
else
  say FAIL "without a policy, the fence could still read state/cad or run the export"
  fails=1
fi
exit "$fails"
