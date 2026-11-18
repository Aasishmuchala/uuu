# useLinkify
Category: link.
Import: import { useLinkify } from '@astryxdesign/core';

Finds URLs, emails and custom patterns in plain text; returns ReactNode[] interleaving plain strings and Link elements that respect LinkProvider routing. Built-in URL/email detection, custom global-regex patterns with href/label builders, overlaps resolved earliest-match-first (custom wins at the same start).

## Do
- Render the nodes as-is; plain text is already interleaved.
- LinkProvider around the region for client-side routing.
- Custom patterns need the g flag.

## Do not
- Pre-parse text into markup before linkifying.

## See also
- Link
- LinkProvider
