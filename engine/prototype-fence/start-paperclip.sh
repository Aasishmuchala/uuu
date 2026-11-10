#!/usr/bin/env bash
# PROTOTYPE (fence trial). Starts paperclip the only way the engine may start it:
#   - the fenced wrappers named `claude` and `codex` come first on its PATH, so
#     every agent it launches is fenced without any per-agent setting
#   - no model API keys in its environment (agents use the plans, not paid keys)
#   - Codex's shared home is the agent's Codex home, never the owner's ~/.codex
#   - no usage reports sent to paperclip's makers
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_ROOT="$HOME/.nvm/versions/node/v24.13.0"
cd "$HERE/.."
export PATH="$HERE/bin:$NODE_ROOT/bin:$PATH"
export CODEX_HOME="$HOME/.paperclip/uuu-engine/codex-home"
export PAPERCLIP_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 PAPERCLIP_NO_BROWSER=1
exec env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY ./node_modules/.bin/paperclipai run
