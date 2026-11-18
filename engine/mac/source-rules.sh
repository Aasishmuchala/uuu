#!/bin/bash
# The source rules over Sources/EngineShell and Sources/CompanyEngine (run by check.sh and build.sh --install).
# Exit 0 or 1. Works from any folder. Only the generated Sources/EngineShell/Build/BuildConstants.swift is left
# out, by its full path, never by name (M15's M3), and as a file given to find, never by filtering grep's output
# (M16b): a file named "BuildConstants.swift:x.swift" would otherwise pass as the generated one.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
cd "$HERE" || exit 1

# No link anywhere under Sources (M16b): grep does not follow one, SwiftPM compiles what it points at.
links="$(find Sources -type l)"
if [ -n "$links" ]; then
  echo "$links" >&2
  echo "check.sh: a link under Sources (see above). Put the file itself there." >&2
  exit 1
fi

# No name under Sources with a colon or a line break, so every line below names its file plainly (M16b).
odd="$(find Sources -name '*:*' -o -name "*"$'\n'"*")"
if [ -n "$odd" ]; then
  echo "$odd" >&2
  echo "check.sh: a name under Sources holds a colon or a line break (see above). Rename it." >&2
  exit 1
fi

# The Swift files the rules read, less one by its path.
swift_files() {
  find Sources/EngineShell Sources/CompanyEngine -type f -name '*.swift' ! -path "$1" -exec grep -HnE "$2" {} +
}

# No script bridge, no own URL scheme, no HTML string, simulated answer or data loaded as a page, no local file,
# no reading of the environment, no state folder, secret or login file named.
FORBIDDEN='evaluateJavaScript|callAsyncJavaScript|WKUserScript|ScriptMessageHandler|setURLSchemeHandler|loadHTMLString|loadSimulatedRequest|characterEncodingName|loadFileURL|loadFileRequest|NSAllowsArbitraryLoads|ProcessInfo\.processInfo\.environment|getenv|paperclip|secrets|auth\.json|agent\.env|\.env\b'
found="$(swift_files 'Sources/EngineShell/Build/BuildConstants.swift' "$FORBIDDEN")"
if [ -n "$found" ]; then
  echo "$found" >&2
  echo "check.sh: a source file uses something the rules forbid (see above)." >&2
  exit 1
fi

# The loopback address is written in one file only (PLAN-MAC-2 N4a).
found="$(swift_files 'Sources/EngineShell/Web/HomeOrigin.swift' '"(https?://)?127\.0\.0\.1')"
if [ -n "$found" ]; then
  echo "$found" >&2
  echo "check.sh: a loopback address literal outside HomeOrigin.swift (see above). Use HomeOrigin." >&2
  exit 1
fi
exit 0
