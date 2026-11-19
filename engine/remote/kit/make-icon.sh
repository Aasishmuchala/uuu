#!/bin/bash
# The kit's icon maker: the loft icon at 256 pixels, a PNG inside an ICO, for the Windows shortcut (T6 (10)).
#   make-icon.sh <icon-1024.png> <out.ico>
set -euo pipefail
[ "$#" = 2 ] || { echo "Usage: make-icon.sh <png> <ico>" >&2; exit 64; }
/usr/bin/sips -s format ico -z 256 256 "$1" --out "$2" >/dev/null
