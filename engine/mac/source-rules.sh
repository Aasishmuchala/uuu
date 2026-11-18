#!/bin/bash
# The source rules over Sources/EngineShell and Sources/CompanyEngine (run by check.sh). Exit 0 or 1. Works
# from any folder. Only the generated Sources/EngineShell/Build/BuildConstants.swift is left out, by its full
# path, never by name (M15's M3).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
cd "$HERE" || exit 1

GENERATED='^Sources/EngineShell/Build/BuildConstants\.swift:'

# No script bridge, no own URL scheme, no HTML string, simulated answer or data loaded as a page, no local file,
# no reading of the environment, no state folder, secret or login file named.
FORBIDDEN='evaluateJavaScript|callAsyncJavaScript|WKUserScript|ScriptMessageHandler|setURLSchemeHandler|loadHTMLString|loadSimulatedRequest|characterEncodingName|loadFileURL|loadFileRequest|NSAllowsArbitraryLoads|ProcessInfo\.processInfo\.environment|getenv|paperclip|secrets|auth\.json|agent\.env|\.env\b'
found="$(grep -rnE "$FORBIDDEN" Sources/EngineShell Sources/CompanyEngine --include='*.swift' | grep -vE "$GENERATED")"
if [ -n "$found" ]; then
  echo "$found" >&2
  echo "check.sh: a source file uses something the rules forbid (see above)." >&2
  exit 1
fi

# The loopback address is written in one file only (PLAN-MAC-2 N4a).
found="$(grep -rnE '"(https?://)?127\.0\.0\.1' Sources/EngineShell Sources/CompanyEngine --include='*.swift' \
  | grep -v '^Sources/EngineShell/Web/HomeOrigin\.swift:')"
if [ -n "$found" ]; then
  echo "$found" >&2
  echo "check.sh: a loopback address literal outside HomeOrigin.swift (see above). Use HomeOrigin." >&2
  exit 1
fi
exit 0
