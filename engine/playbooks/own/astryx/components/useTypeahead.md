# useTypeahead
Category: focus.
Import: import { useTypeahead } from '@astryxdesign/core';

APG type-to-focus search for a collection. Buffers printable keys (resets after pause), matches labels by prefix ignoring case, accents, stroked letters + Turkish ı/İ in every locale (typed accent prefers exact match), reports index via onMatch. Same letter pressed repeatedly cycles matches. Moves nothing itself; pair w/ useListFocus / useGridFocus.

## Do
- Wire onMatch to existing focus manager (useListFocus.focusItem), do not move focus yourself.
- Give it the key event first; fall through to arrow navigation when it returns false.
- Pass getCurrentIndex so repeat presses walk matches instead of sticking on first.

## Do not
- Use on a text input; field already gets the characters.

## See also
- DropdownMenu
- Selector
- TreeList
- useListFocus
- useGridFocus
- useTreeFocus
