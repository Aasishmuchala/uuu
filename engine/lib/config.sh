# Sourced, never run. Reads engine/config.json through config.py and sets the
# CFG_* variables (not exported). Works with bash 3.2 and `set -euo pipefail`.
# On error: prints `engine config: ...` to stderr and returns 1.
_cfg_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_cfg_out="$(/usr/bin/python3 -I "$_cfg_dir/config.py" --shell)" || return 1
eval "$_cfg_out"
unset _cfg_dir _cfg_out
